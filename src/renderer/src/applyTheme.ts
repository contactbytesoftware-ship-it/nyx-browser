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
