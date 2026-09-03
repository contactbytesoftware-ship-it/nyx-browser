import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  app.setName('NYX Browser')
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  registerVaultIpc(vault)

  const win = createWindow()
  const tabs = new TabManager(win)
  registerTabsIpc(win, tabs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
