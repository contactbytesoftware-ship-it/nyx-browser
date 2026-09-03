import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOTP, Secret } from 'otpauth'
import { VaultManager } from './manager'

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
    expect(result).toEqual({ ok: true })
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
})
