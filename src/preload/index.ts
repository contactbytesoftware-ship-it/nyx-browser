import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'
import type { CredentialsApi } from '../shared/credential-types'
import type { SettingsApi } from '../shared/settings-types'

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
  hideActive: () => ipcRenderer.invoke('tabs:hideActive'),
  showActive: () => ipcRenderer.invoke('tabs:showActive'),
  onChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, tabs: TabInfo[]): void => callback(tabs)
    ipcRenderer.on('tabs:changed', listener)
    return () => ipcRenderer.removeListener('tabs:changed', listener)
  }
}

const credentialsApi: CredentialsApi = {
  list: () => ipcRenderer.invoke('credentials:list'),
  getForDomain: (domain) => ipcRenderer.invoke('credentials:getForDomain', domain),
  save: (domain, username, password, notes) =>
    ipcRenderer.invoke('credentials:save', domain, username, password, notes),
  delete: (id) => ipcRenderer.invoke('credentials:delete', id),
  fill: (domain) => ipcRenderer.invoke('credentials:fill', domain),
  onSubmissionDetected: (callback) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      capture: { domain: string; username: string; password: string }
    ): void => callback(capture)
    ipcRenderer.on('credentials:submissionDetected', listener)
    return () => ipcRenderer.removeListener('credentials:submissionDetected', listener)
  },
  onFillRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('credentials:fillRequested', listener)
    return () => ipcRenderer.removeListener('credentials:fillRequested', listener)
  }
}

const settingsApi: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (settings) => ipcRenderer.invoke('settings:update', settings)
}

contextBridge.exposeInMainWorld('nyx', {
  vault: vaultApi,
  tabs: tabsApi,
  credentials: credentialsApi,
  settings: settingsApi
})
