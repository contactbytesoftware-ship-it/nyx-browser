# NYX Browser Phase 4: Packaging, Launcher & Auto-Updater — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn NYX Browser into a distributable Windows NSIS installer that checks GitHub Releases on launch, downloads updates silently in the background, and prompts the user to restart once one is ready.

**Architecture:** electron-builder packages the existing `electron-vite build` output (`out/`) into a Windows NSIS installer. `electron-updater`'s `autoUpdater` runs in the main process only, wired the same way every other privileged surface in this app is (an `attachX`/`registerXIpc` pair, exposed to the trusted app-chrome renderer via the existing `contextBridge` — never to tab content). A GitHub Actions workflow, triggered by pushing a `v*` tag, builds and publishes releases using GitHub's own auto-provisioned token, so no personal access token is ever needed for any future release.

**Tech Stack:** electron-builder ^26.15.3 (devDependency), electron-updater ^6.8.9 (runtime dependency), pngjs ^7.0.0 + png-to-ico ^3.0.2 (build-time-only devDependencies for the placeholder icon), GitHub Actions (`windows-latest` runner).

**Spec:** [docs/superpowers/specs/2026-09-04-nyx-browser-phase4-packaging-updater-design.md](../specs/2026-09-04-nyx-browser-phase4-packaging-updater-design.md)

## Global Constraints

- **Windows only.** No macOS/Linux build targets.
- **No code signing.** No certificate exists; SmartScreen will warn on first install — accepted, not a defect to fix in this plan.
- **No preload/contextBridge on tab content, ever.** Only `src/preload/index.ts` (the trusted app-chrome `BrowserWindow`) may call `contextBridge.exposeInMainWorld`. Nothing in this plan touches tab `WebContentsView`s.
- **`GH_TOKEN` comes only from GitHub Actions' auto-provisioned `secrets.GITHUB_TOKEN`.** No personal access token is read, entered, or referenced anywhere in this plan — not by an implementer, not by a script, not in any committed file.
- **Follow the existing main-process wiring convention**: an `attachX(...)` function wires event listeners / side effects, a separate `registerXIpc(...)` function registers `ipcMain.handle` calls — mirroring `attachLockShortcut`/`registerVaultIpc`, `attachCredentialCapture`/`registerCredentialsIpc`.
- **No new renderer test infrastructure.** This codebase has no React component-rendering test setup (only pure-function unit tests exist under `src/renderer/src/**`). Renderer changes in this plan are verified by `typecheck` + `build`, matching the existing convention — do not introduce `@testing-library/react` or similar.
- **pngjs/png-to-ico never ship in the running app.** They are devDependencies used only by the one-time `scripts/generate-icon.mjs` build script, not imported by anything under `src/`.
- **Pushing a git tag triggers a real, publicly-visible GitHub Release build.** No task in this plan pushes a tag — that is a "visible to others" action reserved for the user's explicit go-ahead after this plan is fully merged, not something an implementer or reviewer subagent should ever do.

---

### Task 1: Placeholder app icon

**Files:**
- Create: `scripts/generate-icon.mjs`
- Create: `scripts/generate-icon.test.mjs`
- Create: `build/icon.ico` (generated binary output, committed)
- Modify: `vitest.config.ts`
- Modify: `package.json` (devDependencies: `pngjs`, `png-to-ico`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `build/icon.ico` on disk, consumed by Task 2's electron-builder config (electron-builder's default `directories.buildResources` is `build`, so `build/icon.ico` is picked up automatically with no extra config).

- [ ] **Step 1: Install the build-time-only icon dependencies**

```bash
npm install --save-dev pngjs@^7.0.0 png-to-ico@^3.0.2
```

- [ ] **Step 2: Widen the vitest include glob to cover the new script's test**

Modify `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] }
})
```

- [ ] **Step 3: Write the failing test**

Create `scripts/generate-icon.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { drawMonogramPng } from './generate-icon.mjs'

describe('drawMonogramPng', () => {
  it('produces a valid PNG buffer', () => {
    const buffer = drawMonogramPng(256)
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('paints the corners with the background color and the center with the accent color', () => {
    const buffer = drawMonogramPng(256)
    const png = PNG.sync.read(buffer)
    const pixelAt = (x, y) => {
      const idx = (png.width * y + x) << 2
      return [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
    }
    // Background: the app's existing --bg dark shade (see global.css).
    expect(pixelAt(0, 0)).toEqual([0x1a, 0x1a, 0x1d])
    // Center: the app's existing --accent purple (see settings-types.ts DEFAULT_SETTINGS).
    expect(pixelAt(128, 128)).toEqual([0x6c, 0x4c, 0xf1])
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run scripts/generate-icon.test.mjs`
Expected: FAIL — `Cannot find module './generate-icon.mjs'` (or equivalent resolution error).

