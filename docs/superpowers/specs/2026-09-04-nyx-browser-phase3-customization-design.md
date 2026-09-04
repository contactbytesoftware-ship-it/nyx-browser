# NYX Browser — Phase 3 Design: Customization + Privacy (focused core)

## Goal

A real Settings screen backed by a plaintext (non-vault) settings store, delivering theme customization, search engine management, and basic ad/tracker blocking — the achievable core of the original "customization + privacy" phase, with the harder items explicitly deferred.

## Non-goals for Phase 3

- No fingerprint resistance (canvas noise, navigator spoofing, etc.) — deferred to a later phase.
- No per-site custom CSS injection (a Stylus-like feature) — deferred.
- No full keyboard shortcut remapping UI — the two existing hotkeys (lock, fill) stay fixed.
- No EasyList-compatible filter-list engine — a hand-written domain blocklist instead (see below), with no new npm dependency.
- No "never block this site" per-domain ad-block exceptions.
- No settings sync/export/import.

## Why settings live outside the encrypted vault

`VaultContentsV1.settings: Record<string, unknown>` has been a stub since Phase 1 with nothing reading or writing it. Putting real settings there would mean the auth/lock screens (which render *before* unlock) can never be themed, and every settings read/write would need the same locked-state guards the credential methods already have — for data that isn't actually sensitive. Instead: a plaintext JSON file at `%APPDATA%/NYX Browser/settings.json`, loaded once at startup, available immediately regardless of lock state. The vault's `settings` field stays an unused stub — not removed (it's part of the typed `VaultContentsV1` shape other code already depends on), just not this phase's concern.

## Data model

```ts
interface SearchEngineV1 {
  id: string
  name: string
  urlTemplate: string // '%s' is replaced with the URL-encoded query
}

interface SettingsV1 {
  version: 1
  theme: 'dark' | 'light'
  accentColor: string // hex, e.g. '#6c4cf1'
  searchEngines: SearchEngineV1[]
  defaultSearchEngineId: string
  adBlockEnabled: boolean
}
```

Defaults on first run (no `settings.json` yet): `theme: 'dark'`, `accentColor: '#6c4cf1'` (the existing hardcoded accent), one `SearchEngineV1` for Brave (`id: 'brave'`, `urlTemplate: 'https://search.brave.com/search?q=%s'`), `defaultSearchEngineId: 'brave'`, `adBlockEnabled: true`.

## Theme system

Extend the existing CSS-custom-property pattern (`--chrome-height` is already set from JS in `main.tsx`). New variables for the dominant colors currently hardcoded across `browser.css`/`auth.css`/`global.css`: background, secondary background, text, accent, border. Not every single hardcoded color in every component — the goal is a genuinely different-looking light mode, not a from-scratch design system. Applied via `document.documentElement.style.setProperty(...)` on load and whenever settings change, same mechanism as the existing `--chrome-height` wiring.

## Search engines

`resolveAddressBarInput` (Phase 1, pure function, already tested) currently hardcodes the Brave Search URL. It gains a second parameter — the URL template of the current default search engine — and substitutes `%s` with the encoded query instead of the hardcoded Brave URL. Existing tests get a template argument; behavior is otherwise unchanged when the template is Brave's.

## Ad/tracker blocking

A hardcoded array of ~75 well-known ad/tracker domains (doubleclick.net, google-analytics.com, googlesyndication.com, facebook.com/tr, and similar widely-known entries), matched against outgoing request hostnames via Electron's `session.webRequest.onBeforeRequest`, toggle-able in settings. This is deliberately not full EasyList-compatible filtering (that needs either a real dependency or network-fetched, regularly-updated filter lists) — it catches the most common, egregious trackers with zero new dependencies and zero network calls, and is a documented upgrade path for later rather than this phase's job.

## Settings UI

A "Settings" button (styled like the existing "Lock" button in the tab strip) toggles a full-window `SettingsPanel`. Opening it calls the renderer-exposed `hideActiveTab()` (new, thin wrapper around the already-existing `TabManager.hideActive()`); closing it calls `showActiveTab()` (wraps `TabManager.showActive()`). No new main-process view-management code — this reuses the exact mechanism Phase 1 built for hiding tab content while locked. The panel itself has three sections: Theme (dark/light toggle + accent swatches), Search Engines (list, add/edit/delete, set default), Privacy (ad-block toggle).

## IPC surface

`window.nyx.settings`: `get(): Promise<SettingsV1>`, `update(settings: SettingsV1): Promise<void>`.
`window.nyx.tabs` gains `hideActive(): Promise<void>`, `showActive(): Promise<void>`.

## Testing approach

- Settings store (load/save/defaults, plain `fs` I/O): full TDD, same pattern as the vault's raw-file-I/O tests, no Electron needed.
- `resolveAddressBarInput`'s new signature: existing tests updated with an explicit template argument; new tests for a non-Brave template.
- Ad-block domain-matching (the pure hostname-against-blocklist function): TDD.
- Theme CSS-variable application, `session.webRequest` wiring, and the Settings UI itself: Electron/DOM-specific, no automated test (established project convention) — verified via build/typecheck plus manual trace, with the same standing caveat as every prior UI task: no GUI/display server has been available anywhere in this process.
