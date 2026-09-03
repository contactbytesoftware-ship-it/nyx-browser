import { loadRawFile, saveRawFile, backupCorruptFile } from './crypto'
import {
  createContainer,
  unlockWithPassword as containerUnlockWithPassword,
  unlockWithRecoveryKey as containerUnlockWithRecoveryKey,
  serializeContainer,
  parseContainer,
  VaultContainer,
  VaultContentsV1
} from './container'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'
import { generateRecoveryKey } from './recovery'

export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }
export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

const MAX_BACKOFF_MS = 60_000

export class VaultManager {
  private container: VaultContainer | null = null
  private vaultKey: Buffer | null = null
  private failedAttempts = 0
  private lockedUntil = 0

  constructor(private readonly vaultPath: string) {}

  async exists(): Promise<boolean> {
    return (await loadRawFile(this.vaultPath)) !== null
  }

  get isUnlocked(): boolean {
    return this.vaultKey !== null
  }

  async setup(password: string): Promise<SetupResult> {
    const totpSecret = generateTotpSecret()
    const recoveryKey = generateRecoveryKey()
    const contents: VaultContentsV1 = { version: 1, totpSecret, settings: {} }
    const container = createContainer(password, recoveryKey, contents)
    await saveRawFile(this.vaultPath, serializeContainer(container))
    this.container = container
    return { totpProvisioningUri: totpProvisioningUri(totpSecret), recoveryKey }
  }

  private async loadContainer(): Promise<VaultContainer> {
    if (this.container) return this.container
    const raw = await loadRawFile(this.vaultPath)
    if (!raw) throw new Error('no vault exists at this path')
    try {
      this.container = parseContainer(raw)
      return this.container
    } catch (err) {
      await backupCorruptFile(this.vaultPath)
      throw err
    }
  }

  private isLockedOut(): boolean {
    return Date.now() < this.lockedUntil
  }

  private registerFailure(): void {
    this.failedAttempts += 1
    this.lockedUntil = Date.now() + Math.min(1000 * 2 ** (this.failedAttempts - 1), MAX_BACKOFF_MS)
  }

  private registerSuccess(): void {
    this.failedAttempts = 0
    this.lockedUntil = 0
  }

  async unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult> {
    if (this.isLockedOut()) return { ok: false, reason: 'locked-out' }
    let unlocked: { contents: VaultContentsV1; vaultKey: Buffer }
    try {
      const container = await this.loadContainer()
      unlocked = containerUnlockWithPassword(container, password)
    } catch {
      this.registerFailure()
      return { ok: false, reason: 'wrong-credentials' }
    }
    if (!verifyTotpCode(unlocked.contents.totpSecret, totpCode)) {
      unlocked.vaultKey.fill(0)
      this.registerFailure()
      return { ok: false, reason: 'wrong-totp' }
    }
    this.vaultKey = unlocked.vaultKey
    this.registerSuccess()
    return { ok: true }
  }

  async unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult> {
    if (this.isLockedOut()) return { ok: false, reason: 'locked-out' }
    let unlocked: { contents: VaultContentsV1; vaultKey: Buffer }
    try {
      const container = await this.loadContainer()
      unlocked = containerUnlockWithRecoveryKey(container, recoveryKey)
    } catch {
      this.registerFailure()
      return { ok: false, reason: 'wrong-credentials' }
    }
    this.registerSuccess()
    unlocked.vaultKey.fill(0)
    const newRecoveryKey = generateRecoveryKey()
    const rekeyed = createContainer(newPassword, newRecoveryKey, unlocked.contents)
    await saveRawFile(this.vaultPath, serializeContainer(rekeyed))
    this.container = rekeyed
    this.vaultKey = containerUnlockWithPassword(rekeyed, newPassword).vaultKey
    return { ok: true }
  }

  lock(): void {
    this.vaultKey?.fill(0)
    this.vaultKey = null
  }
}
