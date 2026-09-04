import { describe, it, expect } from 'vitest'
import {
  createContainer, unlockWithPassword, unlockWithRecoveryKey,
  serializeContainer, parseContainer, updateContainerContents, VaultContentsV1
} from './container'

const contents: VaultContentsV1 = {
  version: 1,
  totpSecret: 'JBSWY3DPEHPK3PXP',
  settings: { theme: 'dark' },
  credentials: []
}

describe('createContainer + unlockWithPassword', () => {
  it('round-trips with the correct password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { contents: out } = unlockWithPassword(container, 'correct horse')
    expect(out).toEqual(contents)
  })

  it('rejects the wrong password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    expect(() => unlockWithPassword(container, 'wrong password')).toThrow()
  })
})

describe('createContainer + unlockWithRecoveryKey', () => {
  it('round-trips with the correct recovery key, independent of the password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { contents: out, vaultKey } = unlockWithRecoveryKey(container, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')
    expect(out).toEqual(contents)
    expect(vaultKey).toHaveLength(32)
  })

  it('rejects the wrong recovery key', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    expect(() => unlockWithRecoveryKey(container, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toThrow()
  })
})

describe('serializeContainer + parseContainer', () => {
  it('round-trips and both unlock paths still work after parsing', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const parsed = parseContainer(serializeContainer(container))
    expect(unlockWithPassword(parsed, 'correct horse').contents).toEqual(contents)
    expect(unlockWithRecoveryKey(parsed, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF').contents).toEqual(contents)
  })

  it('rejects a too-short buffer', () => {
    expect(() => parseContainer(Buffer.from('short'))).toThrow()
  })

  it('rejects a buffer with the wrong magic header', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const raw = serializeContainer(container)
    raw.write('XXXX', 0, 'utf8')
    expect(() => parseContainer(raw)).toThrow()
  })
})

describe('updateContainerContents', () => {
  it('re-encrypts mainBlob under the same vault key, leaving both unlock paths working', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { vaultKey } = unlockWithPassword(container, 'correct horse')
    const updated: VaultContentsV1 = {
      ...contents,
      credentials: [{ id: '1', domain: 'example.com', username: 'me', password: 'hunter2', updatedAt: 0 }]
    }
    const newContainer = updateContainerContents(container, vaultKey, updated)
    expect(unlockWithPassword(newContainer, 'correct horse').contents).toEqual(updated)
    expect(unlockWithRecoveryKey(newContainer, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF').contents).toEqual(updated)
  })

  it('leaves the wrapped keys and salts unchanged', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { vaultKey } = unlockWithPassword(container, 'correct horse')
    const newContainer = updateContainerContents(container, vaultKey, contents)
    expect(newContainer.passwordSalt).toEqual(container.passwordSalt)
    expect(newContainer.passwordWrappedKey).toEqual(container.passwordWrappedKey)
    expect(newContainer.recoverySalt).toEqual(container.recoverySalt)
    expect(newContainer.recoveryWrappedKey).toEqual(container.recoveryWrappedKey)
  })
})
