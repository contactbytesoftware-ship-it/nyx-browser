import { describe, it, expect, vi } from 'vitest'
import { generatePassword } from './generatePassword'

// CHARSET has 74 characters, so limit = floor(2^32 / 74) * 74 = 4294967252.
const CHARSET_LENGTH = 74
const REJECTION_LIMIT = Math.floor(0x100000000 / CHARSET_LENGTH) * CHARSET_LENGTH
const LAST_INDEX = CHARSET_LENGTH - 1 // 73 -> '+' , the final character of CHARSET
const FIRST_CHAR = 'A' // CHARSET[0] — what `REJECTION_LIMIT % 74` would alias to

describe('generatePassword', () => {
  it('returns a 20-character password', () => {
    expect(generatePassword()).toHaveLength(20)
  })

  it('only uses characters from the expected charset', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*\-_=+]+$/)
  })

  it('returns a different password each call', () => {
    expect(generatePassword()).not.toBe(generatePassword())
  })

  it('draws from a wide enough range that all character classes appear across many generations', () => {
    const samples = Array.from({ length: 50 }, () => generatePassword()).join('')
    expect(samples).toMatch(/[A-Z]/)
    expect(samples).toMatch(/[a-z]/)
    expect(samples).toMatch(/[0-9]/)
    expect(samples).toMatch(/[!@#$%^&*\-_=+]/)
  })

  it('rejects a draw at or above the unbiased limit instead of taking it modulo the charset', () => {
    // A draw of exactly the limit must be REJECTED and redrawn. A broken
    // (non-rejecting) implementation would alias it to index 0 via `% 74` and
    // emit CHARSET[0] ('A') as the first character; a correct one discards it
    // and uses the next draw instead.
    expect(REJECTION_LIMIT % CHARSET_LENGTH).toBe(0) // guards the premise of this test
    const draws = [REJECTION_LIMIT, LAST_INDEX]
    let call = 0
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
        // Every draw after the scripted two is a valid one, so the remaining 19
        // characters of the password can be produced without running dry.
        ;(buf as unknown as Uint32Array)[0] = draws[call++] ?? LAST_INDEX
        return buf
      })
    try {
      const password = generatePassword()
      expect(password[0]).not.toBe(FIRST_CHAR)
      expect(password).toBe('+'.repeat(20))
      // 20 characters + the single rejected draw.
      expect(call).toBe(21)
    } finally {
      spy.mockRestore()
    }
  })

  it('accepts a draw just below the unbiased limit', () => {
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
        ;(buf as unknown as Uint32Array)[0] = REJECTION_LIMIT - 1
        return buf
      })
    try {
      // (limit - 1) % 74 === 73 -> the last character of CHARSET, taken on the
      // first draw: the boundary is `>=`, not `>`.
      expect(generatePassword()).toBe('+'.repeat(20))
      expect(spy).toHaveBeenCalledTimes(20)
    } finally {
      spy.mockRestore()
    }
  })
})
