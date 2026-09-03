import { useState } from 'react'

interface RecoveryScreenProps {
  onUnlocked: () => void
  onCancel: () => void
}

export default function RecoveryScreen({ onUnlocked, onCancel }: RecoveryScreenProps): JSX.Element {
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')

  async function handleRecover(): Promise<void> {
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    const result = await window.nyx.vault.unlockWithRecoveryKey(recoveryKey, newPassword)
    if (result.ok) {
      onUnlocked()
      return
    }
    setError(result.reason === 'locked-out' ? 'Too many attempts. Wait a moment and try again.' : 'Incorrect recovery key.')
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
      <button onClick={handleRecover}>Reset and unlock</button>
      <button className="auth-link" onClick={onCancel}>Cancel</button>
    </div>
  )
}
