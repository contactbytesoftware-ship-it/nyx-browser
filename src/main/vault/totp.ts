import { Secret, TOTP } from 'otpauth'

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpProvisioningUri(secretBase32: string, accountLabel = 'NYX Browser'): string {
  const totp = new TOTP({
    issuer: 'NYX Browser',
    label: accountLabel,
    secret: Secret.fromBase32(secretBase32)
  })
  return totp.toString()
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32) })
  return totp.validate({ token: code, window: 1 }) !== null
}
