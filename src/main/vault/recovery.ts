import { randomInt } from 'node:crypto'

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L
const RECOVERY_KEY_LENGTH = 24
const GROUP_SIZE = 4

export function generateRecoveryKey(): string {
  // `randomInt` rejection-samples, so it is bias-free for ANY alphabet length.
  // The previous `randomBytes(24)[i] % RECOVERY_ALPHABET.length` was biased: the
  // alphabet holds 31 characters and 256 is not a multiple of 31, so 'A'-'H' came
  // up 9/256 of the time against 8/256 for every other character.
  const chars = Array.from(
    { length: RECOVERY_KEY_LENGTH },
    () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)]
  )
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += GROUP_SIZE) {
    groups.push(chars.slice(i, i + GROUP_SIZE).join(''))
  }
  return groups.join('-')
}
