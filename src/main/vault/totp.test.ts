import { describe, it, expect } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'

describe('generateTotpSecret', () => {
  it('returns a base32 secret', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)
    expect(secret.length).toBeGreaterThanOrEqual(32)
  })

  it('returns a different secret each call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe('totpProvisioningUri', () => {
  it('returns an otpauth:// URI for NYX Browser', () => {
    const uri = totpProvisioningUri(generateTotpSecret(), 'me@example.com')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('NYX')
  })
})

describe('verifyTotpCode', () => {
  it('accepts the current valid code', () => {
    const secret = generateTotpSecret()
    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate()
    expect(verifyTotpCode(secret, code)).toBe(true)
  })

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret()
    const valid = new TOTP({ secret: Secret.fromBase32(secret) }).generate()
    const wrong = valid === '000000' ? '111111' : '000000'
    expect(verifyTotpCode(secret, wrong)).toBe(false)
  })

  it('rejects a code for a different secret', () => {
    const code = new TOTP({ secret: Secret.fromBase32(generateTotpSecret()) }).generate()
    expect(verifyTotpCode(generateTotpSecret(), code)).toBe(false)
  })
})
