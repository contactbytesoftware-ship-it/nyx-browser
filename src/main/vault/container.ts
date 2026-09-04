import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, SALT_LEN, KEY_LEN, NONCE_LEN, AUTH_TAG_LEN } from './crypto'
import type { CredentialV1 } from '../../shared/credential-types'

/** The only vault content version this build understands. */
export const VAULT_VERSION = 1

export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
  credentials: CredentialV1[]
}

/**
 * Thrown when a wrapping key unwrapped the vault key successfully — proving the
 * supplied password or recovery key was CORRECT, since AES-GCM verified its auth
 * tag — but the main blob could not then be decrypted or parsed. That is
 * unambiguously vault corruption, never a bad credential, and callers must
 * report it as such rather than as "wrong password".
 */
export class VaultContentsCorruptError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the vault key unwrapped but the vault contents could not be decrypted', options)
    this.name = 'VaultContentsCorruptError'
  }
}

function openContents(mainBlob: Buffer, vaultKey: Buffer): VaultContentsV1 {
  try {
    return decryptJSON<VaultContentsV1>(mainBlob, vaultKey)
  } catch (err) {
    // The caller never receives the key on this path, so zero it here.
    vaultKey.fill(0)
    throw new VaultContentsCorruptError({ cause: err })
  }
}

export interface VaultContainer {
  passwordSalt: Buffer
  passwordWrappedKey: Buffer
  recoverySalt: Buffer
  recoveryWrappedKey: Buffer
  mainBlob: Buffer
}

const MAGIC = Buffer.from('NYX1', 'utf8')
const WRAPPED_KEY_LEN = NONCE_LEN + AUTH_TAG_LEN + KEY_LEN

export function createContainer(password: string, recoveryKey: string, contents: VaultContentsV1): VaultContainer {
  const vaultKey = randomBytes(KEY_LEN)
  const passwordSalt = randomBytes(SALT_LEN)
  const recoverySalt = randomBytes(SALT_LEN)
  return {
    passwordSalt,
    passwordWrappedKey: encrypt(vaultKey, deriveKey(password, passwordSalt)),
    recoverySalt,
    recoveryWrappedKey: encrypt(vaultKey, deriveKey(recoveryKey, recoverySalt)),
    mainBlob: encryptJSON(contents, vaultKey)
  }
}

export function unlockWithPassword(container: VaultContainer, password: string): { contents: VaultContentsV1; vaultKey: Buffer } {
  // A throw from here is an auth-tag mismatch: the password was wrong.
  const vaultKey = decrypt(container.passwordWrappedKey, deriveKey(password, container.passwordSalt))
  // A throw from here is VaultContentsCorruptError: the password was right.
  return { contents: openContents(container.mainBlob, vaultKey), vaultKey }
}

export function unlockWithRecoveryKey(container: VaultContainer, recoveryKey: string): { contents: VaultContentsV1; vaultKey: Buffer } {
  const vaultKey = decrypt(container.recoveryWrappedKey, deriveKey(recoveryKey, container.recoverySalt))
  return { contents: openContents(container.mainBlob, vaultKey), vaultKey }
}

export function serializeContainer(c: VaultContainer): Buffer {
  return Buffer.concat([MAGIC, c.passwordSalt, c.passwordWrappedKey, c.recoverySalt, c.recoveryWrappedKey, c.mainBlob])
}

/**
 * CONTRACT: the returned fields are `subarray` views aliasing `raw`, not copies —
 * callers must not mutate `raw` (or the fields) after parsing.
 */
export function parseContainer(raw: Buffer): VaultContainer {
  const headerLen = MAGIC.length + SALT_LEN + WRAPPED_KEY_LEN + SALT_LEN + WRAPPED_KEY_LEN
  if (raw.length < headerLen) throw new Error('vault file is too short to be valid')
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('vault file has an unrecognized format')
  let offset = MAGIC.length
  const passwordSalt = raw.subarray(offset, (offset += SALT_LEN))
  const passwordWrappedKey = raw.subarray(offset, (offset += WRAPPED_KEY_LEN))
  const recoverySalt = raw.subarray(offset, (offset += SALT_LEN))
  const recoveryWrappedKey = raw.subarray(offset, (offset += WRAPPED_KEY_LEN))
  const mainBlob = raw.subarray(offset)
  return { passwordSalt, passwordWrappedKey, recoverySalt, recoveryWrappedKey, mainBlob }
}

export function updateContainerContents(container: VaultContainer, vaultKey: Buffer, contents: VaultContentsV1): VaultContainer {
  return { ...container, mainBlob: encryptJSON(contents, vaultKey) }
}
