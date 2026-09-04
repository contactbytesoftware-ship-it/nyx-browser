# NYX Browser Phase 3 (Customization + Privacy — focused core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real Settings screen backed by a plaintext settings store, delivering theme customization (dark/light + accent), search engine management, and a basic hardcoded-domain ad/tracker blocker.

**Architecture:** Settings live outside the encrypted vault — a plaintext JSON file (`%APPDATA%/NYX Browser/settings.json`), loaded once at startup into an in-memory `SettingsManager`, available regardless of lock state. The Settings screen reuses `TabManager.hideActive()`/`showActive()` (already built for locking) to swap the active tab out while open — no new main-process view-management code. Ad-blocking is a hardcoded domain list matched against outgoing request hostnames via `session.webRequest`, not a filter-list engine.

**Tech Stack:** Same as Phases 1-2 — Electron + TypeScript, React, vitest. No new npm dependencies.

**Spec:** [docs/superpowers/specs/2026-09-04-nyx-browser-phase3-customization-design.md](../specs/2026-09-04-nyx-browser-phase3-customization-design.md)

## Global Constraints

- Settings are plaintext, not encrypted, and live outside `VaultContentsV1` entirely — no lock-state guards needed anywhere in this feature.
- No new npm dependencies.
- Not a full re-theme: only the dominant background/text/accent colors become CSS variables, not every hardcoded color in every component.
- The ad-block list is a hardcoded, curated set of real, well-known ad/tracker domains — not a filter-list engine, no network fetches.

---

### Task 1: Settings data model + store

**Files:**
- Create: `src/shared/settings-types.ts`
- Create: `src/main/settings/store.ts`
- Test: `src/main/settings/store.test.ts`

**Interfaces:**
- Produces (used by Tasks 2-6): `interface SearchEngineV1 { id: string; name: string; urlTemplate: string }`, `interface SettingsV1 { version: 1; theme: 'dark' | 'light'; accentColor: string; searchEngines: SearchEngineV1[]; defaultSearchEngineId: string; adBlockEnabled: boolean }`, `DEFAULT_SETTINGS: SettingsV1` (all in `src/shared/settings-types.ts`), `loadSettings(path: string): Promise<SettingsV1>`, `saveSettings(path: string, settings: SettingsV1): Promise<void>` (in `src/main/settings/store.ts`).
- `loadSettings` never throws — a missing file, a corrupt file, or a partial/old-shape file all resolve to `DEFAULT_SETTINGS` merged with whatever valid fields exist. Settings are not security-critical; failing open to defaults is the right behavior, unlike the vault's much stricter corrupt-file handling.

- [ ] **Step 1: Write `src/shared/settings-types.ts`**

```ts
export interface SearchEngineV1 {
  id: string
  name: string
  urlTemplate: string
}

export interface SettingsV1 {
  version: 1
  theme: 'dark' | 'light'
  accentColor: string
  searchEngines: SearchEngineV1[]
  defaultSearchEngineId: string
  adBlockEnabled: boolean
}

export const DEFAULT_SETTINGS: SettingsV1 = {
  version: 1,
  theme: 'dark',
  accentColor: '#6c4cf1',
  searchEngines: [{ id: 'brave', name: 'Brave Search', urlTemplate: 'https://search.brave.com/search?q=%s' }],
  defaultSearchEngineId: 'brave',
  adBlockEnabled: true
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/main/settings/store.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './store'
import { DEFAULT_SETTINGS } from '../../shared/settings-types'

describe('loadSettings', () => {
  it('returns defaults when no file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    expect(await loadSettings(join(dir, 'settings.json'))).toEqual(DEFAULT_SETTINGS)
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a saved settings object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    const custom = { ...DEFAULT_SETTINGS, theme: 'light' as const, accentColor: '#00ff00' }
    await saveSettings(path, custom)
    expect(await loadSettings(path)).toEqual(custom)
    await rm(dir, { recursive: true, force: true })
  })

  it('fills in missing fields from defaults when the file is a partial/old shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({ theme: 'light' }), 'utf8')
    const loaded = await loadSettings(path)
    expect(loaded.theme).toBe('light')
    expect(loaded.searchEngines).toEqual(DEFAULT_SETTINGS.searchEngines)
    await rm(dir, { recursive: true, force: true })
  })

  it('falls back to defaults when the file contains invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, 'not json', 'utf8')
    expect(await loadSettings(path)).toEqual(DEFAULT_SETTINGS)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('saveSettings', () => {
  it('writes atomically, leaving only the final file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await saveSettings(path, DEFAULT_SETTINGS)
    expect(await readdir(dir)).toEqual(['settings.json'])
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/settings/store.test.ts`
Expected: FAIL — `./store` module does not exist yet.

- [ ] **Step 4: Implement `src/main/settings/store.ts`**

