/**
 * Types shared by the main process, the preload bridge and the chrome renderer.
 *
 * This module is the single source of truth for the vault result shapes: it is
 * importable from every process (it pulls in no Node-specific code), so
 * `src/main/vault/manager.ts` imports these rather than declaring its own copies.
 * Main-process code may import from `src/shared`; the reverse must never happen.
 */

/** Why a password unlock attempt failed. */
export type UnlockFailureReason =
  /** The password was wrong, the auth tag did not verify, or no vault was found. */
  | 'wrong-credentials'
  /** The password was right but the TOTP code was not. */
  | 'wrong-totp'
  /** Too many recent failures; the backoff window is still open. */
  | 'locked-out'
  /** The vault file exists but could not be parsed or decrypted. A backup was saved. */
  | 'corrupt-vault'
  /** The vault decrypted but declares a version this build does not understand. */
  | 'unsupported-version'

/** Why a recovery-key unlock attempt failed. `wrong-totp` cannot occur here. */
export type RecoveryFailureReason =
  | Exclude<UnlockFailureReason, 'wrong-totp'>
  /** The recovery key was correct but the re-keyed vault could not be written. */
  | 'recovery-failed'

export type UnlockResult = { ok: true } | { ok: false; reason: UnlockFailureReason }

/**
 * Recovery rotates the recovery key, so a successful result MUST carry the new
 * one back to the UI — it exists nowhere else, and losing it means the next
 * recovery is impossible.
 */
export type RecoveryUnlockResult =
  | { ok: true; recoveryKey: string }
  | { ok: false; reason: RecoveryFailureReason }

export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

export interface VaultApi {
  exists(): Promise<boolean>
  isUnlocked(): Promise<boolean>
  setup(password: string): Promise<SetupResult>
  unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult>
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<RecoveryUnlockResult>
  /**
   * Signals that the chrome renderer has finished any post-unlock screens and is
   * ready for tab content to be shown. `unlockWithPassword` shows it immediately,
   * but recovery must first reveal the rotated recovery key on a full-window
   * screen that a tab `WebContentsView` would otherwise cover.
   */
  unlockComplete(): Promise<void>
  lock(): Promise<void>
  onLocked(callback: () => void): () => void
}
