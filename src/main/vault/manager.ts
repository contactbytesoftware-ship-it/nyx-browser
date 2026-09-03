import { loadRawFile, saveRawFile, backupCorruptFile } from './crypto'
import {
  createContainer,
  unlockWithPassword as containerUnlockWithPassword,
  unlockWithRecoveryKey as containerUnlockWithRecoveryKey,
  serializeContainer,
  parseContainer,
  VaultContentsCorruptError,
  VAULT_VERSION,
  VaultContainer,
  VaultContentsV1
} from './container'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'
import { generateRecoveryKey } from './recovery'
import type { RecoveryUnlockResult, SetupResult, UnlockResult } from '../../shared/vault-types'

// Result shapes live in src/shared/vault-types.ts so the preload and renderer
// type themselves against exactly the same definitions these methods return.
export type { RecoveryUnlockResult, SetupResult, UnlockResult }

const MAX_BACKOFF_MS = 60_000

/** Thrown by `loadContainer` when a vault file exists on disk but cannot be parsed. */
class VaultFileCorruptError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the vault file on disk could not be parsed', options)
    this.name = 'VaultFileCorruptError'
  }
}

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
    const contents: VaultContentsV1 = { version: VAULT_VERSION, totpSecret, settings: {} }
    const container = createContainer(password, recoveryKey, contents)
    await saveRawFile(this.vaultPath, serializeContainer(container))
    this.container = container
    return { totpProvisioningUri: totpProvisioningUri(totpSecret), recoveryKey }
  }

  // KNOWN LIMITATION: when `parseContainer` fails, `backupCorruptFile` renames the
  // bad file away, so `exists()` reports false on the next launch and the app routes
  // to first-run setup instead of surfacing "your vault was corrupted, a backup was
  // saved". Fixing that properly means tracking corruption state separately from raw
  // file existence (e.g. a sidecar marker or scanning for `.corrupt-*` siblings),
  // which is a design change deferred to a later phase.
  private async loadContainer(): Promise<VaultContainer> {
    if (this.container) return this.container
    const raw = await loadRawFile(this.vaultPath)
    if (!raw) throw new Error('no vault exists at this path')
    try {
      this.container = parseContainer(raw)
      return this.container
    } catch (err) {
      try {
        await backupCorruptFile(this.vaultPath)
      } catch {
        // Best effort — still report corruption even if the file could not be moved.
      }
      throw new VaultFileCorruptError({ cause: err })
    }
  }

  /**
   * Distinguishes real corruption from a bad credential, so the UI never tells a
   * user "wrong password" when their vault file is actually damaged.
   */
  private static classifyFailure(err: unknown): 'wrong-credentials' | 'corrupt-vault' {
    return err instanceof VaultFileCorruptError || err instanceof VaultContentsCorruptError
      ? 'corrupt-vault'
      : 'wrong-credentials'
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
    } catch (err) {
      const reason = VaultManager.classifyFailure(err)
      // Corruption is not a guessing attempt — no credential could even be tested
      // against an unreadable file — so it must not consume the backoff budget.
      if (reason === 'wrong-credentials') this.registerFailure()
      return { ok: false, reason }
    }
    if (unlocked.contents.version !== VAULT_VERSION) {
      unlocked.vaultKey.fill(0)
      return { ok: false, reason: 'unsupported-version' }
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

  /**
   * Unlocks with the recovery key, then immediately re-keys the vault under
   * `newPassword` with a freshly generated recovery key (invalidating the old one).
   * The new recovery key is returned to the caller and exists nowhere else — the UI
   * MUST show it to the user, or the next recovery becomes impossible.
   */
  async unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<RecoveryUnlockResult> {
    if (this.isLockedOut()) return { ok: false, reason: 'locked-out' }
    let unlocked: { contents: VaultContentsV1; vaultKey: Buffer }
    try {
      const container = await this.loadContainer()
      unlocked = containerUnlockWithRecoveryKey(container, recoveryKey)
    } catch (err) {
      const reason = VaultManager.classifyFailure(err)
      if (reason === 'wrong-credentials') this.registerFailure()
      return { ok: false, reason }
    }
    if (unlocked.contents.version !== VAULT_VERSION) {
      unlocked.vaultKey.fill(0)
      return { ok: false, reason: 'unsupported-version' }
    }

    // The recovery key verified, so the backoff budget is cleared regardless of
    // whether the rekey write below succeeds.
    this.registerSuccess()
    unlocked.vaultKey.fill(0)

    const newRecoveryKey = generateRecoveryKey()
    let rekeyed: VaultContainer
    let newVaultKey: Buffer
    try {
      rekeyed = createContainer(newPassword, newRecoveryKey, unlocked.contents)
      // Derive the new key BEFORE the write so that any failure leaves both the
      // on-disk vault (temp-file-then-rename) and this manager's state untouched:
      // the old password and old recovery key both still work.
      newVaultKey = containerUnlockWithPassword(rekeyed, newPassword).vaultKey
      await saveRawFile(this.vaultPath, serializeContainer(rekeyed))
    } catch {
      return { ok: false, reason: 'recovery-failed' }
    }

    this.container = rekeyed
    this.vaultKey = newVaultKey
    return { ok: true, recoveryKey: newRecoveryKey }
  }

  lock(): void {
    this.vaultKey?.fill(0)
    this.vaultKey = null
  }
}
