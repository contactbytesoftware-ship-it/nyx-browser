import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'
import type { CredentialsApi } from '../../shared/credential-types'
import type { SettingsApi } from '../../shared/settings-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi; credentials: CredentialsApi; settings: SettingsApi }
  }
}

export {}
