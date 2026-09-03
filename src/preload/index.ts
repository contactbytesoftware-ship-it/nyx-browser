import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  unlockComplete: () => ipcRenderer.invoke('vault:unlockComplete'),
  lock: () => ipcRenderer.invoke('vault:lock'),
  onLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:locked', listener)
    return () => ipcRenderer.removeListener('vault:locked', listener)
  }
}

const tabsApi: TabsApi = {
  list: () => ipcRenderer.invoke('tabs:list'),
  create: (url) => ipcRenderer.invoke('tabs:create', url),
  activate: (id) => ipcRenderer.invoke('tabs:activate', id),
  close: (id) => ipcRenderer.invoke('tabs:close', id),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', id, url),
  goBack: (id) => ipcRenderer.invoke('tabs:goBack', id),
  goForward: (id) => ipcRenderer.invoke('tabs:goForward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  onChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, tabs: TabInfo[]): void => callback(tabs)
    ipcRenderer.on('tabs:changed', listener)
    return () => ipcRenderer.removeListener('tabs:changed', listener)
  }
}

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi, tabs: tabsApi })
