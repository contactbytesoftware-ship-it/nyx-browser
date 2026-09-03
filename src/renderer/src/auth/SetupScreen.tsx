import { useState } from 'react'
import QRCode from 'qrcode'
import { GENERIC_ERROR } from '../errors'

interface SetupScreenProps {
  onComplete: () => void
}

type Step = 'password' | 'reveal'

export default function SetupScreen({ onComplete }: SetupScreenProps): JSX.Element {
  const [step, setStep] = useState<Step>('password')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [manualSecret, setManualSecret] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [savedConfirmed, setSavedConfirmed] = useState(false)

  async function handleCreate(): Promise<void> {
    if (password.length < 12) {
      setError('Master password must be at least 12 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await window.nyx.vault.setup(password)
      setRecoveryKey(result.recoveryKey)
      setManualSecret(new URL(result.totpProvisioningUri).searchParams.get('secret') ?? '')
      setQrDataUrl(await QRCode.toDataURL(result.totpProvisioningUri))
      setStep('reveal')
    } catch {
      // A main-process throw (disk full, permission error) must never leave the
      // button looking like it simply did nothing.
      setError(GENERIC_ERROR)
    } finally {
      setBusy(false)
    }
  }

  if (step === 'reveal') {
    return (
      <div className="auth-screen">
        <h1>Scan into your authenticator app</h1>
        <img src={qrDataUrl} alt="TOTP QR code" width={200} height={200} />
        <p>Can&apos;t scan? Enter this key manually: <code>{manualSecret}</code></p>
        <h1>Save your recovery key</h1>
        <p>
          This is the only way back into NYX Browser if you lose your password and authenticator.
          It will not be shown again.
        </p>
        <code>{recoveryKey}</code>
        <label>
          <input type="checkbox" checked={savedConfirmed} onChange={(e) => setSavedConfirmed(e.target.checked)} />
          {' '}I&apos;ve saved my recovery key
        </label>
        <button disabled={!savedConfirmed} onClick={onComplete}>
          Continue to unlock
        </button>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <h1>Set your master password</h1>
      <input
        type="password"
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirm password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="auth-error">{error}</p>}
      <button disabled={busy} onClick={handleCreate}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>
    </div>
  )
}