```ts
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { SettingsV1 } from '../../shared/settings-types'
import { DEFAULT_SETTINGS } from '../../shared/settings-types'

export async function loadSettings(path: string): Promise<SettingsV1> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SettingsV1>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    // Missing file, corrupt JSON, or anything else unreadable: settings are not
    // security-critical, so fail open to defaults rather than blocking startup.
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(path: string, settings: SettingsV1): Promise<void> {
  const tmpPath = `${path}.tmp-${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf8')
  await rename(tmpPath, path)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/settings/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/settings-types.ts src/main/settings/store.ts src/main/settings/store.test.ts
git commit -m "feat: add settings data model and plaintext store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Search engine parameterization of the address bar

**Files:**
- Modify: `src/renderer/src/browser/resolveAddressBarInput.ts`
- Modify (test): `src/renderer/src/browser/resolveAddressBarInput.test.ts`
- Modify: `src/renderer/src/browser/AddressBar.tsx`

**Interfaces:**
- Produces (used by Task 6): `resolveAddressBarInput(input: string, searchUrlTemplate: string): string` — `searchUrlTemplate` must contain a literal `%s`, replaced with the URL-encoded query.
- Note: this changes an existing, already-tested function's signature. `AddressBar.tsx`'s one call site is updated in this same task to pass a hardcoded Brave template literal as a stopgap — Task 6 replaces that literal with the real settings-derived value once the Settings UI exists. This keeps the app buildable and behaviorally identical between this task and Task 6, rather than leaving a broken intermediate state.

- [ ] **Step 1: Write the failing tests**

Replace `src/renderer/src/browser/resolveAddressBarInput.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest'
import { resolveAddressBarInput } from './resolveAddressBarInput'

const BRAVE_TEMPLATE = 'https://search.brave.com/search?q=%s'

describe('resolveAddressBarInput', () => {
  it('passes through a full URL unchanged', () => {
    expect(resolveAddressBarInput('https://example.com', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('adds https:// to a bare domain', () => {
    expect(resolveAddressBarInput('example.com', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('preserves a path on a bare domain', () => {
    expect(resolveAddressBarInput('example.com/blog', BRAVE_TEMPLATE)).toBe('https://example.com/blog')
  })

  it('sends a single ambiguous word to the search template', () => {
    expect(resolveAddressBarInput('github', BRAVE_TEMPLATE)).toBe('https://search.brave.com/search?q=github')
  })

  it('sends a multi-word query to the search template', () => {
    expect(resolveAddressBarInput('how tall is the eiffel tower', BRAVE_TEMPLATE)).toBe(
      'https://search.brave.com/search?q=how%20tall%20is%20the%20eiffel%20tower'
    )
  })

  it('trims whitespace', () => {
    expect(resolveAddressBarInput('  example.com  ', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('substitutes into a non-Brave search template', () => {
    expect(resolveAddressBarInput('cats', 'https://duckduckgo.com/?q=%s')).toBe('https://duckduckgo.com/?q=cats')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/browser/resolveAddressBarInput.test.ts`
Expected: the 6 pre-existing-behavior tests FAIL (call site now passes 2 args, function still takes 1) or type-error; the new template test FAILs too — the function signature hasn't changed yet.

- [ ] **Step 3: Modify `src/renderer/src/browser/resolveAddressBarInput.ts`**

Replace the whole file:

```ts
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i

export function resolveAddressBarInput(input: string, searchUrlTemplate: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return ''
  if (URL_LIKE.test(trimmed)) return trimmed
  if (!trimmed.includes(' ') && DOMAIN_LIKE.test(trimmed)) return `https://${trimmed}`
  return searchUrlTemplate.replace('%s', encodeURIComponent(trimmed))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/browser/resolveAddressBarInput.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Update the one call site in `src/renderer/src/browser/AddressBar.tsx`**

Change:
```ts
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input)))
```
to:
```ts
    // TODO(Task 6): replace this hardcoded template with the user's configured
    // default search engine once the Settings screen exists.
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input, 'https://search.brave.com/search?q=%s')))
```

Nothing else in `AddressBar.tsx` changes.

- [ ] **Step 6: Verify the build is clean**

Run: `npm run build` — expect exit 0.
Run: `npm run typecheck` — expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/browser/resolveAddressBarInput.ts src/renderer/src/browser/resolveAddressBarInput.test.ts src/renderer/src/browser/AddressBar.tsx
git commit -m "feat: parameterize the address bar's search engine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Ad/tracker blocking (hardcoded domain list)

**Files:**
- Create: `src/main/adblock/blocklist.ts`
- Test: `src/main/adblock/blocklist.test.ts`
- Create: `src/main/adblock/session.ts`

**Interfaces:**
- Produces (used by Task 4): `AD_TRACKER_BLOCKLIST: readonly string[]`, `shouldBlockRequest(url: string, blocklist: readonly string[]): boolean`, `attachAdBlock(session: Electron.Session, isEnabled: () => boolean): void`.
- `attachAdBlock` is Electron-specific (`session.webRequest.onBeforeRequest`) with no automated test, same category as `TabManager`/`idle.ts` — verified via build/typecheck and manual trace when wired in Task 4. `shouldBlockRequest` is the pure, fully-tested part.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/adblock/blocklist.test.ts
import { describe, it, expect } from 'vitest'
import { shouldBlockRequest, AD_TRACKER_BLOCKLIST } from './blocklist'

describe('shouldBlockRequest', () => {
  it('blocks a request whose hostname exactly matches a blocklist entry', () => {
    expect(shouldBlockRequest('https://doubleclick.net/pixel', ['doubleclick.net'])).toBe(true)
  })

  it('blocks a subdomain of a blocklist entry', () => {
    expect(shouldBlockRequest('https://ad.doubleclick.net/pixel', ['doubleclick.net'])).toBe(true)
  })

  it('does not block an unrelated domain', () => {
    expect(shouldBlockRequest('https://example.com/pixel', ['doubleclick.net'])).toBe(false)
  })

  it('does not block a domain that merely contains a blocklist entry as a substring', () => {
    expect(shouldBlockRequest('https://notdoubleclick.net.example.com/x', ['doubleclick.net'])).toBe(false)
  })

  it('returns false for an unparseable URL rather than throwing', () => {
    expect(shouldBlockRequest('not a url', ['doubleclick.net'])).toBe(false)
  })

  it('ships a real, non-empty curated blocklist', () => {
    expect(AD_TRACKER_BLOCKLIST.length).toBeGreaterThan(30)
    expect(AD_TRACKER_BLOCKLIST).toContain('doubleclick.net')
    expect(AD_TRACKER_BLOCKLIST).toContain('google-analytics.com')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/adblock/blocklist.test.ts`
Expected: FAIL — `./blocklist` module does not exist yet.

- [ ] **Step 3: Implement `src/main/adblock/blocklist.ts`**

```ts
// A curated, hand-written set of well-known ad and tracking network hostnames —
// not a filter-list engine and not exhaustive. Catches the most common,
// widely-known trackers with zero dependencies and zero network calls. A real
// EasyList-compatible engine is a documented future upgrade, not this phase's job.
export const AD_TRACKER_BLOCKLIST: readonly string[] = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'adnxs.com',
  'scorecardresearch.com',
  'outbrain.com',
  'taboola.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'adsrvr.org',
  'moatads.com',
  'quantserve.com',
  'quantcount.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'adroll.com',
  'bluekai.com',
  'demdex.net',
  'mathtag.com',
  'agkn.com',
  'indexww.com',
  'contextweb.com',
  'smartadserver.com',
  'media.net',
  'yieldmo.com',
  'sharethrough.com',
  'spotxchange.com',
  'tremorhub.com',
  'adform.net',
  'adition.com',
  'advertising.com',
  'zedo.com',
  'adsafeprotected.com',
  'serving-sys.com',
  'flashtalking.com',
  'adcolony.com',
  'applovin.com',
  'vungle.com',
  'chartboost.com',
  'ironsrc.com',
  'tapjoy.com',
  'mopub.com',
  'inmobi.com',
  'startapp.com',
  'smaato.com',
  'krxd.net',
  'exelator.com',
  'tapad.com',
  'id5-sync.com'
]

export function shouldBlockRequest(url: string, blocklist: readonly string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return blocklist.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/adblock/blocklist.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Implement `src/main/adblock/session.ts`** (no test — Electron-specific, verified when wired in Task 4)

```ts
import type { Session } from 'electron'
import { AD_TRACKER_BLOCKLIST, shouldBlockRequest } from './blocklist'

export function attachAdBlock(session: Session, isEnabled: () => boolean): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    if (isEnabled() && shouldBlockRequest(details.url, AD_TRACKER_BLOCKLIST)) {
      callback({ cancel: true })
      return
    }
    callback({ cancel: false })
  })
}
```

- [ ] **Step 6: Verify the build is clean**

Run: `npm run build` — expect exit 0.
Run: `npm run typecheck` — expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/adblock/blocklist.ts src/main/adblock/blocklist.test.ts src/main/adblock/session.ts
git commit -m "feat: add hardcoded ad/tracker domain blocklist and webRequest wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: SettingsManager, Settings IPC, tab visibility IPC, and full wiring

**Files:**
- Create: `src/main/settings/manager.ts`
- Test: `src/main/settings/manager.test.ts`
- Create: `src/main/settings/ipc.ts`
- Modify: `src/shared/settings-types.ts`
- Modify: `src/shared/tab-types.ts`
- Modify: `src/main/tabs/ipc.ts`
- Modify: `src/preload/index.ts` (full file replacement)
- Modify: `src/renderer/src/nyx-global.d.ts` (full file replacement)
- Modify: `src/main/index.ts` (full file replacement)

**Interfaces:**
- Consumes: `loadSettings`/`saveSettings` (Task 1), `attachAdBlock` (Task 3).
- Produces (used by Tasks 5-6): `window.nyx.settings`, typed as `SettingsApi` (`get`, `update`), `window.nyx.tabs.hideActive()`/`showActive()`.
- Design note: `SettingsManager` mirrors `VaultManager`'s "load once, keep in memory, write-through on update" shape, but with none of the lock-state complexity — settings are never encrypted and never gated.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/settings/manager.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from './manager'
import { DEFAULT_SETTINGS } from '../../shared/settings-types'

describe('SettingsManager', () => {
  it('starts with defaults when no settings file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-mgr-'))
    const manager = await SettingsManager.create(join(dir, 'settings.json'))
    expect(manager.get()).toEqual(DEFAULT_SETTINGS)
    await rm(dir, { recursive: true, force: true })
  })

  it('reflects an update immediately', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-mgr-'))
    const manager = await SettingsManager.create(join(dir, 'settings.json'))
    const updated = { ...DEFAULT_SETTINGS, theme: 'light' as const }
    await manager.update(updated)
    expect(manager.get()).toEqual(updated)
    await rm(dir, { recursive: true, force: true })
  })

  it('persists an update to disk for the next instance to read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-mgr-'))
    const path = join(dir, 'settings.json')
    const first = await SettingsManager.create(path)
    await first.update({ ...DEFAULT_SETTINGS, adBlockEnabled: false })
    const second = await SettingsManager.create(path)
    expect(second.get().adBlockEnabled).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/settings/manager.test.ts`
Expected: FAIL — `./manager` module does not exist yet.

- [ ] **Step 3: Implement `src/main/settings/manager.ts`**

```ts
import { loadSettings, saveSettings } from './store'
import type { SettingsV1 } from '../../shared/settings-types'

export class SettingsManager {
  private constructor(
    private readonly path: string,
    private current: SettingsV1
  ) {}

  static async create(path: string): Promise<SettingsManager> {
    return new SettingsManager(path, await loadSettings(path))
  }

  get(): SettingsV1 {
    return this.current
  }

  async update(next: SettingsV1): Promise<void> {
    await saveSettings(this.path, next)
    this.current = next
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/settings/manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `SettingsApi` to `src/shared/settings-types.ts`**

Append to the file (the existing `SearchEngineV1`/`SettingsV1`/`DEFAULT_SETTINGS` from Task 1 are unchanged):

```ts
export interface SettingsApi {
  get(): Promise<SettingsV1>
  update(settings: SettingsV1): Promise<void>
}
```

- [ ] **Step 6: Implement `src/main/settings/ipc.ts`**

```ts
import { ipcMain } from 'electron'
import { SettingsManager } from './manager'
import type { SettingsV1 } from '../../shared/settings-types'

export function registerSettingsIpc(settings: SettingsManager): void {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:update', (_e, next: SettingsV1) => settings.update(next))
}
```

- [ ] **Step 7: Add `hideActive`/`showActive` to `TabsApi` in `src/shared/tab-types.ts`**

Change:
```ts
export interface TabsApi {
  list(): Promise<TabInfo[]>
  create(url: string): Promise<number>
  activate(id: number): Promise<void>
  close(id: number): Promise<void>
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  onChanged(callback: (tabs: TabInfo[]) => void): () => void
}
```
to:
```ts
export interface TabsApi {
  list(): Promise<TabInfo[]>
  create(url: string): Promise<number>
  activate(id: number): Promise<void>
  close(id: number): Promise<void>
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  hideActive(): Promise<void>
  showActive(): Promise<void>
  onChanged(callback: (tabs: TabInfo[]) => void): () => void
}
```
(`TabInfo` is unchanged.)

- [ ] **Step 8: Add two handlers to `src/main/tabs/ipc.ts`**

The current file:
```ts
import { ipcMain, BrowserWindow } from 'electron'
import { TabManager } from './manager'

export function registerTabsIpc(win: BrowserWindow, tabs: TabManager): void {
  tabs.on('changed', (list) => win.webContents.send('tabs:changed', list))

  ipcMain.handle('tabs:list', () => tabs.list())
  ipcMain.handle('tabs:create', (_e, url: string) => tabs.createTab(url))
  ipcMain.handle('tabs:activate', (_e, id: number) => tabs.activateTab(id))
  ipcMain.handle('tabs:close', (_e, id: number) => tabs.closeTab(id))
  ipcMain.handle('tabs:navigate', (_e, id: number, url: string) => tabs.navigate(id, url))
  ipcMain.handle('tabs:goBack', (_e, id: number) => tabs.goBack(id))
  ipcMain.handle('tabs:goForward', (_e, id: number) => tabs.goForward(id))
  ipcMain.handle('tabs:reload', (_e, id: number) => tabs.reload(id))
}
```
Add these two lines right before the closing `}`:
```ts
  ipcMain.handle('tabs:hideActive', () => tabs.hideActive())
  ipcMain.handle('tabs:showActive', () => tabs.showActive())
```
Nothing else in the file changes.

- [ ] **Step 9: Replace `src/preload/index.ts` entirely**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'
import type { CredentialsApi } from '../shared/credential-types'
import type { SettingsApi } from '../shared/settings-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  unlockComplete: () => ipcRenderer.invoke('vault:unlockComplete'),
  lock: () => ipcRenderer.invoke('vault:lock'),
  onLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:locked', listener)
    return () => ipcRenderer.removeListener('vault:locked', listener)
  }
}

const tabsApi: TabsApi = {
  list: () => ipcRenderer.invoke('tabs:list'),
  create: (url) => ipcRenderer.invoke('tabs:create', url),
  activate: (id) => ipcRenderer.invoke('tabs:activate', id),
  close: (id) => ipcRenderer.invoke('tabs:close', id),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', id, url),
  goBack: (id) => ipcRenderer.invoke('tabs:goBack', id),
  goForward: (id) => ipcRenderer.invoke('tabs:goForward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  hideActive: () => ipcRenderer.invoke('tabs:hideActive'),
  showActive: () => ipcRenderer.invoke('tabs:showActive'),
  onChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, tabs: TabInfo[]): void => callback(tabs)
    ipcRenderer.on('tabs:changed', listener)
    return () => ipcRenderer.removeListener('tabs:changed', listener)
  }
}

const credentialsApi: CredentialsApi = {
  list: () => ipcRenderer.invoke('credentials:list'),
  getForDomain: (domain) => ipcRenderer.invoke('credentials:getForDomain', domain),
  save: (domain, username, password, notes) =>
    ipcRenderer.invoke('credentials:save', domain, username, password, notes),
  delete: (id) => ipcRenderer.invoke('credentials:delete', id),
  fill: (domain) => ipcRenderer.invoke('credentials:fill', domain),
  onSubmissionDetected: (callback) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      capture: { domain: string; username: string; password: string }
    ): void => callback(capture)
    ipcRenderer.on('credentials:submissionDetected', listener)
    return () => ipcRenderer.removeListener('credentials:submissionDetected', listener)
  },
  onFillRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('credentials:fillRequested', listener)
    return () => ipcRenderer.removeListener('credentials:fillRequested', listener)
  }
}

