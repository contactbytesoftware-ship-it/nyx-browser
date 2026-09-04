const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'
const LENGTH = 20

function randomIndex(max: number): number {
  // Rejection sampling: discard draws that would introduce modulo bias when
  // 2^32 isn't a multiple of `max` — the same technique the vault's
  // recovery-key generator uses (src/main/vault/recovery.ts).
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % max
}

export function generatePassword(): string {
  let result = ''
  for (let i = 0; i < LENGTH; i++) {
    result += CHARSET[randomIndex(CHARSET.length)]
  }
  return result
}
