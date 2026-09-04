# NYX Browser — Phase 4: Packaging, Launcher & Auto-Updater

## Purpose

Turn NYX Browser from a dev-mode Electron app into a distributable Windows
installer that keeps itself up to date. This is the last of the four
originally-scoped phases (core browser + vault, password manager/autofill,
settings/theming/ad-block, packaging/updater).

## Scope decisions (already agreed)

- **Installer**: electron-builder, NSIS target, Windows only.
- **Code signing**: skipped — no certificate available. Windows SmartScreen
  will show an "unrecognized publisher" warning on first install; this is a
  known, accepted limitation, not a bug to fix in this phase.
- **App icon**: placeholder only, generated programmatically (not real
  design work).
- **Update channel**: real auto-updater via `electron-updater`, checking
  GitHub Releases on the now-public `contactbytesoftware-ship-it/nyx-browser`
  repo.
- **Release publishing**: GitHub Actions, triggered by pushing a `v*` tag.
  The workflow's auto-provisioned `GITHUB_TOKEN` publishes the release — no
  personal access token is ever entered by the user or read by Claude for
  this or any future release.
- **Update UX**: check once on launch, download silently in the background,
  then show a dismissible "Update ready — Restart Now" banner. If dismissed,
  the update still installs automatically on the next natural app quit
  (electron-updater default) — never forced mid-session, never silently
  skipped.
- **Update check frequency**: launch-time only in this phase. No periodic
  background polling — YAGNI; can be added later if needed.

## Components

### 1. Icon generation (build-time only)

A one-time Node script (`scripts/generate-icon.mjs`) draws a simple flat
monogram (an "N" on a filled circle, using the app's existing purple accent
color `#6c4cf1` on a dark background) at 256×256 using `pngjs` (pure JS, no
native deps), then converts it to `build/icon.ico` with `png-to-ico`. Both
packages are devDependencies — build-time only, nothing ships in the
running app. The script is run once during this phase; the resulting
`.ico` is committed. Electron-builder's default convention
(`build/icon.ico`) means no extra config is needed to wire it up.

### 2. electron-builder configuration

Added to `package.json` under a `build` key (or a sibling
`electron-builder.yml` — implementer's call, whichever electron-builder
version in use prefers):

- `appId`: a reverse-DNS-style id, e.g. `com.nyxbrowser.app`.
- `productName`: `NYX Browser` (already the `package.json` productName).
- `win.target`: `nsis`.
- `nsis`: `oneClick: false` (full wizard), `allowToChangeInstallLocation:
  true`, `perMachine: false` (per-user install, no UAC prompt — consistent
  with skipping code signing), default desktop + Start Menu shortcuts.
- `publish`: `{ provider: 'github', owner: 'contactbytesoftware-ship-it',
  repo: 'nyx-browser' }`.
- `files`/`directories.output` pointing at the existing `out/` build
  produced by `electron-vite build`.

New npm scripts:
- `"dist": "electron-vite build && electron-builder --win"` — local build
  of an installer, no publish (for manual smoke-testing).
- `"release": "electron-vite build && electron-builder --win --publish
  always"` — used by CI; not intended for routine local use since it needs
  `GH_TOKEN` in the environment, but kept available for the rare case the
  user wants to publish manually.

### 3. Auto-updater (main process)

`src/main/updater/manager.ts`:
- Wraps `electron-updater`'s `autoUpdater` singleton.
- `autoUpdater.autoDownload = true` (silent download, per the agreed UX).
- Called once from `app.whenReady()`, after the existing window/vault/IPC
  setup, via `autoUpdater.checkForUpdates()` — wrapped so a failure (e.g. no
  network) is caught and logged, never surfaced as a crash or a blocking
  dialog.
- On `update-downloaded`: sends an IPC push event (`updater:ready`) to the
  renderer with the new version string.
- Exposes one IPC handler: `updater:restart-now` → calls
  `autoUpdater.quitAndInstall()`.
