import { useState } from 'react'
import { GENERIC_ERROR, vaultErrorMessage } from '../errors'

interface RecoveryScreenProps {
  onUnlocked: () => void
  onCancel: () => void
}

type Step = 'form' | 'reveal'

export default function RecoveryScreen({ onUnlocked, onCancel }: RecoveryScreenProps): JSX.Element {
  const [step, setStep] = useState<Step>('form')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newRecoveryKey, setNewRecoveryKey] = useState('')
  const [savedConfirmed, setSavedConfirmed] = useState(false)

  async function handleRecover(): Promise<void> {
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await window.nyx.vault.unlockWithRecoveryKey(recoveryKey, newPassword)
      if (result.ok) {
        // Recovery ROTATES the recovery key. The new one comes back only here and
        // exists nowhere else — it must be shown before we move on, or the user is
        // permanently locked out the next time they need to recover.
        setNewRecoveryKey(result.recoveryKey)
        setStep('reveal')
        return
      }
      setError(vaultErrorMessage(result.reason, 'Incorrect recovery key.'))
    } catch {
      setError(GENERIC_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function handleContinue(): Promise<void> {
    try {
      // The main process held tab content back so it could not cover the reveal
      // screen above; tell it we are done.
      await window.nyx.vault.unlockComplete()
    } catch {
      // Non-fatal: the vault is already unlocked, so proceed either way.
    }
    onUnlocked()
  }

  if (step === 'reveal') {
    return (
      <div className="auth-screen">
        <h1>Save your new recovery key</h1>
        <p>
          Recovering replaced your old recovery key — it no longer works. This new key is the only
          way back into NYX Browser if you lose your password and authenticator. Write it down now:
          it will not be shown again.
        </p>
        <code>{newRecoveryKey}</code>
        <label>
          <input
            type="checkbox"
            checked={savedConfirmed}
            onChange={(e) => setSavedConfirmed(e.target.checked)}
          />
          {' '}I&apos;ve saved my new recovery key
        </label>
        <button disabled={!savedConfirmed} onClick={handleContinue}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <h1>Recover your vault</h1>
      <input type="text" placeholder="Recovery key" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} />
      <input
        type="password"
        placeholder="New master password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="auth-error">{error}</p>}
      <button disabled={busy} onClick={handleRecover}>
        {busy ? 'Recovering…' : 'Reset and unlock'}
      </button>
      <button className="auth-link" onClick={onCancel}>Cancel</button>
    </div>
  )
}
