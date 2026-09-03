import { useEffect, useState } from 'react'
import SetupScreen from './SetupScreen'
import UnlockScreen from './UnlockScreen'
import { GENERIC_ERROR } from '../errors'
import './auth.css'

interface AuthGateProps {
  onUnlocked: () => void
}

type Mode = 'loading' | 'setup' | 'unlock' | 'error'

export default function AuthGate({ onUnlocked }: AuthGateProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('loading')

  useEffect(() => {
    let cancelled = false

    async function decideMode(): Promise<void> {
      try {
        // Ask the main process for the REAL lock state first. A renderer reload
        // (Ctrl+R is reachable from Electron's default menu even with
        // autoHideMenuBar) resets this component's state, but the vault may still
        // be genuinely unlocked with the tab WebContentsView attached underneath —
        // showing the lock screen then would make our own trusted UI disagree with
        // reality.
        if (await window.nyx.vault.isUnlocked()) {
          if (!cancelled) onUnlocked()
          return
        }
        const exists = await window.nyx.vault.exists()
        if (!cancelled) setMode(exists ? 'unlock' : 'setup')
      } catch {
        if (!cancelled) setMode('error')
      }
    }

    void decideMode()
    return () => {
      cancelled = true
    }
    // Intentionally mount-only: `onUnlocked` is a stable behaviour from App.tsx,
    // and re-running this would re-query the vault on every render.
  }, [])

  if (mode === 'loading') return <div className="auth-screen">Loading…</div>
  if (mode === 'error') {
    return (
      <div className="auth-screen">
        <h1>NYX Browser</h1>
        <p className="auth-error">{GENERIC_ERROR}</p>
      </div>
    )
  }
  if (mode === 'setup') return <SetupScreen onComplete={() => setMode('unlock')} />
  return <UnlockScreen onUnlocked={onUnlocked} />
}
