const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'
const LENGTH = 20

function randomIndex(max: number): number {
  // Rejection sampling: discard draws that would introduce modulo bias when
  // 2^32 isn't a multiple of `max`. The vault's recovery-key generator
  // (src/main/vault/recovery.ts) gets this for free via Node's `randomInt`,
  // which rejection-samples internally — the renderer has no `randomInt`
  // equivalent (no Node APIs here), so this hand-rolls the same idea using
  // Web Crypto's `getRandomValues`.
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
