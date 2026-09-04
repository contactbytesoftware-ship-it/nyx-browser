import { ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires the update lifecycle to `win`'s renderer and kicks off one launch-time
 * check. electron-updater no-ops `checkForUpdates()` in an unpackaged dev run
 * (no packaged app metadata to compare against), so this is safe to call
 * unconditionally from both `npm run dev` and a real install.
 */
export function attachAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = true

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    if (win.isDestroyed()) return
    win.webContents.send('updater:ready', info.version)
  })

  // Network errors, no-releases-yet, and dev-mode no-ops all land here — none of
  // them should be user-visible, since a failed background check just means
  // "still on the current version" and will retry on the next launch.
  autoUpdater.on('error', (err) => {
    console.warn('Auto-update check failed:', err)
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('Auto-update check failed:', err)
  })
}

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:restartNow', () => {
    autoUpdater.quitAndInstall()
  })
}
