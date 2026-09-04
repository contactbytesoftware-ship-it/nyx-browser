# NYX Browser — Phase 2 Design: Password Manager + Autofill

## Goal

Add encrypted credential storage to the existing vault, plus a save/fill flow that never gives tab content any privileged access — detection and injection are both driven entirely from the main process on explicit user action, preserving Phase 1's "tabs get zero privileged surface" invariant.

## Non-goals for Phase 2

- No credential management screen (list/edit/delete UI) — save/fill only. Overwriting a domain's saved credential is done by saving again.
- No multiple credentials per domain, no picker UI.
- No public-suffix-list-aware domain matching — exact hostname match only (`accounts.example.com` and `example.com` are distinct entries).
- No detection of single-page-app logins that never trigger a full navigation (`will-navigate` only fires for real navigations).
- No configurable password generator (length/charset) — fixed default, revisited when Phase 3 adds a settings UI.
- No "never save for this site" list — Save / Not now only.
- No browser extension / Chrome Web Store credential import.

## Data model change

`VaultContentsV1` (still version 1 — nothing has shipped to a real user's disk yet, so this is an additive change, not a migration) gains a `credentials` array:

```ts
interface CredentialV1 {
  id: string          // crypto.randomUUID()
  domain: string       // exact hostname, e.g. "accounts.example.com"
  username: string
  password: string
  notes?: string
  updatedAt: number     // Date.now() at last save
}

interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
  credentials: CredentialV1[]   // NEW
}
```

`VaultManager.setup()` initializes `credentials: []`. Existing container/manager tests that construct a `VaultContentsV1` literal need the new field added.

## VaultManager extension: contents must survive unlock

Today, `unlockWithPassword`/`unlockWithRecoveryKey` decrypt `contents` only to check the TOTP code, then discard it — only the derived `vaultKey` is retained. Phase 2 needs to read and write credentials while unlocked without re-deriving keys, so:

- `VaultManager` gains `private contents: VaultContentsV1 | null`, set alongside `this.vaultKey` on every successful unlock, and cleared (no sensitive data in it besides what's already in the vault, so no need to zero byte-by-byte — but null it out) on `lock()`.
- A new `container.ts` function, `updateContainerContents(container: VaultContainer, vaultKey: Buffer, contents: VaultContentsV1): VaultContainer`, re-encrypts only `mainBlob` under the *existing* `vaultKey` and returns a new container with `passwordSalt`/`passwordWrappedKey`/`recoverySalt`/`recoveryWrappedKey` unchanged. This is cheaper than the recovery-rekey path (no new scrypt derivations, no new salts) since the vault key itself isn't changing.
- `VaultManager` gains a private `persistContents(): Promise<void>` helper: calls `updateContainerContents`, `saveRawFile`s the result, updates `this.container` and `this.contents`. Every credential-mutating method below calls this after updating `this.contents.credentials` in memory. Throws if called while locked (`this.contents`/`this.vaultKey` are `null`) — callers (IPC handlers) are expected to only be reachable while unlocked, consistent with how the rest of the app already gates on vault state.

## VaultManager: credential operations

```ts
listCredentials(): CredentialV1[]                                    // returns a copy, never the live array
getCredentialForDomain(domain: string): CredentialV1 | null
saveCredential(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1>
  // upserts by exact domain match: replaces the existing entry's username/password/notes/updatedAt,
  // or appends a new one with a fresh id. Persists before returning.
deleteCredential(id: string): Promise<void>                          // persists before returning; no-op if id not found
```

## Detection and fill (no privileged code on tabs)

**Fill flow:**
1. Whenever the active tab's URL changes, the renderer's chrome asks `window.nyx.credentials.getForDomain(hostname)` (hostname extracted from the tab's current URL, renderer-side pure function).
2. If found, the address bar shows a small "Fill" indicator (button, not automatic).
3. Click (or `Ctrl+Shift+F`, wired via the same per-tab `attachLockShortcut`-style pattern from Phase 1 — attached to both the chrome window and every tab's `webContents` so it works regardless of focus) opens a confirm step in the trusted chrome UI: "Fill saved login for `<domain>`?"
4. On confirm, main process runs one `webContents.executeJavaScript()` on that tab: locate `input[type=password]`, walk up to its nearest `<form>` (or the whole document if none), find the first `input[type=text i], input[type=email i], input:not([type])` inside it as the username field, set both `.value` via the native setter (to survive React-style controlled inputs) and dispatch a real `input` `Event` on each so page JS observes the change.
5. Nothing is read back from the page in this flow — it's fire-and-forget from main's perspective.

**Save flow:**
1. `TabManager.createTab` (already wires several per-tab `webContents.on(...)` listeners at creation) adds one more: `webContents.on('will-navigate', ...)`.
2. On `will-navigate`, before the navigation proceeds, main runs one `executeJavaScript()` against the *still-current* (pre-navigation) page: scan for `input[type=password]` with a non-empty `.value`; if found, apply the same form-walk as the fill flow to find a candidate username value alongside it.
3. If a password value was captured, main sends `credentials:submissionDetected` (push event, same pattern as `vault:locked`/`tabs:changed`) to the renderer with `{ domain, username, password }` — the domain is the tab's current (pre-navigation) hostname.
4. The renderer shows a "Save password?" banner in the chrome UI (Save / Not now), pre-filled with the captured values, editable before saving, with a "Generate" button that swaps in a freshly generated password (for signup forms).
5. Save calls `window.nyx.credentials.save(domain, username, password, notes?)` → IPC → `VaultManager.saveCredential`. Nothing is written to disk before this explicit confirmation.

**Password generator:** a pure renderer-side function using `crypto.getRandomValues` (Web Crypto — the renderer has DOM globals, no IPC needed): 20 characters drawn from a fixed alphabet covering upper/lowercase letters, digits, and a safe symbol set, unbiased via rejection sampling (same technique as the recovery-key fix from Phase 1 — no `% alphabet.length` shortcuts).

## IPC surface

`window.nyx.credentials`:
```ts
interface CredentialsApi {
  list(): Promise<CredentialV1[]>
  getForDomain(domain: string): Promise<CredentialV1 | null>
  save(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1>
  delete(id: string): Promise<void>
  onSubmissionDetected(callback: (capture: { domain: string; username: string; password: string }) => void): () => void
}
```
Channel names: `credentials:list`, `credentials:getForDomain`, `credentials:save`, `credentials:delete`, `credentials:submissionDetected` (push).

## Security notes

- Credentials live inside the existing AES-256-GCM-encrypted `mainBlob` — no new crypto primitives, no new attack surface on the encryption itself.
- Every DOM read/write happens via a single, one-shot `executeJavaScript()` call triggered by an explicit user action (fill) or a browser-level navigation event the app already observes (save capture) — never a standing listener or bridge exposed to page script. A malicious page still cannot reach `window.nyx`, IPC, or Node APIs at any point.
- The `will-navigate` capture only reads values already present in the DOM of a page the user is actively interacting with — the same category of information a browser's built-in "save password?" prompt reads, not a cross-origin or background capability.
- Filled/captured passwords cross the IPC boundary as plain strings (consistent with how the master password already crosses IPC during unlock) — no additional exposure beyond what Phase 1 already accepted.

## Testing approach

- `VaultManager`'s credential methods: full TDD, matching Phase 1's vault-work rigor — round-trip persistence, upsert-by-domain overwrite behavior, delete, and that `listCredentials()`/`getCredentialForDomain()` reflect a freshly-saved credential without needing to re-unlock.
- Password generator: pure function — length, character-class coverage, and (like the Phase 1 recovery-key fix) no modulo bias.
- Domain-extraction helper (tab URL → hostname): pure function, easy edge cases (with/without port, with path/query).
- `executeJavaScript`/`will-navigate` wiring in `TabManager`: Electron-specific, no automated test — verified by build + manual code trace, same standing caveat as Phase 1 (no GUI/display server available anywhere in this process; the user should click through the real flow themselves).

## Dependencies

None new — `crypto.randomUUID()` and `crypto.getRandomValues()` are both available without additional packages (Node's `crypto` in main, Web Crypto in the renderer).
