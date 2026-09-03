import { randomBytes } from 'node:crypto'

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L

export function generateRecoveryKey(): string {
  const bytes = randomBytes(24)
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4).join(''))
  }
  return groups.join('-')
}