- [ ] **Step 5: Write the icon generator**

Create `scripts/generate-icon.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const BACKGROUND = { r: 0x1a, g: 0x1a, b: 0x1d }
const ACCENT = { r: 0x6c, g: 0x4c, b: 0xf1 }

/**
 * A flat placeholder mark: the app's accent-purple circle on its own dark
 * background. Not real design work — swap this script's output for a real
 * icon whenever one exists.
 */
export function drawMonogramPng(size) {
  const png = new PNG({ width: size, height: size })
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.38

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2
      const dx = x - cx
      const dy = y - cy
      const inCircle = dx * dx + dy * dy <= radius * radius
      const color = inCircle ? ACCENT : BACKGROUND
      png.data[idx] = color.r
      png.data[idx + 1] = color.g
      png.data[idx + 2] = color.b
      png.data[idx + 3] = 0xff
    }
  }

  return PNG.sync.write(png)
}

async function main() {
  const pngBuffer = drawMonogramPng(256)
  const icoBuffer = await pngToIco(pngBuffer)
  const outPath = fileURLToPath(new URL('../build/icon.ico', import.meta.url))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, icoBuffer)
  console.log(`Wrote ${outPath}`)
}

// Only run when executed directly (`node scripts/generate-icon.mjs`), not when
// imported by the test. pathToFileURL (not a raw `file://` template) keeps this
// comparison correct on Windows, where drive letters and backslashes would
// otherwise make a naive string comparison fail.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run scripts/generate-icon.test.mjs`
Expected: PASS (2/2)

- [ ] **Step 7: Generate the actual icon file**

Run: `node scripts/generate-icon.mjs`
Expected: prints `Wrote .../build/icon.ico`

Then verify it's a well-formed single-image ICO (magic bytes `00 00 01 00`):

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('build/icon.ico');console.log(b.subarray(0,4).equals(Buffer.from([0,0,1,0])))"
```

Expected: prints `true`

- [ ] **Step 8: Commit**

```bash
git add scripts/generate-icon.mjs scripts/generate-icon.test.mjs vitest.config.ts package.json package-lock.json build/icon.ico
git commit -m "feat: generate a placeholder app icon"
```

---

### Task 2: electron-builder packaging config

**Files:**
- Modify: `package.json` (devDependencies: `electron-builder`; `build` config block; `dist`/`release` scripts)

**Interfaces:**
- Consumes: `build/icon.ico` (Task 1).
- Produces: `npm run dist` (local unpacked/installer build, no publish), `npm run release` (build + publish, used by Task 6's CI workflow — nothing in this plan invokes it locally, since that requires `GH_TOKEN`).

- [ ] **Step 1: Install electron-builder**

```bash
npm install --save-dev electron-builder@^26.15.3
```

- [ ] **Step 2: Add the build config and scripts to package.json**

Modify `package.json` — add a `"build"` key alongside the existing top-level keys, and two new entries in `"scripts"`:

```json
{
  "name": "nyx-browser",
  "productName": "NYX Browser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "dist": "electron-vite build && electron-builder --win",
    "release": "electron-vite build && electron-builder --win --publish always"
  },
  "build": {
    "appId": "com.nyxbrowser.app",
    "productName": "NYX Browser",
    "win": { "target": "nsis" },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallLocation": true,
      "perMachine": false,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "publish": {
      "provider": "github",
      "owner": "contactbytesoftware-ship-it",
      "repo": "nyx-browser"
    }
  },
  "devDependencies": { "...": "unchanged, plus electron-builder" },
  "dependencies": { "...": "unchanged" }
}
```

(Keep every existing `devDependencies`/`dependencies` entry — only add `electron-builder` to `devDependencies`; `npm install` in Step 1 already did this, so just confirm it landed rather than retyping the whole block.)

- [ ] **Step 3: Confirm the existing app build still succeeds**

Run: `npm run build`
Expected: exit 0, `out/main`, `out/preload`, `out/renderer` all produced (unchanged from before this task).

- [ ] **Step 4: Verify the packaging config with a fast unpacked build**

Run: `npx electron-builder --win --dir`
Expected: exit 0, and `dist/win-unpacked/NYX Browser.exe` exists. This is the cheapest way to confirm `appId`/`nsis`/`publish` config is structurally valid without building a full installer or touching `GH_TOKEN` (`--dir` skips both packaging into NSIS and publishing).

Verify the file exists:

```bash
node -e "console.log(require('fs').existsSync('dist/win-unpacked/NYX Browser.exe'))"
```

Expected: prints `true`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add electron-builder NSIS packaging config"
```

