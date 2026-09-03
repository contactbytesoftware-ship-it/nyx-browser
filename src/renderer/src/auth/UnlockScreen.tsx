import { useState } from 'react'
import RecoveryScreen from './RecoveryScreen'
import { GENERIC_ERROR, vaultErrorMessage } from '../errors'

interface UnlockScreenProps {
  onUnlocked: () => void
}

export default function UnlockScreen({ onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  if (showRecovery) {
    return <RecoveryScreen onUnlocked={onUnlocked} onCancel={() => setShowRecovery(false)} />
  }

  async function handleUnlock(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.nyx.vault.unlockWithPassword(password, code)
      if (result.ok) {
        // Tab content is already attached by the main process for this path.
        onUnlocked()
        return
      }
      setError(vaultErrorMessage(result.reason, 'Incorrect password or code.'))
      setCode('')
    } catch {
      setError(GENERIC_ERROR)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <h1>NYX Browser</h1>
      <input
        type="password"
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="text"
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={6}
      />
      {error && <p className="auth-error">{error}</p>}
      <button disabled={busy} onClick={handleUnlock}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button className="auth-link" onClick={() => setShowRecovery(true)}>Forgot password?</button>
    </div>
  )
}
