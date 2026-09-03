import { describe, it, expect } from 'vitest'
import { generateRecoveryKey } from './recovery'

describe('generateRecoveryKey', () => {
  it('matches the expected grouped format', () => {
    expect(generateRecoveryKey()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/)
  })

  it('excludes ambiguous characters', () => {
    const key = generateRecoveryKey()
    expect(key).not.toMatch(/[01IOL]/)
  })

  it('returns a different key each call', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })
})
