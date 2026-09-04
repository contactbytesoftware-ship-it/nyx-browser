import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOTP, Secret } from 'otpauth'
import { VaultManager } from './manager'
import { createContainer, serializeContainer, VaultContentsV1 } from './container'

const RECOVERY_KEY_FORMAT = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/

/** scrypt at N=2^17 makes these tests derivation-bound rather than logic-bound. */
const SLOW = 30_000

let dir: string
let vaultPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nyx-manager-'))
  vaultPath = join(dir, 'vault.nyx')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function codeFor(secretBase32: string): string {
  return new TOTP({ secret: Secret.fromBase32(secretBase32) }).generate()
}

describe('setup', () => {
  it('creates a vault file and returns a provisioning URI + recovery key', async () => {
    const manager = new VaultManager(vaultPath)
    expect(await manager.exists()).toBe(false)
    const result = await manager.setup('correct horse battery staple')
    expect(result.totpProvisioningUri).toMatch(/^otpauth:\/\/totp\//)
    expect(result.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/)
    expect(await manager.exists()).toBe(true)
    expect(manager.isUnlocked).toBe(false)
  })
})

describe('unlockWithPassword', () => {
  it('succeeds with the correct password and TOTP code', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    const result = await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    expect(result).toEqual({ ok: true })
    expect(manager.isUnlocked).toBe(true)
  })

  it('fails with the wrong password', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    const result = await manager.unlockWithPassword('wrong password', codeFor(secret))
    expect(result).toEqual({ ok: false, reason: 'wrong-credentials' })
    expect(manager.isUnlocked).toBe(false)
  })

  it('fails with the wrong TOTP code', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    const result = await manager.unlockWithPassword('correct horse battery staple', '000000')
    expect(result.ok).toBe(false)
    expect(manager.isUnlocked).toBe(false)
  })

  it('locks out immediately after a failed attempt (backoff window active)', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    await manager.unlockWithPassword('wrong password', '000000')
    const second = await manager.unlockWithPassword('correct horse battery staple', '000000')
    expect(second).toEqual({ ok: false, reason: 'locked-out' })
  })
})

describe('lock', () => {
  it('clears unlocked state', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    manager.lock()
    expect(manager.isUnlocked).toBe(false)
  })
})

describe('unlockWithRecoveryKey', () => {
  it('unlocks and replaces the password + recovery key', async () => {
    const manager = new VaultManager(vaultPath)
    const { recoveryKey } = await manager.setup('old password')
    const result = await manager.unlockWithRecoveryKey(recoveryKey, 'new password')
    expect(result.ok).toBe(true)
    expect(manager.isUnlocked).toBe(true)
    manager.lock()

    const oldPasswordAttempt = await manager.unlockWithPassword('old password', '000000')
    expect(oldPasswordAttempt).toEqual({ ok: false, reason: 'wrong-credentials' })
  })

  it('rejects the wrong recovery key without modifying the vault', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('old password')
    const result = await manager.unlockWithRecoveryKey('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'new password')
    expect(result.ok).toBe(false)
    expect(manager.isUnlocked).toBe(false)
  })

  // The whole recovery contract in one test: recovery rotates the key, the old one
  // dies, and the new one is actually handed back to the caller. If the returned
  // key were dropped (as it once was) the vault's real recovery key would exist
  // nowhere retrievable and the next recovery would be impossible.
  it(
    'returns the rotated recovery key: the old one stops working, the new one unlocks',
    async () => {
      const manager = new VaultManager(vaultPath)
      const { recoveryKey: originalKey } = await manager.setup('old password')

      const first = await manager.unlockWithRecoveryKey(originalKey, 'first new password')
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.recoveryKey).toMatch(RECOVERY_KEY_FORMAT)
      expect(first.recoveryKey).not.toBe(originalKey)

      // (a) The OLD recovery key is rejected. A fresh manager is used so the
      // attempt goes through the on-disk vault and its own backoff counter.
      const withOldKey = new VaultManager(vaultPath)
      expect(await withOldKey.unlockWithRecoveryKey(originalKey, 'another password')).toEqual({
        ok: false,
        reason: 'wrong-credentials'
      })

      // (b) The NEW recovery key from the result really does unlock the vault.
      const withNewKey = new VaultManager(vaultPath)
      const second = await withNewKey.unlockWithRecoveryKey(first.recoveryKey, 'second new password')
      expect(second.ok).toBe(true)
      expect(withNewKey.isUnlocked).toBe(true)
      if (!second.ok) return
      expect(second.recoveryKey).not.toBe(first.recoveryKey)
    },
    SLOW
  )
})

