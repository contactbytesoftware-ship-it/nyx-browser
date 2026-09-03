import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import { resolveAddressBarInput } from './resolveAddressBarInput'

interface AddressBarProps {
  tab: TabInfo | null
  /** Runs an IPC call, surfacing a rejection instead of leaving it unhandled. */
  onRun: (action: () => Promise<unknown>) => void
}

export default function AddressBar({ tab, onRun }: AddressBarProps): JSX.Element {
  const [input, setInput] = useState('')

  useEffect(() => {
    if (tab) setInput(tab.url)
  }, [tab?.id, tab?.url])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input)))
  }

  return (
    <form className="address-bar" onSubmit={handleSubmit}>
      <button type="button" disabled={!tab?.canGoBack} onClick={() => tab && onRun(() => window.nyx.tabs.goBack(tab.id))}>
        ←
      </button>
      <button
        type="button"
        disabled={!tab?.canGoForward}
        onClick={() => tab && onRun(() => window.nyx.tabs.goForward(tab.id))}
      >
        →
      </button>
      <button type="button" onClick={() => tab && onRun(() => window.nyx.tabs.reload(tab.id))}>
        ⟳
      </button>
      <input
        className="address-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search Brave or enter address"
      />
    </form>
  )
}
