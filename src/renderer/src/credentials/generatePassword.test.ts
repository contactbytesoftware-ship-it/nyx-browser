import { describe, it, expect } from 'vitest'
import { generatePassword } from './generatePassword'

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
})
