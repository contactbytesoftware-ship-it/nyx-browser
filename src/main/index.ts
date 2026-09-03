import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'
import { attachLockShortcut } from './shortcuts'
import { startIdleWatcher, DEFAULT_IDLE_TIMEOUT_SECONDS } from './idle'

// Must run before anything reads app.getPath('userData'), which is derived from
// the app name — so at module scope, not inside app.whenReady().
app.setName('NYX Browser')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
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

app.whenReady().then(() => {
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  const win = createWindow()

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

  tabs = new TabManager(win, (wc) => attachLockShortcut(wc, lock))
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  attachLockShortcut(win.webContents, lock)

  const stopIdleWatcher = startIdleWatcher(DEFAULT_IDLE_TIMEOUT_SECONDS, lock)
  win.on('closed', stopIdleWatcher)

  // Zero the in-memory vault key on quit, per the spec's key-hygiene requirement.
  app.on('will-quit', () => vault.lock())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
