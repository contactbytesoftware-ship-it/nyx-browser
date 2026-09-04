import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'
import { registerCredentialsIpc } from './credentials/ipc'
import { attachCredentialCapture } from './credentials/domActions'
import { attachLockShortcut, attachFillShortcut } from './shortcuts'
import { startIdleWatcher, DEFAULT_IDLE_TIMEOUT_SECONDS } from './idle'
import { SettingsManager } from './settings/manager'
import { registerSettingsIpc } from './settings/ipc'
import { attachAdBlock } from './adblock/session'
import { titleBarOverlayFor } from './titleBarOverlay'
import type { SettingsV1 } from '../shared/settings-types'

// Must run before anything reads app.getPath('userData'), which is derived from
// the app name — so at module scope, not inside app.whenReady().
app.setName('NYX Browser')

function createWindow(theme: SettingsV1['theme']): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Taken from settings rather than hardcoded dark: settings are already loaded
    // by the time this runs, so a light-themed profile gets light caption buttons
    // from the very first frame instead of after the first theme change.
    titleBarOverlay: titleBarOverlayFor(theme),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  const settings = await SettingsManager.create(join(app.getPath('userData'), 'settings.json'))
  const win = createWindow(settings.get().theme)

  // The caption buttons are native chrome, so nothing in the renderer can restyle
  // them — the main process has to push the new colors on every theme change or a
  // light-themed window keeps a dark caption strip. `setTitleBarOverlay` is
  // win32/linux only.
  const applyTitleBarTheme = (theme: SettingsV1['theme']): void => {
    if (process.platform === 'darwin' || win.isDestroyed()) return
    win.setTitleBarOverlay(titleBarOverlayFor(theme))
  }

  let tabs: TabManager
  const lock = (): void => {
    if (!vault.isUnlocked) return
    vault.lock()
    tabs.hideActive()
    win.webContents.send('vault:locked')
  }
  const unlock = (): void => {
    tabs.showActive()
  }
  const requestFill = (): void => {
    win.webContents.send('credentials:fillRequested')
  }

  tabs = new TabManager(win, (wc) => {
    attachLockShortcut(wc, lock)
    attachFillShortcut(wc, requestFill)
    // Tabs stay alive after a lock (hideActive only detaches the view), so they can
    // still navigate — but a locked vault must not keep extracting plaintext
    // passwords out of background pages.
    attachCredentialCapture(
      wc,
      (capture) => {
        // Re-checked here too: the capture is async, so the vault can lock between
        // the navigation gate above and this callback resolving.
        if (!vault.isUnlocked) return
        win.webContents.send('credentials:submissionDetected', capture)
      },
      () => vault.isUnlocked
    )
  })
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  registerCredentialsIpc(vault, tabs)
  registerSettingsIpc(settings, applyTitleBarTheme)
  attachLockShortcut(win.webContents, lock)
  attachFillShortcut(win.webContents, requestFill)
  attachAdBlock(session.defaultSession, () => settings.get().adBlockEnabled)

  const stopIdleWatcher = startIdleWatcher(DEFAULT_IDLE_TIMEOUT_SECONDS, lock)
  win.on('closed', stopIdleWatcher)

  // Zero the in-memory vault key on quit, per the spec's key-hygiene requirement.
  app.on('will-quit', () => vault.lock())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get().theme)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
