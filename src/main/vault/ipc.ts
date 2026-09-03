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
    // Deliberately does NOT call onUnlock() here. Recovery rotates the recovery key,
    // and the renderer must reveal the new one on a full-window screen first —
    // attaching the tab WebContentsView now would cover it and the user would lose
    // the only copy of their new key. The renderer calls vault:unlockComplete once
    // that screen has been dismissed.
    return vault.unlockWithRecoveryKey(recoveryKey, newPassword)
  })
  ipcMain.handle('vault:unlockComplete', () => {
    if (vault.isUnlocked) onUnlock()
  })
  ipcMain.handle('vault:lock', () => onLock())
}