---

### Task 3: Auto-updater manager (main process)

**Files:**
- Create: `src/shared/updater-types.ts`
- Create: `src/main/updater/manager.ts`
- Test: `src/main/updater/manager.test.ts`
- Modify: `package.json` (dependencies: `electron-updater`)

**Interfaces:**
- Consumes: nothing new beyond `electron-updater`'s `autoUpdater` and `electron`'s `BrowserWindow`/`ipcMain`.
- Produces: `attachAutoUpdater(win: BrowserWindow): void`, `registerUpdaterIpc(): void` — both consumed by Task 4. IPC contract: main pushes `'updater:ready'` with a `string` version payload; renderer invokes `'updater:restartNow'` with no arguments. `UpdaterApi { onUpdateReady(callback: (version: string) => void): () => void; restartNow(): void }` — consumed by Task 5's preload wiring.

- [ ] **Step 1: Install electron-updater**

```bash
npm install --save electron-updater@^6.8.9
```

- [ ] **Step 2: Define the shared API type**

Create `src/shared/updater-types.ts`:

```ts
export interface UpdaterApi {
  onUpdateReady(callback: (version: string) => void): () => void
  restartNow(): void
}
```

- [ ] **Step 3: Write the failing test**

Create `src/main/updater/manager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Listener = (...args: unknown[]) => void

// `vi.hoisted` keeps the registry out of the TDZ: vitest lifts `vi.mock` above the
// imports, and the factory runs while './manager' is being loaded.
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  handlers: new Map<string, Listener>(),
  checkForUpdates: vi.fn(async () => undefined),
  quitAndInstall: vi.fn(),
  autoDownloadValue: undefined as boolean | undefined
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Listener): void => {
      mocks.handlers.set(channel, handler)
    }
  },
  BrowserWindow: class {}
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, listener: Listener): void => {
      mocks.listeners.set(event, listener)
    },
    checkForUpdates: mocks.checkForUpdates,
    quitAndInstall: mocks.quitAndInstall,
    get autoDownload() {
      return mocks.autoDownloadValue
    },
    set autoDownload(value: boolean) {
      mocks.autoDownloadValue = value
    }
  }
}))

// Imported last purely for readability — the mocks above are what './manager' sees.
import { attachAutoUpdater, registerUpdaterIpc } from './manager'

function fakeWindow(destroyed = false): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const win = { isDestroyed: () => destroyed, webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

beforeEach(() => {
  mocks.listeners.clear()
  mocks.handlers.clear()
  mocks.checkForUpdates.mockClear()
  mocks.quitAndInstall.mockClear()
  mocks.autoDownloadValue = undefined
})

describe('attachAutoUpdater', () => {
  it('enables silent background downloads', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.autoDownloadValue).toBe(true)
  })

  it('checks for updates once on startup', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('pushes the new version to the renderer once a download completes', () => {
    const { win, send } = fakeWindow()
    attachAutoUpdater(win)
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    onDownloaded({ version: '0.2.0' })
    expect(send).toHaveBeenCalledWith('updater:ready', '0.2.0')
  })

  it('does not throw when the window closed before a download finished', () => {
    const { win } = fakeWindow(true)
    attachAutoUpdater(win)
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    expect(() => onDownloaded({ version: '0.2.0' })).not.toThrow()
  })
})

describe('registerUpdaterIpc', () => {
  it('installs the downloaded update on request', async () => {
    registerUpdaterIpc()
    const handler = mocks.handlers.get('updater:restartNow')
    if (!handler) throw new Error('updater:restartNow was never registered')
    await handler(null)
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/main/updater/manager.test.ts`
Expected: FAIL — `Cannot find module './manager'`.

- [ ] **Step 5: Write the manager**

Create `src/main/updater/manager.ts`:

```ts
import { ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires the update lifecycle to `win`'s renderer and kicks off one launch-time
 * check. electron-updater no-ops `checkForUpdates()` in an unpackaged dev run
 * (no packaged app metadata to compare against), so this is safe to call
 * unconditionally from both `npm run dev` and a real install.
 */
export function attachAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = true

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    if (win.isDestroyed()) return
    win.webContents.send('updater:ready', info.version)
  })

  // Network errors, no-releases-yet, and dev-mode no-ops all land here — none of
  // them should be user-visible, since a failed background check just means
  // "still on the current version" and will retry on the next launch.
  autoUpdater.on('error', (err) => {
    console.warn('Auto-update check failed:', err)
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('Auto-update check failed:', err)
  })
}

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:restartNow', () => {
    autoUpdater.quitAndInstall()
  })
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/main/updater/manager.test.ts`
Expected: PASS (5/5)

