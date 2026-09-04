import type { SettingsV1 } from '../../shared/settings-types'

// `surface`/`surfaceActive` are the raised-control colors (tabs, toolbar buttons,
// the address input, the credential banner). They have to be part of the palette:
// those controls inherit `--text` from `.browser-chrome`, so leaving their
// backgrounds hardcoded dark made every one of them dark-on-dark in light mode.
// The dark values are exactly the hexes those rules used before they were themed.
const PALETTES = {
  dark: {
    bg: '#1a1a1d',
    bgSecondary: '#111113',
    text: '#e6e6e6',
    border: '#333333',
    surface: '#26262b',
    surfaceActive: '#34343c'
  },
  light: {
    bg: '#f5f5f7',
    bgSecondary: '#ffffff',
    text: '#1a1a1d',
    border: '#d0d0d5',
    surface: '#e4e4ea',
    surfaceActive: '#d2d2da'
  }
} as const

export function applyTheme(settings: Pick<SettingsV1, 'theme' | 'accentColor'>): void {
  // settings.json is plaintext by design, so a hand-edited theme value that is
  // neither 'dark' nor 'light' is entirely reachable. Fall back rather than throw:
  // this runs from an unawaited promise chain in main.tsx, where a throw would be
  // a silent unhandled rejection that leaves the app unstyled.
  const palette = PALETTES[settings.theme] ?? PALETTES.dark
  const root = document.documentElement.style
  root.setProperty('--bg', palette.bg)
  root.setProperty('--bg-secondary', palette.bgSecondary)
  root.setProperty('--text', palette.text)
  root.setProperty('--border', palette.border)
  root.setProperty('--surface', palette.surface)
  root.setProperty('--surface-active', palette.surfaceActive)
  root.setProperty('--accent', settings.accentColor)
}
