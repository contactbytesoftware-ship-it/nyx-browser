import type { RecoveryFailureReason, UnlockFailureReason } from '../../shared/vault-types'

/** Shown when an IPC call rejects outright (disk full, permission error, ...). */
export const GENERIC_ERROR = 'Something went wrong. Please try again.'

/**
 * Maps a vault failure reason to user-facing copy.
 *
 * Corruption and version mismatches deliberately get their own messages: telling
 * someone "incorrect password" when their vault file is actually damaged sends
 * them down a dead end.
 */
export function vaultErrorMessage(
  reason: UnlockFailureReason | RecoveryFailureReason,
  wrongCredentialsMessage: string
): string {
  switch (reason) {
    case 'locked-out':
      return 'Too many attempts. Wait a moment and try again.'
    case 'corrupt-vault':
      // Deliberately does not promise a backup: the vault file is only renamed
      // aside when it is structurally unparseable, not when a correct key merely
      // fails to decrypt the contents blob.
      return 'Your vault file appears corrupted and could not be opened.'
    case 'unsupported-version':
      return 'This vault was created by a different version of NYX Browser and cannot be opened by this one.'
    case 'recovery-failed':
      return 'Your recovery key was accepted, but the vault could not be saved. Check your available disk space and try again — your old password and recovery key still work.'
    default:
      return wrongCredentialsMessage
  }
}
