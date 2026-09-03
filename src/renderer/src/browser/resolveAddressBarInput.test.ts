import { describe, it, expect } from 'vitest'
import { resolveAddressBarInput } from './resolveAddressBarInput'

describe('resolveAddressBarInput', () => {
  it('passes through a full URL unchanged', () => {
    expect(resolveAddressBarInput('https://example.com')).toBe('https://example.com')
  })

  it('adds https:// to a bare domain', () => {
    expect(resolveAddressBarInput('example.com')).toBe('https://example.com')
  })

  it('preserves a path on a bare domain', () => {
    expect(resolveAddressBarInput('example.com/blog')).toBe('https://example.com/blog')
  })

  it('sends a single ambiguous word to Brave Search', () => {
    expect(resolveAddressBarInput('github')).toBe('https://search.brave.com/search?q=github')
  })

  it('sends a multi-word query to Brave Search', () => {
    expect(resolveAddressBarInput('how tall is the eiffel tower')).toBe(
      'https://search.brave.com/search?q=how%20tall%20is%20the%20eiffel%20tower'
    )
  })

  it('trims whitespace', () => {
    expect(resolveAddressBarInput('  example.com  ')).toBe('https://example.com')
  })
})
