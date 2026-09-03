import { useState } from 'react'
import AuthGate from './auth/AuthGate'

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />
  }

  return (
    <div style={{ color: 'white', background: '#111', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Unlocked — browser chrome comes in Task 9.
    </div>
  )
}
