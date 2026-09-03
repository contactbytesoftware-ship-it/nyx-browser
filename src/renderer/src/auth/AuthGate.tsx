import { useEffect, useState } from 'react'
import SetupScreen from './SetupScreen'
import UnlockScreen from './UnlockScreen'
import './auth.css'

interface AuthGateProps {
  onUnlocked: () => void
}

type Mode = 'loading' | 'setup' | 'unlock'

export default function AuthGate({ onUnlocked }: AuthGateProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('loading')

  useEffect(() => {
    window.nyx.vault.exists().then((exists) => setMode(exists ? 'unlock' : 'setup'))
  }, [])

  if (mode === 'loading') return <div className="auth-screen">Loading…</div>
  if (mode === 'setup') return <SetupScreen onComplete={() => setMode('unlock')} />
  return <UnlockScreen onUnlocked={onUnlocked} />
}
