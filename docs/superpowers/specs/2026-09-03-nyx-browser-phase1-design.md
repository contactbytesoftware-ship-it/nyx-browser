# NYX Browser — Phase 1 Design: Core Shell + Encrypted Vault + Unlock

## Goal

A Windows desktop browser ("NYX Browser") built on Electron/Chromium with a
custom UI, whose entire local state (settings, and later credentials/history/
bookmarks) lives in a single AES-256-GCM encrypted vault file that only opens
given a correct master password + TOTP code. This phase delivers the browser
shell (tabs, navigation, address bar) and the vault/unlock system everything
else builds on. Password manager, customization, and packaging are later
phases (see `docs/superpowers/specs/` for their specs once written).

Default search engine: Brave Search (`https://search.brave.com/search?q=%s`).

## Non-goals for Phase 1

- No password autofill/manager UI (Phase 2).
- No themes, custom CSS injection, ad/tracker blocking, fingerprint
  resistance (Phase 3).
- No installer, auto-updater, or code signing (Phase 4). Runs via
  `npm start` / an unpacked `electron-builder` dir build.
- No Chrome extension support.
- No sync between devices — single-machine, local-only by design.

## Architecture

**Stack:** Electron (latest stable) + TypeScript. Browser chrome (tab strip,
address bar, unlock screen, settings) is a React + Vite renderer window.
Each web page tab is a separate Chromium `WebContentsView` attached to the
main `BrowserWindow`, positioned/sized by the main process to sit below the
chrome UI.

**Process boundaries:**
- **Main process** owns: the vault (encryption keys never leave it), window
  and `WebContentsView` lifecycle, all filesystem I/O, TOTP verification.
- **Chrome renderer** (trusted, our own UI): tab bar, address bar, unlock
  screen. Talks to main only via a narrow `contextBridge` IPC API
  (`window.nyx.*`). `nodeIntegration: false`, `contextIsolation: true`.
- **Tab WebContentsViews** (untrusted, arbitrary web content): default
  Electron sandboxing, no preload with privileged access. Fully isolated
  from vault/IPC APIs — a malicious page must never be able to reach
  `window.nyx`.

This three-tier split (main / trusted chrome / untrusted tabs) is the core
security invariant for the whole project, not just Phase 1.

## Vault format

Single file: `%APPDATA%/NYX Browser/vault.nyx`.

```
[ 16 bytes  salt          ]  scrypt salt, random per-vault, generated once
[ 12 bytes  nonce         ]  AES-GCM nonce, random per SAVE (not reused)
[ 16 bytes  auth tag      ]  AES-GCM auth tag
[ N  bytes  ciphertext    ]  AES-256-GCM(plaintext = JSON vault contents)
```

- Key derivation: `scrypt(masterPassword, salt, N=2^17, r=8, p=1, dklen=32)`
  via Node's built-in `crypto.scryptSync` — no native module dependency.
- Vault plaintext (JSON) for Phase 1:
  ```ts
  interface VaultV1 {
    version: 1;
    totpSecret: string;        // base32, generated at setup
    recoveryKeyHash: string;   // scrypt hash of the recovery key, for verifying
                                // the recovery unlock path without storing it
    recoveryWrappedKey: string; // vault AES key, wrapped (AES-GCM) under a key
                                 // derived from the recovery code — lets the
                                 // recovery code decrypt the vault independently
                                 // of the master password
    settings: Record<string, unknown>; // Phase 1: just window/theme prefs stub
  }
  ```
- The vault key is held only in memory (a `Buffer`) while unlocked, zeroed
  with `buf.fill(0)` on lock/quit. Nothing decrypted ever touches disk.
- Every save re-encrypts the full JSON blob with a fresh random nonce and
  writes via a temp-file-then-rename to avoid corrupting the vault on
  crash/power loss.

## Unlock flow

**First run (no `vault.nyx` present):**
1. User sets a master password (strength meter; reject anything under a
   basic entropy bar).
2. App generates: a random salt, a random TOTP secret, and a random
   24-character recovery key.
