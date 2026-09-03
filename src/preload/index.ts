import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  lock: () => ipcRenderer.invoke('vault:lock')
}

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi })
