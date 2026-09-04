import { describe, it, expect } from 'vitest'
import { extractHostname } from './extractHostname'

describe('extractHostname', () => {
  it('extracts the hostname from a plain URL', () => {
    expect(extractHostname('https://example.com/path')).toBe('example.com')
  })

  it('extracts the hostname ignoring a port', () => {
    expect(extractHostname('https://example.com:8443/path')).toBe('example.com')
  })

  it('extracts the hostname ignoring query and hash', () => {
    expect(extractHostname('https://example.com/path?x=1#y')).toBe('example.com')
  })

  it('distinguishes a subdomain from its parent domain', () => {
    expect(extractHostname('https://accounts.example.com')).toBe('accounts.example.com')
    expect(extractHostname('https://accounts.example.com')).not.toBe('example.com')
  })

  it('returns null for an unparseable URL', () => {
    expect(extractHostname('not a url')).toBeNull()
  })

  it('returns null for a hostname-less scheme', () => {
    expect(extractHostname('about:blank')).toBeNull()
  })
})
