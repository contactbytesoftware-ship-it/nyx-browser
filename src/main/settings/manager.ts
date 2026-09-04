import { loadSettings, saveSettings } from './store'
import type { SettingsV1 } from '../../shared/settings-types'

export class SettingsManager {
  private constructor(
    private readonly path: string,
    private current: SettingsV1
  ) {}

  static async create(path: string): Promise<SettingsManager> {
    return new SettingsManager(path, await loadSettings(path))
  }

  get(): SettingsV1 {
    return this.current
  }

  async update(next: SettingsV1): Promise<void> {
    await saveSettings(this.path, next)
    this.current = next
  }
}