const settingsApi: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (settings) => ipcRenderer.invoke('settings:update', settings)
}

contextBridge.exposeInMainWorld('nyx', {
  vault: vaultApi,
  tabs: tabsApi,
  credentials: credentialsApi,
  settings: settingsApi
})
```

- [ ] **Step 10: Replace `src/renderer/src/nyx-global.d.ts` entirely**

```ts
import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'
import type { CredentialsApi } from '../../shared/credential-types'
import type { SettingsApi } from '../../shared/settings-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi; credentials: CredentialsApi; settings: SettingsApi }
  }
}

export {}
```

- [ ] **Step 11: Replace `src/main/index.ts` entirely**

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'
import { registerCredentialsIpc } from './credentials/ipc'
import { attachCredentialCapture } from './credentials/domActions'
import { attachLockShortcut, attachFillShortcut } from './shortcuts'
import { startIdleWatcher, DEFAULT_IDLE_TIMEOUT_SECONDS } from './idle'
import { SettingsManager } from './settings/manager'
import { registerSettingsIpc } from './settings/ipc'
import { attachAdBlock } from './adblock/session'

// Must run before anything reads app.getPath('userData'), which is derived from
// the app name — so at module scope, not inside app.whenReady().
app.setName('NYX Browser')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  const settings = await SettingsManager.create(join(app.getPath('userData'), 'settings.json'))
  const win = createWindow()

  let tabs: TabManager
  const lock = (): void => {
    if (!vault.isUnlocked) return
    vault.lock()
    tabs.hideActive()
    win.webContents.send('vault:locked')
  }
  const unlock = (): void => {
    tabs.showActive()
  }
  const requestFill = (): void => {
    win.webContents.send('credentials:fillRequested')
  }

  tabs = new TabManager(win, (wc) => {
    attachLockShortcut(wc, lock)
    attachFillShortcut(wc, requestFill)
    // Tabs stay alive after a lock (hideActive only detaches the view), so they can
    // still navigate — but a locked vault must not keep extracting plaintext
    // passwords out of background pages.
    attachCredentialCapture(
      wc,
      (capture) => {
        // Re-checked here too: the capture is async, so the vault can lock between
        // the navigation gate above and this callback resolving.
        if (!vault.isUnlocked) return
        win.webContents.send('credentials:submissionDetected', capture)
      },
      () => vault.isUnlocked
    )
  })
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  registerCredentialsIpc(vault, tabs)
  registerSettingsIpc(settings)
  attachLockShortcut(win.webContents, lock)
  attachFillShortcut(win.webContents, requestFill)
  attachAdBlock(session.defaultSession, () => settings.get().adBlockEnabled)

  const stopIdleWatcher = startIdleWatcher(DEFAULT_IDLE_TIMEOUT_SECONDS, lock)
  win.on('closed', stopIdleWatcher)

  // Zero the in-memory vault key on quit, per the spec's key-hygiene requirement.
  app.on('will-quit', () => vault.lock())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 12: Verify**

Run: `npm test` — expect no regressions (all prior tests still pass, plus this task's 3 new).
Run: `npm run build` — expect exit 0.
Run: `npm run typecheck` — expect exit 0.

Manually trace (no GUI available, same standing limitation as every Electron-wiring task in this project): `settings:get`/`settings:update` channel names match exactly between `settings/ipc.ts` and `preload/index.ts`; `tabs:hideActive`/`tabs:showActive` likewise; `attachAdBlock(session.defaultSession, ...)` is actually called; `SettingsManager.create(...)` is awaited before anything that needs `settings.get()` runs.

- [ ] **Step 13: Commit**

```bash
git add src/main/settings/manager.ts src/main/settings/manager.test.ts src/main/settings/ipc.ts src/shared/settings-types.ts src/shared/tab-types.ts src/main/tabs/ipc.ts src/preload/index.ts src/renderer/src/nyx-global.d.ts src/main/index.ts
git commit -m "feat: wire settings IPC, tab-visibility IPC, and ad-block into main process

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Theme CSS variables

