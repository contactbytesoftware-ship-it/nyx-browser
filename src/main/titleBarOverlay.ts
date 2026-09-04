import type { TitleBarOverlayOptions } from 'electron'
import type { SettingsV1 } from '../shared/settings-types'

/**
 * Colors for Windows' native caption buttons, which sit in the window's own
 * chrome and so cannot be styled by the renderer's CSS variables at all.
 *
 * These deliberately mirror `--bg`/`--text` from
 * `src/renderer/src/applyTheme.ts` — they are the same two colors on either side
 * of the process boundary, and the caption strip visibly seams against the tab
 * strip if they drift apart. Keep the two files in sync.
 */
const OVERLAY_COLORS: Record<SettingsV1['theme'], { color: string; symbolColor: string }> = {
  dark: { color: '#1a1a1d', symbolColor: '#e6e6e6' },
  light: { color: '#f5f5f7', symbolColor: '#1a1a1d' }
}

/** Matches `.tab-strip`'s height in browser.css: the caption buttons overlay it. */
const TITLE_BAR_HEIGHT = 40

export function titleBarOverlayFor(theme: SettingsV1['theme']): TitleBarOverlayOptions {
  // settings.json is plaintext and hand-editable, so an unknown theme value is
  // reachable; match applyTheme's fallback rather than handing Electron undefined.
  const colors = OVERLAY_COLORS[theme] ?? OVERLAY_COLORS.dark
  return { ...colors, height: TITLE_BAR_HEIGHT }
}
