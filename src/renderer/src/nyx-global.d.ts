import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi }
  }
}

export {}
