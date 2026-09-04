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
