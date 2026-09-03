export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }

export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

export interface VaultApi {
  exists(): Promise<boolean>
  isUnlocked(): Promise<boolean>
  setup(password: string): Promise<SetupResult>
  unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult>
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult>
  lock(): Promise<void>
}