**Files:**
- Create: `src/renderer/src/applyTheme.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/global.css`
- Modify: `src/renderer/src/browser/browser.css`
- Modify: `src/renderer/src/auth/auth.css`

**Interfaces:**
- Consumes: `window.nyx.settings.get()` (Task 4).
- Produces: CSS custom properties `--bg`, `--bg-secondary`, `--text`, `--border`, `--accent`, set on `document.documentElement` — consumed by Tasks 6's Settings UI (any new component should use these variables, not hardcoded colors) and retroactively by the existing CSS files this task edits.
- Correction from the spec: settings are plaintext and available before unlock (that was the whole reason to move them outside the vault), so theme customization is NOT limited to the unlocked browser chrome as the spec's background section speculated — `auth.css` is themed too, for a consistent experience across the whole app.
- No automated test — `applyTheme` mutates `document.documentElement.style`, which needs a real DOM; adding `jsdom` just for this one function would be a new dependency for no other benefit, so (matching every other DOM-touching piece of this project) it's verified via build/typecheck and manual trace instead.

- [ ] **Step 1: Implement `src/renderer/src/applyTheme.ts`**

```ts
import type { SettingsV1 } from '../../shared/settings-types'

const PALETTES = {
  dark: { bg: '#1a1a1d', bgSecondary: '#111113', text: '#e6e6e6', border: '#333333' },
  light: { bg: '#f5f5f7', bgSecondary: '#ffffff', text: '#1a1a1d', border: '#d0d0d5' }
} as const

export function applyTheme(settings: Pick<SettingsV1, 'theme' | 'accentColor'>): void {
  const palette = PALETTES[settings.theme]
  const root = document.documentElement.style
  root.setProperty('--bg', palette.bg)
  root.setProperty('--bg-secondary', palette.bgSecondary)
  root.setProperty('--text', palette.text)
  root.setProperty('--border', palette.border)
  root.setProperty('--accent', settings.accentColor)
}
```

