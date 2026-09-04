import { ipcMain } from 'electron'
import { SettingsManager } from './manager'
import type { SettingsV1 } from '../../shared/settings-types'

/**
 * @param onThemeChange Called with the persisted theme after every successful
 *   update. The renderer restyles itself from the settings object it already has,
 *   but the window's native caption buttons are main-process chrome — this is how
 *   they follow the theme. A callback rather than the `BrowserWindow` itself keeps
 *   this module free of window-management concerns.
 */
export function registerSettingsIpc(
  settings: SettingsManager,
  onThemeChange: (theme: SettingsV1['theme']) => void
): void {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:update', async (_e, next: SettingsV1) => {
    // Awaited, so a failed write rejects the renderer's invoke (which surfaces the
    // error) and leaves the title bar matching what is actually on disk.
    await settings.update(next)
    onThemeChange(settings.get().theme)
  })
}
