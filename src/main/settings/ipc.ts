import { ipcMain } from 'electron'
import { SettingsManager } from './manager'
import type { SettingsV1 } from '../../shared/settings-types'

export function registerSettingsIpc(settings: SettingsManager): void {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:update', (_e, next: SettingsV1) => settings.update(next))
}
