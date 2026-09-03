import { ipcMain } from 'electron'
import { VaultManager } from './manager'

export function registerVaultIpc(
  vault: VaultManager,
  onLock: () => void = () => vault.lock(),
  onUnlock: () => void = () => {}
): void {
  ipcMain.handle('vault:exists', () => vault.exists())
  ipcMain.handle('vault:isUnlocked', () => vault.isUnlocked)
  ipcMain.handle('vault:setup', (_event, password: string) => vault.setup(password))
  ipcMain.handle('vault:unlockWithPassword', async (_event, password: string, totpCode: string) => {
    const result = await vault.unlockWithPassword(password, totpCode)
    if (result.ok) onUnlock()
    return result
  })
  ipcMain.handle('vault:unlockWithRecoveryKey', async (_event, recoveryKey: string, newPassword: string) => {
    const result = await vault.unlockWithRecoveryKey(recoveryKey, newPassword)
    if (result.ok) onUnlock()
    return result
  })
  ipcMain.handle('vault:lock', () => onLock())
}