3. TOTP secret is shown as a QR code (`otpauth://totp/NYX%20Browser:...`,
   rendered via the `qrcode` package) for the user to scan into Google
   Authenticator/Authy/etc. This never touches a Google account or network
   — it's the standard RFC 6238 local secret.
4. Recovery key is shown once, with an explicit "write this down, it will
   never be shown again" warning and a confirmation checkbox before
   continuing.
5. Vault is created and encrypted as described above.

**Every subsequent launch:**
1. Unlock screen asks for master password.
2. `scrypt` derives a candidate key; attempt `AES-GCM` decrypt.
   - Auth tag mismatch → wrong password → generic "incorrect password or
     code" error (don't leak which factor failed) → count toward lockout.
3. On successful decrypt, ask for the current 6-digit TOTP code, verify
   against `vaultPlaintext.totpSecret` (±1 time-step window for clock
   drift) using the `otpauth` package.
   - Mismatch → discard the decrypted plaintext and key from memory
     immediately, generic error, count toward lockout.
4. Both correct → vault unlocked, key retained in memory, main window's
   real browser UI replaces the unlock screen.

**Lockout:** exponential backoff after failed attempts (1s, 2s, 4s, 8s...
capped at 60s), tracked in memory (resets on app restart — this is a
deterrent, not a hard lockout, since it's a fully offline local app and a
hard lockout would let an attacker with disk access denial-of-service the
real owner permanently).

**Recovery path:** "Forgot password?" on the unlock screen switches to
entering the 24-character recovery key instead. That key derives (via the
same scrypt scheme) the wrapping key for `recoveryWrappedKey`, which
unwraps the actual vault AES key — bypassing the master password entirely.
After a successful recovery unlock, force the user to set a new master
password immediately (vault is re-encrypted with a fresh salt/key, and a
new recovery key is generated, invalidating the old one).

**Auto-lock:** configurable idle timeout (default 15 min), lock on system
sleep (`powerMonitor` events), and a manual lock hotkey
(`Ctrl+Shift+L`). Locking zeros the in-memory key and swaps the chrome UI
back to the unlock screen; open tabs are hidden (WebContentsViews detached,
not destroyed) and restored on unlock.

## Browser shell (Phase 1 feature set)

- Tab strip: new/close/reorder/switch tabs, pinned tabs.
- Address bar: navigate to URL, or search via Brave Search if input isn't a
  valid URL. Basic autocomplete from open tabs only (no history search yet
  — history storage is added in this phase's data model but the UI for
  browsing/searching it can wait for Phase 2/3; Phase 1 just needs
  navigation to work).
- Back/forward/reload/stop, loading state per tab.
- DevTools accessible (hidden behind a settings toggle, off by default).
- Window chrome: standard title bar replaced with custom chrome (tab strip
  doubles as drag region).

## Error handling

- Vault file present but corrupt/truncated (fails to parse after
  successful decrypt): back it up as `vault.nyx.corrupt-<timestamp>` and
  surface a clear error rather than silently wiping — never auto-delete
  user data.
- Vault decrypt succeeds but JSON `version` is newer than this build
  understands: refuse to open, tell the user to update the app.
- Disk write failure on save: keep the previous vault file untouched (the
  temp-then-rename write means a failed write never corrupts the existing
  vault) and surface the error.

## Testing approach

- Unit tests (vitest) for the vault module: encrypt/decrypt round-trip,
  wrong-password rejection, corrupt-file handling, recovery-key unwrap
  path, TOTP verification against known RFC 6238 test vectors.
- Manual test pass in the actual Electron app for the full unlock UX
  (first run, relock, wrong password, wrong TOTP, recovery flow, idle
  auto-lock, sleep auto-lock) since this is UI-driven and worth seeing
  actually run, per project convention of testing UI changes in a real
  browser/app before calling them done.

## Dependencies (Phase 1)

- `electron`, `electron-builder` (dev, unpacked build only for now)
- `react`, `react-dom`, `vite`, `typescript`
- `otpauth` (pure JS TOTP, RFC 6238 + provisioning URI)
- `qrcode` (pure JS QR rendering)
- `vitest` (unit tests)
- No native Node modules — keeps Windows builds simple.