- Not wired into `contextBridge` for tab content (same rule as every other
  privileged surface in this app) — only the trusted app-chrome renderer
  gets `window.nyx.updater`.

`src/shared/updater-types.ts`: `UpdaterApi { onUpdateReady(cb: (version:
string) => void): () => void; restartNow(): void }`, mirroring the existing
push-event unsubscribe pattern used by tabs/credentials.

### 4. Update banner (renderer)

`src/renderer/src/updater/UpdateBanner.tsx` — same visual/structural
pattern as the existing `CredentialBanner`: a small dismissible bar in
`BrowserChrome`, shown when `window.nyx.updater.onUpdateReady` fires,
reading "Update ready (vX.Y.Z) — Restart Now" with a primary button wired
to `restartNow()` and a secondary dismiss (dismissing just hides the
banner; the pending install still happens on next quit, unchanged).

### 5. Release workflow (CI)

`.github/workflows/release.yml`:
- Trigger: `push` to tags matching `v*`.
- Runs on `windows-latest`.
- Steps: checkout, setup Node, `npm ci`, `npm run typecheck`, `npm test`,
  `npm run release` (i.e. `electron-vite build && electron-builder --win
  --publish always`).
- Permissions: `contents: write` (required for electron-builder to create
  the GitHub Release via the workflow's own `GITHUB_TOKEN` — no repo
  secret needs to be configured by the user).
- Release flow in practice: bump `version` in `package.json`, commit, `git
  tag vX.Y.Z`, `git push --tags` → workflow builds, tests, and publishes.

## Data flow

```
User: git tag vX.Y.Z && git push --tags
  -> GitHub Actions (windows-latest)
       -> npm ci, typecheck, test
       -> electron-vite build
       -> electron-builder --win --publish always
            -> uploads NSIS installer + latest.yml to GitHub Release vX.Y.Z

Running NYX instance, next launch:
  -> autoUpdater.checkForUpdates() reads latest.yml from the GitHub Release
  -> if newer than current version: silent background download
  -> on complete: IPC push -> UpdateBanner shown
  -> user clicks "Restart Now" -> quitAndInstall()
     (or: ignored -> installs automatically on next natural quit)
```

## Testing approach

Same constraint as every prior phase: no GUI/display server available in
this environment, so "manual verification" is build/typecheck/test plus
code tracing, never actual visual/interactive confirmation. This phase
adds one more inherent limit: electron-builder packaging and the real
install→auto-update round trip can only be verified by the user actually
running a built installer on a real Windows machine — nothing in this
sandbox can package and launch a Windows installer end-to-end. What CAN be
tested here:

- `updater/manager.ts`'s event wiring, using a mocked `electron-updater`
  `autoUpdater` (same mocking approach as other main-process modules
  wrapping external libraries in this codebase).
- IPC handler registration (`updater:restart-now`) and the push-event
  subscribe/unsubscribe contract.
- `UpdateBanner` rendering for the ready/dismissed states.
- The icon-generation script's output (file exists, valid `.ico` header) —
  not its visual quality, which is a placeholder by design.
- electron-builder config validity: `electron-builder --win --dir` (a fast
  local unpacked build, no installer/publish) can run in this environment
  to catch config errors without needing a display.

The GitHub Actions workflow itself, and the full tag-push → published
release → auto-update-on-next-launch loop, must be smoke-tested by the
user after this phase lands: push a `v0.2.0` tag, confirm the Actions run
succeeds and a Release appears with the installer attached, then (once a
`v0.1.0` build is installed locally) confirm the running app detects and
offers the `v0.2.0` update.

## Out of scope for this phase

- Code signing (no certificate).
- macOS/Linux builds (Windows-only, per the original Phase 1 scope
  decision).
- Periodic/background update polling (launch-time check only).
- A "check for updates" manual menu item — launch-time-only fits the
  YAGNI bar for this phase; can be added trivially later if wanted.
- Delta/differential updates — electron-updater's default full-package
  update is sufficient at this scale.
