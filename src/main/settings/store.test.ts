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

  it('falls back to defaults when the file declares an unknown future version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({ version: 2, theme: 'light', accentColor: '#00ff00' }), 'utf8')
    expect(await loadSettings(path)).toEqual(DEFAULT_SETTINGS)
    await rm(dir, { recursive: true, force: true })
  })

  it('falls back to defaults when the version field is present but the wrong type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({ version: '1', theme: 'light' }), 'utf8')
    expect(await loadSettings(path)).toEqual(DEFAULT_SETTINGS)
    await rm(dir, { recursive: true, force: true })
  })

  it('falls back to defaults when the file parses to something that is not an object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-settings-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, '[1, 2, 3]', 'utf8')
    expect(await loadSettings(path)).toEqual(DEFAULT_SETTINGS)
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
