import { describe, it, expect } from 'vitest'
import { resolveAddressBarInput } from './resolveAddressBarInput'

const BRAVE_TEMPLATE = 'https://search.brave.com/search?q=%s'

describe('resolveAddressBarInput', () => {
  it('passes through a full URL unchanged', () => {
    expect(resolveAddressBarInput('https://example.com', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('adds https:// to a bare domain', () => {
    expect(resolveAddressBarInput('example.com', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('preserves a path on a bare domain', () => {
    expect(resolveAddressBarInput('example.com/blog', BRAVE_TEMPLATE)).toBe('https://example.com/blog')
  })

  it('sends a single ambiguous word to the search template', () => {
    expect(resolveAddressBarInput('github', BRAVE_TEMPLATE)).toBe('https://search.brave.com/search?q=github')
  })

  it('sends a multi-word query to the search template', () => {
    expect(resolveAddressBarInput('how tall is the eiffel tower', BRAVE_TEMPLATE)).toBe(
      'https://search.brave.com/search?q=how%20tall%20is%20the%20eiffel%20tower'
    )
  })

  it('trims whitespace', () => {
    expect(resolveAddressBarInput('  example.com  ', BRAVE_TEMPLATE)).toBe('https://example.com')
  })

  it('substitutes into a non-Brave search template', () => {
    expect(resolveAddressBarInput('cats', 'https://duckduckgo.com/?q=%s')).toBe('https://duckduckgo.com/?q=cats')
  })
})