- [ ] **Step 7: Commit**

```bash
git add src/shared/updater-types.ts src/main/updater/manager.ts src/main/updater/manager.test.ts package.json package-lock.json
git commit -m "feat: add the main-process auto-updater manager"
```

---

### Task 4: Wire the updater into the app entry point

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `attachAutoUpdater`, `registerUpdaterIpc` (Task 3).
- Produces: nothing new — this task only wires existing pieces together.

- [ ] **Step 1: Add the import**

In `src/main/index.ts`, add to the existing import block (after the `attachAdBlock` import):

```ts
import { attachAdBlock } from './adblock/session'
import { attachAutoUpdater, registerUpdaterIpc } from './updater/manager'
import { titleBarOverlayFor } from './titleBarOverlay'
```

- [ ] **Step 2: Register the IPC handler and attach the updater**

In `src/main/index.ts`, the existing registration block reads:

```ts
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  registerCredentialsIpc(vault, tabs)
  registerSettingsIpc(settings, applyTitleBarTheme)
  attachLockShortcut(win.webContents, lock)
  attachFillShortcut(win.webContents, requestFill)
  attachAdBlock(session.defaultSession, () => settings.get().adBlockEnabled)
```

Change it to:

```ts
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  registerCredentialsIpc(vault, tabs)
  registerSettingsIpc(settings, applyTitleBarTheme)
  registerUpdaterIpc()
  attachLockShortcut(win.webContents, lock)
  attachFillShortcut(win.webContents, requestFill)
  attachAdBlock(session.defaultSession, () => settings.get().adBlockEnabled)
  attachAutoUpdater(win)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0, all three bundles (`out/main`, `out/preload`, `out/renderer`) produced.

- [ ] **Step 5: Run the full test suite as a regression check**

Run: `npm test`
Expected: PASS — same or greater count than before this task, nothing newly failing.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: attach the auto-updater on startup"
```

---

### Task 5: Expose the updater to the renderer and show the restart banner

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/nyx-global.d.ts`
- Modify: `src/renderer/src/browser/BrowserChrome.tsx`

**Interfaces:**
- Consumes: `UpdaterApi` (Task 3), the existing `CredentialBanner` component (`src/renderer/src/credentials/CredentialBanner.tsx` — unchanged, reused as-is since its `{ message, actions }` props are already fully generic).
- Produces: `window.nyx.updater` available to the app-chrome renderer.

- [ ] **Step 1: Expose the API in the preload script**

In `src/preload/index.ts`, add the import and the new API object (after `settingsApi`, before the `contextBridge.exposeInMainWorld` call):

```ts
import type { UpdaterApi } from '../shared/updater-types'
```

```ts
const updaterApi: UpdaterApi = {
  onUpdateReady: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, version: string): void => callback(version)
    ipcRenderer.on('updater:ready', listener)
    return () => ipcRenderer.removeListener('updater:ready', listener)
  },
  restartNow: () => ipcRenderer.invoke('updater:restartNow')
}
```

Then change the `exposeInMainWorld` call from:

```ts
contextBridge.exposeInMainWorld('nyx', {
  vault: vaultApi,
  tabs: tabsApi,
  credentials: credentialsApi,
  settings: settingsApi
})
```

to:

```ts
contextBridge.exposeInMainWorld('nyx', {
  vault: vaultApi,
  tabs: tabsApi,
  credentials: credentialsApi,
  settings: settingsApi,
  updater: updaterApi
})
```

- [ ] **Step 2: Extend the renderer's global type**

In `src/renderer/src/nyx-global.d.ts`, add the import and extend the `Window.nyx` type:

```ts
import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'
import type { CredentialsApi } from '../../shared/credential-types'
import type { SettingsApi } from '../../shared/settings-types'
import type { UpdaterApi } from '../../shared/updater-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi; credentials: CredentialsApi; settings: SettingsApi; updater: UpdaterApi }
  }
}

export {}
```

- [ ] **Step 3: Add update-ready state and the subscription effect**

In `src/renderer/src/browser/BrowserChrome.tsx`, add a new piece of state alongside the existing ones (after `const [showSettings, setShowSettings] = useState(false)`):

```ts
  const [updateReady, setUpdateReady] = useState<string | null>(null)