describe('corrupt and unsupported vaults', () => {
  it('reports corruption rather than wrong credentials, and backs the bad file up', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')

    // Damage the vault after a valid one existed. A fresh manager is used so
    // nothing is served from the in-memory container cache.
    await writeFile(vaultPath, Buffer.from('this is not a vault file'))
    const reopened = new VaultManager(vaultPath)

    const result = await reopened.unlockWithPassword('correct horse battery staple', '000000')
    expect(result).toEqual({ ok: false, reason: 'corrupt-vault' })
    expect(reopened.isUnlocked).toBe(false)

    // backupCorruptFile ran: the bad file was renamed aside, never deleted.
    const entries = await readdir(dir)
    expect(entries.some((name) => name.startsWith('vault.nyx.corrupt-'))).toBe(true)
    expect(entries).not.toContain('vault.nyx')
  })

  it('reports corruption when the password is correct but the contents are damaged', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!

    // Damage only the trailing mainBlob, leaving the magic header, both salts and
    // both wrapped keys intact — so the password's auth tag still verifies (proving
    // the password is right) but the vault body will not decrypt.
    const raw = await readFile(vaultPath)
    raw[raw.length - 1] ^= 0xff
    await writeFile(vaultPath, raw)

    const reopened = new VaultManager(vaultPath)
    const result = await reopened.unlockWithPassword('correct horse battery staple', codeFor(secret))
    expect(result).toEqual({ ok: false, reason: 'corrupt-vault' })
  })

  it('refuses a vault whose contents declare an unsupported version', async () => {
    const futureContents = { version: 2, totpSecret: 'JBSWY3DPEHPK3PXP', settings: {} }
    const container = createContainer(
      'correct horse battery staple',
      'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF',
      futureContents as unknown as VaultContentsV1
    )
    await writeFile(vaultPath, serializeContainer(container))

    const manager = new VaultManager(vaultPath)
    const result = await manager.unlockWithPassword('correct horse battery staple', '000000')
    expect(result).toEqual({ ok: false, reason: 'unsupported-version' })
    expect(manager.isUnlocked).toBe(false)
  }, SLOW)
})

describe('credentials', () => {
  async function unlockedManager(): Promise<VaultManager> {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    return manager
  }

  it('starts with an empty credential list', async () => {
    const manager = await unlockedManager()
    expect(manager.listCredentials()).toEqual([])
    expect(manager.getCredentialForDomain('example.com')).toBeNull()
  })

  it('saves a credential and returns it', async () => {
    const manager = await unlockedManager()
    const saved = await manager.saveCredential('example.com', 'me', 'hunter2')
    expect(saved.domain).toBe('example.com')
    expect(saved.username).toBe('me')
    expect(saved.password).toBe('hunter2')
    expect(saved.id).toBeTruthy()
    expect(manager.listCredentials()).toEqual([saved])
    expect(manager.getCredentialForDomain('example.com')).toEqual(saved)
  })

  it('overwrites the existing entry when saving again for the same domain', async () => {
    const manager = await unlockedManager()
    const first = await manager.saveCredential('example.com', 'me', 'oldpass')
    const second = await manager.saveCredential('example.com', 'me', 'newpass')
    expect(second.id).toBe(first.id)
    expect(manager.listCredentials()).toHaveLength(1)
    expect(manager.getCredentialForDomain('example.com')?.password).toBe('newpass')
  })

  it('deletes a credential', async () => {
    const manager = await unlockedManager()
    const saved = await manager.saveCredential('example.com', 'me', 'hunter2')
    await manager.deleteCredential(saved.id)
    expect(manager.listCredentials()).toEqual([])
    expect(manager.getCredentialForDomain('example.com')).toBeNull()
  })

  it('deleting an unknown id is a no-op', async () => {
    const manager = await unlockedManager()
    await manager.saveCredential('example.com', 'me', 'hunter2')
    await manager.deleteCredential('does-not-exist')
    expect(manager.listCredentials()).toHaveLength(1)
  })

  it(
    'persists credentials across a reopen (re-unlock) of the vault',
    async () => {
      const manager = new VaultManager(vaultPath)
      const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
      const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
      await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
      await manager.saveCredential('example.com', 'me', 'hunter2')
      manager.lock()

      const reopened = new VaultManager(vaultPath)
      await reopened.unlockWithPassword('correct horse battery staple', codeFor(secret))
      expect(reopened.getCredentialForDomain('example.com')?.password).toBe('hunter2')
    },
    SLOW
  )

  it('throws when reading or writing credentials while locked', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    expect(() => manager.listCredentials()).toThrow()
    await expect(manager.saveCredential('example.com', 'me', 'hunter2')).rejects.toThrow()
  })
})
