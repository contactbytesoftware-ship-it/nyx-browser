const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i

export function resolveAddressBarInput(input: string, searchUrlTemplate: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return ''
  if (URL_LIKE.test(trimmed)) return trimmed
  if (!trimmed.includes(' ') && DOMAIN_LIKE.test(trimmed)) return `https://${trimmed}`
  return searchUrlTemplate.replace('%s', encodeURIComponent(trimmed))
}
