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
