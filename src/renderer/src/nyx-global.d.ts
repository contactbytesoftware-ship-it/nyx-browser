import type { VaultApi } from '../../shared/vault-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi }
  }
}

export {}
