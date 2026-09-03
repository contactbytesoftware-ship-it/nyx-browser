import { useState } from 'react'
import RecoveryScreen from './RecoveryScreen'

interface UnlockScreenProps {
  onUnlocked: () => void
}

export default function UnlockScreen({ onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)

  if (showRecovery) {
    return <RecoveryScreen onUnlocked={onUnlocked} onCancel={() => setShowRecovery(false)} />
  }

  async function handleUnlock(): Promise<void> {
    const result = await window.nyx.vault.unlockWithPassword(password, code)
    if (result.ok) {
      onUnlocked()
      return
    }
    setError(
      result.reason === 'locked-out' ? 'Too many attempts. Wait a moment and try again.' : 'Incorrect password or code.'
    )
    setCode('')
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
      <button onClick={handleUnlock}>Unlock</button>
      <button className="auth-link" onClick={() => setShowRecovery(true)}>Forgot password?</button>
    </div>
  )
}
