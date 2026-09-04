import { ipcMain } from 'electron'
import { VaultManager } from '../vault/manager'
import { TabManager } from '../tabs/manager'
import { fillCredential } from './domActions'

export function registerCredentialsIpc(vault: VaultManager, tabs: TabManager): void {
  ipcMain.handle('credentials:list', () => vault.listCredentials())
  ipcMain.handle('credentials:getForDomain', (_e, domain: string) => vault.getCredentialForDomain(domain))
  ipcMain.handle('credentials:save', (_e, domain: string, username: string, password: string, notes?: string) =>
    vault.saveCredential(domain, username, password, notes)
  )
  ipcMain.handle('credentials:delete', (_e, id: string) => vault.deleteCredential(id))
  ipcMain.handle('credentials:fill', async (_e, domain: string) => {
    const credential = vault.getCredentialForDomain(domain)
    const webContents = tabs.getActiveWebContents()
    if (!credential || !webContents) return false
    return fillCredential(webContents, credential.username, credential.password)
  })
}
