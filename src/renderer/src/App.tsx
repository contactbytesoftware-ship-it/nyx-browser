import { useState } from 'react'
import AuthGate from './auth/AuthGate'
import BrowserChrome from './browser/BrowserChrome'

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />
  }

  return <BrowserChrome />
}
