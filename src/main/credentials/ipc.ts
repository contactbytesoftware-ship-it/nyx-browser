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
    const webContents = tabs.getActiveWebContents()
    if (!webContents) return false
    let actual: string | null
    try {
      actual = new URL(webContents.getURL()).hostname || null
    } catch {
      actual = null
    }
    // Never write a credential into a page other than the one the user confirmed.
    // The confirm banner and this call are separated in time, so the user may have
    // switched tabs, or the page may have navigated itself, in between.
    if (actual !== domain) return false
    const credential = vault.getCredentialForDomain(domain)
    if (!credential) return false
    return fillCredential(webContents, credential.username, credential.password)
  })
}