- [ ] **Step 2: Wire it into `src/renderer/src/main.tsx`**

The current file:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './global.css'
import { CHROME_HEIGHT } from '../../shared/layout'
import App from './App'

// Publish the shared chrome height to CSS so browser.css and the main process's
// WebContentsView bounds cannot drift apart.
document.documentElement.style.setProperty('--chrome-height', `${CHROME_HEIGHT}px`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```
Add one import and one line (right after the `--chrome-height` line, before `ReactDOM.createRoot`):
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './global.css'
import { CHROME_HEIGHT } from '../../shared/layout'
import { applyTheme } from './applyTheme'
import App from './App'

// Publish the shared chrome height to CSS so browser.css and the main process's
// WebContentsView bounds cannot drift apart.
document.documentElement.style.setProperty('--chrome-height', `${CHROME_HEIGHT}px`)

// Settings are plaintext (not behind the vault lock), so the theme can apply
// immediately — including on the auth screens, before any unlock happens.
window.nyx.settings.get().then(applyTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: Convert the dominant hardcoded colors to variables**

In `src/renderer/src/global.css`, change:
```css
body {
  background: #1a1a1d;
}
```
to:
```css
body {
  background: var(--bg, #1a1a1d);
}
```

In `src/renderer/src/browser/browser.css`, change:
```css
.browser-chrome {
  position: relative;
  display: flex;
  flex-direction: column;
  /* Set from src/shared/layout.ts in main.tsx; must match the main process's
     CHROME_HEIGHT or the tab WebContentsView stops lining up with the chrome. */
  height: var(--chrome-height, 88px);
  background: #1a1a1d;
  color: #e6e6e6;
  font-family: system-ui, sans-serif;
}
```
to:
```css
.browser-chrome {
  position: relative;
  display: flex;
  flex-direction: column;
  /* Set from src/shared/layout.ts in main.tsx; must match the main process's
     CHROME_HEIGHT or the tab WebContentsView stops lining up with the chrome. */
  height: var(--chrome-height, 88px);
  background: var(--bg, #1a1a1d);
  color: var(--text, #e6e6e6);
  font-family: system-ui, sans-serif;
}
```

Also in `browser.css`, change:
```css
.address-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 8px;
  background: #111113;
}
```
to:
```css
.address-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 8px;
  background: var(--bg-secondary, #111113);
}
```

And change:
```css
.credential-banner-primary {
  background: #6c4cf1;
  color: white;
}
```
to:
```css
.credential-banner-primary {
  background: var(--accent, #6c4cf1);
  color: white;
}
```

In `src/renderer/src/auth/auth.css`, change:
```css
.auth-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
  margin: 10vh auto;
  padding: 24px;
  color: #e6e6e6;
  font-family: system-ui, sans-serif;
}
```
to:
```css
.auth-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
  margin: 10vh auto;
  padding: 24px;
  color: var(--text, #e6e6e6);
  font-family: system-ui, sans-serif;
}
```

Change:
```css
.auth-screen input {
  background: #1c1c1f;
  border: 1px solid #333;
  color: #e6e6e6;
  padding: 10px;
  border-radius: 6px;
  font-size: 14px;
}
```
to:
```css
.auth-screen input {
  background: var(--bg-secondary, #1c1c1f);
  border: 1px solid var(--border, #333);
  color: var(--text, #e6e6e6);
  padding: 10px;
  border-radius: 6px;
  font-size: 14px;
}
```

Change:
```css
.auth-screen button {
  background: #6c4cf1;
  color: white;
  border: none;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
```
to:
```css
.auth-screen button {
  background: var(--accent, #6c4cf1);
  color: white;
  border: none;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
```

Change:
```css
.auth-screen code {
  background: #1c1c1f;
  padding: 8px;
  border-radius: 6px;
  word-break: break-all;
  font-size: 13px;
}
```
to:
```css
.auth-screen code {
  background: var(--bg-secondary, #1c1c1f);
  padding: 8px;
  border-radius: 6px;
  word-break: break-all;
  font-size: 13px;
}
```

Nothing else in any of these four CSS files changes — tab colors, buttons other than the ones listed, the error/banner styling beyond `.credential-banner-primary`, etc. all stay exactly as they are, per the spec's "not a full re-theme" scoping.

- [ ] **Step 4: Verify**

Run: `npm run build` — expect exit 0.
Run: `npm run typecheck` — expect exit 0.

Manually trace: `applyTheme` is called with the real settings object shape (`theme`/`accentColor` fields) after `window.nyx.settings.get()` resolves; every `var(--x, fallback)` has a matching `setProperty('--x', ...)` call in `applyTheme` (so a slow/failed settings load still renders correctly via the fallback values, which are the original hardcoded colors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/applyTheme.ts src/renderer/src/main.tsx src/renderer/src/global.css src/renderer/src/browser/browser.css src/renderer/src/auth/auth.css
git commit -m "feat: add theme CSS variables and apply dark/light + accent from settings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings UI

**Files:**
- Create: `src/renderer/src/settings/SettingsPanel.tsx`
- Create: `src/renderer/src/settings/settings.css`
- Modify: `src/renderer/src/browser/TabStrip.tsx`
- Modify: `src/renderer/src/browser/browser.css`
- Modify: `src/renderer/src/browser/AddressBar.tsx`
- Modify: `src/renderer/src/browser/BrowserChrome.tsx` (full file replacement)

**Interfaces:**
- Consumes: `window.nyx.settings`/`window.nyx.tabs.hideActive/showActive` (Task 4), `applyTheme` (Task 5), `resolveAddressBarInput`'s new signature (Task 2).
- Produces: nothing further consumes this — it's the top of the settings feature and the last task of Phase 3.
- Settings persist on every change (no separate Save/Cancel step) — theme changes apply live via `applyTheme` at the same time, giving an immediate preview. This is safe because nothing in `SettingsV1` is sensitive.
- This task has no automated test (React UI wired to real IPC, same category as every prior UI task in this project) — verified via `npm run build`/`npm run typecheck`/`npm test` plus manual trace, with the same standing caveat as always: no GUI/display server has been available anywhere in this process.

- [ ] **Step 1: Implement `src/renderer/src/settings/SettingsPanel.tsx`**

```tsx
import { useState } from 'react'
import type { SettingsV1, SearchEngineV1 } from '../../../shared/settings-types'
import './settings.css'

interface SettingsPanelProps {
  settings: SettingsV1
  onChange: (settings: SettingsV1) => void
  onClose: () => void
}

const ACCENT_SWATCHES = ['#6c4cf1', '#e0575b', '#3aa76d', '#dba13a', '#3a8ee0']

export default function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps): JSX.Element {
  const [newEngineName, setNewEngineName] = useState('')
  const [newEngineUrl, setNewEngineUrl] = useState('')

  function addSearchEngine(): void {
    if (!newEngineName.trim() || !newEngineUrl.includes('%s')) return
    const engine: SearchEngineV1 = {
      id: crypto.randomUUID(),
      name: newEngineName.trim(),
      urlTemplate: newEngineUrl.trim()
    }
    onChange({ ...settings, searchEngines: [...settings.searchEngines, engine] })
    setNewEngineName('')
    setNewEngineUrl('')
  }

  function removeSearchEngine(id: string): void {
    const remaining = settings.searchEngines.filter((e) => e.id !== id)
    if (remaining.length === 0) return // always keep at least one search engine
    const defaultId = settings.defaultSearchEngineId === id ? remaining[0].id : settings.defaultSearchEngineId
    onChange({ ...settings, searchEngines: remaining, defaultSearchEngineId: defaultId })
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h1>Settings</h1>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>

      <section className="settings-section">
        <h2>Theme</h2>
        <div className="settings-row">
          <button
            type="button"
            className={settings.theme === 'dark' ? 'settings-choice-active' : ''}
            onClick={() => onChange({ ...settings, theme: 'dark' })}
          >
            Dark
          </button>
          <button
            type="button"
            className={settings.theme === 'light' ? 'settings-choice-active' : ''}
            onClick={() => onChange({ ...settings, theme: 'light' })}
          >
            Light
          </button>
        </div>
        <div className="settings-row">
          {ACCENT_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`settings-swatch${settings.accentColor === color ? ' settings-swatch-active' : ''}`}
              style={{ background: color }}
              aria-label={`Accent color ${color}`}
              onClick={() => onChange({ ...settings, accentColor: color })}
            />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Search Engines</h2>
        {settings.searchEngines.map((engine) => (
          <div key={engine.id} className="settings-row">
            <label>
              <input
                type="radio"
                name="defaultSearchEngine"
                checked={settings.defaultSearchEngineId === engine.id}
                onChange={() => onChange({ ...settings, defaultSearchEngineId: engine.id })}
              />{' '}
              {engine.name}
            </label>
            <span className="settings-engine-template">{engine.urlTemplate}</span>
            <button type="button" onClick={() => removeSearchEngine(engine.id)}>
              Remove
            </button>
          </div>
        ))}
        <div className="settings-row">
          <input placeholder="Name" value={newEngineName} onChange={(e) => setNewEngineName(e.target.value)} />
          <input
            placeholder="URL template, use %s for the query"
            value={newEngineUrl}
            onChange={(e) => setNewEngineUrl(e.target.value)}
          />
          <button type="button" onClick={addSearchEngine}>
            Add
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Privacy</h2>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.adBlockEnabled}
            onChange={(e) => onChange({ ...settings, adBlockEnabled: e.target.checked })}
          />{' '}
          Block known ad and tracker domains
        </label>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Implement `src/renderer/src/settings/settings.css`**

```css
.settings-panel {
  height: 100%;
  overflow-y: auto;
  background: var(--bg, #1a1a1d);
  color: var(--text, #e6e6e6);
  font-family: system-ui, sans-serif;
  padding: 24px;
  box-sizing: border-box;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.settings-header h1 {
  font-size: 20px;
  margin: 0;
}

.settings-header button {
  background: var(--accent, #6c4cf1);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.settings-section {
  max-width: 480px;
  margin-bottom: 32px;
}

.settings-section h2 {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text, #e6e6e6);
  opacity: 0.6;
  margin: 0 0 12px;
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.settings-row input[type='text'],
.settings-row input:not([type]) {
  flex: 1;
  background: var(--bg-secondary, #111113);
  border: 1px solid var(--border, #333);
  color: var(--text, #e6e6e6);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
}

.settings-row button {
  background: var(--bg-secondary, #111113);
  border: 1px solid var(--border, #333);
  color: var(--text, #e6e6e6);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.settings-choice-active {
  background: var(--accent, #6c4cf1) !important;
  color: white;
  border-color: var(--accent, #6c4cf1) !important;
}

.settings-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.settings-swatch-active {
  border-color: var(--text, #e6e6e6);
}

.settings-engine-template {
  flex: 1;
  font-size: 11px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Add a "Settings" button to `src/renderer/src/browser/TabStrip.tsx`**

Replace the whole file:

```tsx
import type { TabInfo } from '../../../shared/tab-types'

interface TabStripProps {
  tabs: TabInfo[]
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onNewTab: () => void
  onLock: () => void
  onOpenSettings: () => void
}

export default function TabStrip({
  tabs,
  onActivate,
  onClose,
  onNewTab,
  onLock,
  onOpenSettings
}: TabStripProps): JSX.Element {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div key={tab.id} className={`tab${tab.isActive ? ' tab-active' : ''}`} onClick={() => onActivate(tab.id)}>
          <span className="tab-title">{tab.isLoading ? 'Loading…' : tab.title}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" aria-label="New tab" onClick={onNewTab}>
        +
      </button>
      <button className="tab-settings" aria-label="Settings" onClick={onOpenSettings}>
        Settings
      </button>
      <button className="tab-lock" aria-label="Lock NYX Browser" onClick={onLock}>
        Lock
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Add the `.tab-settings` style to `src/renderer/src/browser/browser.css`**

Add right after the existing `.tab-lock` rule:

```css
.tab-settings {
  background: #26262b;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 5: Wire the real search engine template into `src/renderer/src/browser/AddressBar.tsx`**

Change the props interface from:
```tsx
interface AddressBarProps {
  tab: TabInfo | null
  /** Runs an IPC call, surfacing a rejection instead of leaving it unhandled. */
  onRun: (action: () => Promise<unknown>) => void
  hasCredential: boolean
  onFillRequest: () => void
}
```
to:
```tsx
interface AddressBarProps {
  tab: TabInfo | null
  /** Runs an IPC call, surfacing a rejection instead of leaving it unhandled. */
  onRun: (action: () => Promise<unknown>) => void
  hasCredential: boolean
  onFillRequest: () => void
  searchUrlTemplate: string
}
```

Change the component signature from `export default function AddressBar({ tab, onRun, hasCredential, onFillRequest }: AddressBarProps): JSX.Element {` to `export default function AddressBar({ tab, onRun, hasCredential, onFillRequest, searchUrlTemplate }: AddressBarProps): JSX.Element {`.

Change `handleSubmit` from (this replaces Task 2's stopgap literal):
```ts
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    // TODO(Task 6): replace this hardcoded template with the user's configured
    // default search engine once the Settings screen exists.
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input, 'https://search.brave.com/search?q=%s')))
  }
```
to:
```ts
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input, searchUrlTemplate)))
  }
```

Nothing else in the file changes.

- [ ] **Step 6: Replace `src/renderer/src/browser/BrowserChrome.tsx` entirely**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import type { CredentialV1 } from '../../../shared/credential-types'
import type { SettingsV1 } from '../../../shared/settings-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import CredentialBanner from '../credentials/CredentialBanner'
import SettingsPanel from '../settings/SettingsPanel'
import { extractHostname } from '../credentials/extractHostname'
import { applyTheme } from '../applyTheme'
import { GENERIC_ERROR } from '../errors'
import './browser.css'

const ERROR_DISMISS_MS = 5000
const DEFAULT_SEARCH_TEMPLATE = 'https://search.brave.com/search?q=%s'

interface SubmissionCapture {
  domain: string
  username: string
  password: string
}

function defaultSearchUrlTemplate(current: SettingsV1 | null): string {
  if (!current) return DEFAULT_SEARCH_TEMPLATE
  const engine = current.searchEngines.find((e) => e.id === current.defaultSearchEngineId)
  return engine?.urlTemplate ?? DEFAULT_SEARCH_TEMPLATE
}

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState('')
  const [activeCredential, setActiveCredential] = useState<CredentialV1 | null>(null)
  const [fillConfirmPending, setFillConfirmPending] = useState(false)
  const [saveCapture, setSaveCapture] = useState<SubmissionCapture | null>(null)
  const [settings, setSettings] = useState<SettingsV1 | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  /**
   * Runs a fire-and-forget IPC call. Without this, a main-process throw becomes an
   * unhandled promise rejection and the control simply appears to do nothing.
   */
  const run = useCallback((action: () => Promise<unknown>): void => {
    action().catch(() => setError(GENERIC_ERROR))
  }, [])

  useEffect(() => {
    if (!error) return undefined
    const timer = setTimeout(() => setError(''), ERROR_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    window.nyx.settings.get().then(setSettings).catch(() => setError(GENERIC_ERROR))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadTabs(): Promise<void> {
      try {
        const existing = await window.nyx.tabs.list()
        if (cancelled) return
        if (existing.length === 0) {
          await window.nyx.tabs.create('https://search.brave.com')
        } else {
          setTabs(existing)
        }
      } catch {
        if (!cancelled) setError(GENERIC_ERROR)
      }
    }

    void loadTabs()
    const unsubscribe = window.nyx.tabs.onChanged((updated) => {
      if (!cancelled) setTabs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null

  useEffect(() => {
    const domain = activeTab ? extractHostname(activeTab.url) : null
    if (!domain) {
      setActiveCredential(null)
      return undefined
    }
    let cancelled = false
    window.nyx.credentials
      .getForDomain(domain)
      .then((credential) => {
        if (!cancelled) setActiveCredential(credential)
      })
      .catch((err) => {
        // "No saved login" is a resolved null, not a rejection — a rejection here
        // means the IPC call itself failed (e.g. the vault locked mid-lookup), so
        // make it visible in DevTools instead of silently indistinguishable.
        console.warn('Failed to look up saved credential for domain:', err)
        if (!cancelled) setActiveCredential(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab?.url])

  useEffect(() => window.nyx.credentials.onSubmissionDetected((capture) => setSaveCapture(capture)), [])

  useEffect(
    () =>
      window.nyx.credentials.onFillRequested(() => {
        setFillConfirmPending((pending) => pending || activeCredential !== null)
      }),
    [activeCredential]
  )

  useEffect(() => {
    if (activeCredential === null) setFillConfirmPending(false)
  }, [activeCredential])

  function openSettings(): void {
    run(() => window.nyx.tabs.hideActive())
    setShowSettings(true)
  }

  function closeSettings(): void {
    run(() => window.nyx.tabs.showActive())
    setShowSettings(false)
  }

  function handleSettingsChange(next: SettingsV1): void {
    setSettings(next)
    applyTheme(next)
    run(() => window.nyx.settings.update(next))
  }

  if (showSettings && settings) {
    return <SettingsPanel settings={settings} onChange={handleSettingsChange} onClose={closeSettings} />
  }

  return (
    <div className="browser-chrome">
      <TabStrip
        tabs={tabs}
        onActivate={(id) => run(() => window.nyx.tabs.activate(id))}
        onClose={(id) => run(() => window.nyx.tabs.close(id))}
        onNewTab={() => run(() => window.nyx.tabs.create('https://search.brave.com'))}
        onLock={() => run(() => window.nyx.vault.lock())}
        onOpenSettings={openSettings}
      />
      <AddressBar
        tab={activeTab}
        onRun={run}
        hasCredential={activeCredential !== null}
        onFillRequest={() => setFillConfirmPending(true)}
        searchUrlTemplate={defaultSearchUrlTemplate(settings)}
      />
      {fillConfirmPending && activeCredential && (
        <CredentialBanner
          message={`Fill saved login for ${activeCredential.domain}?`}
          actions={[
            {
              label: 'Fill',
              primary: true,
              onClick: () => {
                setFillConfirmPending(false)
                run(() => window.nyx.credentials.fill(activeCredential.domain))
              }
            },
            { label: 'Cancel', onClick: () => setFillConfirmPending(false) }
          ]}
        />
      )}
      {!fillConfirmPending && saveCapture && (
        <CredentialBanner
          message={`Save password for ${saveCapture.domain}?`}
          actions={[
            {
              label: 'Save',
              primary: true,
              onClick: () => {
                const capture = saveCapture
                setSaveCapture(null)
                run(async () => {
                  const credential = await window.nyx.credentials.save(
                    capture.domain,
                    capture.username,
                    capture.password
                  )
                  setActiveCredential(credential)
                })
              }
            },
            { label: 'Not now', onClick: () => setSaveCapture(null) }
          ]}
        />
      )}
      {error && <p className="chrome-error">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Verify**

Run: `npm test` — expect no regressions (all tests from Phases 1-2 plus this phase's new ones still pass).
Run: `npm run build` — expect exit 0.
Run: `npm run typecheck` — expect exit 0.

Manually trace (no GUI available, same standing limitation as this whole project): clicking "Settings" calls `hideActive()` before showing the panel, and "Done" calls `showActive()` before hiding it — so a tab's content is never visible underneath the panel and is correctly restored afterward; `defaultSearchUrlTemplate` falls back to the Brave template when `settings` hasn't loaded yet or the configured default engine was somehow removed; removing the last search engine is a no-op (never leaves zero engines).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/settings/SettingsPanel.tsx src/renderer/src/settings/settings.css src/renderer/src/browser/TabStrip.tsx src/renderer/src/browser/browser.css src/renderer/src/browser/AddressBar.tsx src/renderer/src/browser/BrowserChrome.tsx
git commit -m "feat: add Settings UI (theme, search engines, ad-block toggle)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Phase 3 complete

At this point: a Settings screen (reachable via a tab-strip button) lets you switch dark/light theme with a live-previewed accent color, manage search engines (Brave is the default, add/remove others, pick which is default), and toggle a hardcoded ad/tracker domain blocklist — all persisted to a plaintext `settings.json` outside the vault, available regardless of lock state. Deferred to a later pass, per the spec: fingerprint resistance, per-site custom CSS injection, and full keyboard shortcut remapping.