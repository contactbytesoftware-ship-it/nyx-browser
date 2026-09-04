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
