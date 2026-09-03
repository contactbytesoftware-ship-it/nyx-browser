import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, loadRawFile, saveRawFile, backupCorruptFile, SALT_LEN } from './crypto'

describe('encrypt/decrypt', () => {
  it('round-trips plaintext', () => {
    const key = deriveKey('correct horse', randomBytes(SALT_LEN))
    const blob = encrypt(Buffer.from('hello vault', 'utf8'), key)
    expect(decrypt(blob, key).toString('utf8')).toBe('hello vault')
  })

  it('rejects the wrong key', () => {
    const key1 = deriveKey('password-a', randomBytes(SALT_LEN))
    const key2 = deriveKey('password-b', randomBytes(SALT_LEN))
    const blob = encrypt(Buffer.from('secret'), key1)
    expect(() => decrypt(blob, key2)).toThrow()
  })

  it('round-trips JSON', () => {
    const key = deriveKey('pw', randomBytes(SALT_LEN))
    const blob = encryptJSON({ a: 1, b: 'two' }, key)
    expect(decryptJSON<{ a: number; b: string }>(blob, key)).toEqual({ a: 1, b: 'two' })
  })
})

describe('raw file I/O', () => {
  it('returns null when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    expect(await loadRawFile(join(dir, 'vault.nyx'))).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips save/load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    const path = join(dir, 'vault.nyx')
    await saveRawFile(path, Buffer.from('vault contents'))
    const loaded = await loadRawFile(path)
    expect(loaded?.toString('utf8')).toBe('vault contents')
    await rm(dir, { recursive: true, force: true })
  })

  it('backs up a corrupt file instead of deleting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    const path = join(dir, 'vault.nyx')
    await saveRawFile(path, Buffer.from('junk'))
    const backupPath = await backupCorruptFile(path)
    expect(backupPath).toContain('vault.nyx.corrupt-')
    expect(await loadRawFile(path)).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })
})
