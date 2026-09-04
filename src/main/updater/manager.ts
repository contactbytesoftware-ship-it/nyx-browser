import { ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * The version of an already-downloaded, install-on-restart update, or null if
 * none is waiting. Kept here rather than only pushed over IPC because the push
 * can land with nobody listening: `attachAutoUpdater` runs at `whenReady`, while
 * the renderer only subscribes once BrowserChrome mounts (i.e. after the vault is
 * unlocked), and it unsubscribes again on every re-lock. Renderers read this back
 * through `updater:getReady` on mount so the banner survives those gaps.
 */
let readyVersion: string | null = null

/**
 * Wires the update lifecycle to `win`'s renderer and kicks off one launch-time
 * check. electron-updater no-ops `checkForUpdates()` in an unpackaged dev run
 * (no packaged app metadata to compare against), so this is safe to call
 * unconditionally from both `npm run dev` and a real install.
 */
export function attachAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = true
  // This app ships a plain NSIS installer and never a web installer, so the
  // second download path NsisUpdater takes for `packageInfo.path` manifests is
  // dead weight. electron-updater warns when this is left at its `false` default
  // and says the default will flip in a future version.
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    readyVersion = info.version
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
  ipcMain.handle('updater:getReady', () => readyVersion)

  ipcMain.handle('updater:restartNow', () => {
    autoUpdater.quitAndInstall()
  })
}
