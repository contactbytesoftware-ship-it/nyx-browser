import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { SettingsV1 } from '../../shared/settings-types'
import { DEFAULT_SETTINGS } from '../../shared/settings-types'

export async function loadSettings(path: string): Promise<SettingsV1> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_SETTINGS
    const candidate = parsed as Partial<SettingsV1>
    // A file that declares a version we don't know about is a *future* format, not
    // a partial one: merging it would quietly reinterpret fields under the V1
    // shape. A missing version is the pre-versioned/hand-written case and still
    // merges, per this function's fail-open contract.
    if (candidate.version !== undefined && candidate.version !== 1) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...candidate }
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
