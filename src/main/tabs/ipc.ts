import { ipcMain, BrowserWindow } from 'electron'
import { TabManager } from './manager'

export function registerTabsIpc(win: BrowserWindow, tabs: TabManager): void {
  tabs.on('changed', (list) => win.webContents.send('tabs:changed', list))

  ipcMain.handle('tabs:list', () => tabs.list())
  ipcMain.handle('tabs:create', (_e, url: string) => tabs.createTab(url))
  ipcMain.handle('tabs:activate', (_e, id: number) => tabs.activateTab(id))
  ipcMain.handle('tabs:close', (_e, id: number) => tabs.closeTab(id))
  ipcMain.handle('tabs:navigate', (_e, id: number, url: string) => tabs.navigate(id, url))
  ipcMain.handle('tabs:goBack', (_e, id: number) => tabs.goBack(id))
  ipcMain.handle('tabs:goForward', (_e, id: number) => tabs.goForward(id))
  ipcMain.handle('tabs:reload', (_e, id: number) => tabs.reload(id))
  ipcMain.handle('tabs:hideActive', () => tabs.hideActive())
  ipcMain.handle('tabs:showActive', () => tabs.showActive())
}
