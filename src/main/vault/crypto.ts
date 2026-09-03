import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'

export const SCRYPT_N = 2 ** 17
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const KEY_LEN = 32
export const SALT_LEN = 16
export const NONCE_LEN = 12
export const AUTH_TAG_LEN = 16

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024
  })
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(NONCE_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  const nonce = blob.subarray(0, NONCE_LEN)
  const authTag = blob.subarray(NONCE_LEN, NONCE_LEN + AUTH_TAG_LEN)
  const ciphertext = blob.subarray(NONCE_LEN + AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function encryptJSON(data: unknown, key: Buffer): Buffer {
  return encrypt(Buffer.from(JSON.stringify(data), 'utf8'), key)
}

export function decryptJSON<T>(blob: Buffer, key: Buffer): T {
  return JSON.parse(decrypt(blob, key).toString('utf8')) as T
}

export async function loadRawFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveRawFile(path: string, data: Buffer): Promise<void> {
  const tmpPath = `${path}.tmp-${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, data)
  await rename(tmpPath, path)
}

export async function backupCorruptFile(path: string): Promise<string> {
  const dest = `${path}.corrupt-${Date.now()}`
  await rename(path, dest)
  return dest
}
