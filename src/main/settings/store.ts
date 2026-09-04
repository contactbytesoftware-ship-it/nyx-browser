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
