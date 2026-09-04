import { describe, it, expect } from 'vitest'
import { shouldBlockRequest, AD_TRACKER_BLOCKLIST } from './blocklist'

describe('shouldBlockRequest', () => {
  it('blocks a request whose hostname exactly matches a blocklist entry', () => {
    expect(shouldBlockRequest('https://doubleclick.net/pixel', ['doubleclick.net'])).toBe(true)
  })

  it('blocks a subdomain of a blocklist entry', () => {
    expect(shouldBlockRequest('https://ad.doubleclick.net/pixel', ['doubleclick.net'])).toBe(true)
  })

  it('does not block an unrelated domain', () => {
    expect(shouldBlockRequest('https://example.com/pixel', ['doubleclick.net'])).toBe(false)
  })

  it('does not block a domain that merely contains a blocklist entry as a substring', () => {
    expect(shouldBlockRequest('https://notdoubleclick.net.example.com/x', ['doubleclick.net'])).toBe(false)
  })

  it('returns false for an unparseable URL rather than throwing', () => {
    expect(shouldBlockRequest('not a url', ['doubleclick.net'])).toBe(false)
  })

  it('ships a real, non-empty curated blocklist', () => {
    expect(AD_TRACKER_BLOCKLIST.length).toBeGreaterThan(30)
    expect(AD_TRACKER_BLOCKLIST).toContain('doubleclick.net')
    expect(AD_TRACKER_BLOCKLIST).toContain('google-analytics.com')
  })
})
