import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, SALT_LEN, KEY_LEN, NONCE_LEN, AUTH_TAG_LEN } from './crypto'

export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
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
  const vaultKey = decrypt(container.passwordWrappedKey, deriveKey(password, container.passwordSalt))
  return { contents: decryptJSON<VaultContentsV1>(container.mainBlob, vaultKey), vaultKey }
}

export function unlockWithRecoveryKey(container: VaultContainer, recoveryKey: string): { contents: VaultContentsV1; vaultKey: Buffer } {
  const vaultKey = decrypt(container.recoveryWrappedKey, deriveKey(recoveryKey, container.recoverySalt))
  return { contents: decryptJSON<VaultContentsV1>(container.mainBlob, vaultKey), vaultKey }
}

export function serializeContainer(c: VaultContainer): Buffer {
  return Buffer.concat([MAGIC, c.passwordSalt, c.passwordWrappedKey, c.recoverySalt, c.recoveryWrappedKey, c.mainBlob])
}

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