```

Add a new effect alongside the other `useEffect(() => window.nyx...` subscriptions (near the `onSubmissionDetected`/`onFillRequested` effects):

```ts
  useEffect(() => window.nyx.updater.onUpdateReady((version) => setUpdateReady(version)), [])
```

- [ ] **Step 4: Render the banner**

In `src/renderer/src/browser/BrowserChrome.tsx`, the component currently ends with:

```tsx
      {/* Outside both branches on purpose: a rejected settings:update (disk full,
          permissions) sets `error` while the Settings panel is showing, and inside
          the chrome branch nothing ever rendered it — the panel showed the change
          as applied even though it never reached disk. */}
      {error && <p className="chrome-error">{error}</p>}
    </div>
  )
}
```

Change it to:

```tsx
      {/* Outside both branches on purpose: a rejected settings:update (disk full,
          permissions) sets `error` while the Settings panel is showing, and inside
          the chrome branch nothing ever rendered it — the panel showed the change
          as applied even though it never reached disk. Same reasoning applies to
          the update banner below. */}
      {error && <p className="chrome-error">{error}</p>}
      {/* Gated on the credential banners being absent: .credential-banner is an
          absolutely-positioned full-width bar, so an update banner and a fill/save
          prompt would render exactly on top of each other if both were shown at
          once. The credential prompt is time-sensitive (tied to what the user just
          did); updateReady simply stays true and reappears on the next render once
          neither prompt is pending. */}
      {updateReady && !fillConfirmPending && !saveCapture && (
        <CredentialBanner
          message={`Update ready (v${updateReady}) — restart to install`}
          actions={[
            {
              label: 'Restart Now',
              primary: true,
              onClick: () => run(() => window.nyx.updater.restartNow())
            },
            { label: 'Later', onClick: () => setUpdateReady(null) }
          ]}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 7: Run the full test suite as a regression check**

Run: `npm test`
Expected: PASS — same count as after Task 4, nothing newly failing (this task has no new automated tests of its own — see Global Constraints on renderer test infra).

- [ ] **Step 8: Commit**

```bash
git add src/preload/index.ts src/renderer/src/nyx-global.d.ts src/renderer/src/browser/BrowserChrome.tsx
git commit -m "feat: show a restart banner when an update is ready"
```

---

### Task 6: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run release` (Task 2).
- Produces: nothing consumed elsewhere in this plan — this is the terminal task.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - run: npm run typecheck

      - run: npm test

      - run: npm run release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Re-check the file by hand**

This workflow cannot run or be linted locally — GitHub Actions only executes on GitHub's infrastructure, and this environment has no way to simulate that. Re-read the file against the block above for exact 2-space indentation (no tabs) and correct nesting (`jobs.release.steps` as a list of `- uses:`/`- run:` entries). Confirm `secrets.GITHUB_TOKEN` is the only credential referenced anywhere in the file — no personal token, no hardcoded value.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish Windows releases to GitHub on tag push"
```

**Note for whoever executes this plan:** do not push a `v*` tag as part of implementing or reviewing this task. Pushing a tag triggers a real, publicly-visible release build and publish — that action is reserved for the user's own explicit go-ahead once this whole plan has landed, exactly like any other "visible to others" action.

---

## Self-Review

**Spec coverage:** Icon (Task 1) → electron-builder/NSIS config (Task 2) → auto-updater manager (Task 3) → main-process wiring (Task 4) → renderer banner (Task 5) → CI release workflow (Task 6). Every component listed in the spec's "Components" section has a task. The spec's "Known limitation to flag" (SmartScreen warning, no install/update round-trip testable in this sandbox) is carried into this plan's Global Constraints and each task's verification steps — nothing here attempts to test what the spec already says can't be tested here.

**Placeholder scan:** No TBD/TODO. Every step has literal, complete code or an exact command — nothing deferred to "add appropriate error handling" or "similar to Task N".

**Type consistency:** `UpdaterApi` is defined once in Task 3 and used identically (same method names, same signatures) in Task 3's manager, Task 5's preload wiring, and Task 5's `nyx-global.d.ts` extension. The IPC channel names (`'updater:ready'`, `'updater:restartNow'`) match exactly between Task 3 (main process) and Task 5 (preload). `attachAutoUpdater`/`registerUpdaterIpc` are named and called identically in Task 3 (defined) and Task 4 (imported and invoked).

**Deliberate simplification from the spec:** the spec described the icon as "a simple flat monogram (an 'N' on a filled circle)"; this plan implements just the filled circle, without an actual letter glyph. Rendering a crisp letterform from raw pixels (no canvas library, no font rasterizer) adds real complexity for a placeholder that is explicitly not real design work and is expected to be replaced. The circle-on-background result is still on-brand (uses the app's own accent/background colors) and trivially testable by exact pixel color, which a hand-drawn letter shape would not be without much more code.
