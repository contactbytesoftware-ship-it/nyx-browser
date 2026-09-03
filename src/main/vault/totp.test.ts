import { describe, it, expect, vi } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'

/**
 * RFC 6238 Appendix B known-answer vectors.
 *
 * Every other test here generates a code with `otpauth` and verifies it with
 * `otpauth` — self-consistent, so it would still pass if the library silently
 * drifted from Google Authenticator's actual defaults. These vectors pin the
 * library (which totp.ts is a thin wrapper around) to the published standard.
 *
 * The vectors use the ASCII seed "12345678901234567890" with SHA-1, an 8-digit
 * token and a 30-second period. `TOTP.generate` accepts an explicit `timestamp`,
 * so the clock is pinned by argument rather than by mocking global time.
 */
describe('RFC 6238 known-answer vectors', () => {
  const RFC_SECRET = Secret.fromLatin1('12345678901234567890')
  const VECTORS: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ]

  it.each(VECTORS)('produces the published SHA-1 token at Unix time %i', (unixSeconds, expected) => {
    expect(
      TOTP.generate({
        secret: RFC_SECRET,
        algorithm: 'SHA1',
        digits: 8,
        period: 30,
        timestamp: unixSeconds * 1000
      })
    ).toBe(expected)
  })

  it('defaults to the Google Authenticator parameters our vault relies on', () => {
    // generateTotpSecret/verifyTotpCode never pass these explicitly, so the
    // library defaults ARE the vault's TOTP contract.
    expect(TOTP.defaults.algorithm).toBe('SHA1')
    expect(TOTP.defaults.digits).toBe(6)
    expect(TOTP.defaults.period).toBe(30)
  })

  it('verifyTotpCode accepts the RFC-derived 6-digit code at the same instant', () => {
    // A 6-digit token is the 8-digit one truncated to its low six digits, so the
    // T=59 vector 94287082 becomes 287082.
    const sixDigit = TOTP.generate({ secret: RFC_SECRET, digits: 6, timestamp: 59_000 })
    expect(sixDigit).toBe('287082')

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(59_000))
      expect(verifyTotpCode(RFC_SECRET.base32, sixDigit)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

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
