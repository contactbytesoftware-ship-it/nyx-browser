import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import { resolveAddressBarInput } from './resolveAddressBarInput'

interface AddressBarProps {
  tab: TabInfo | null
}

export default function AddressBar({ tab }: AddressBarProps): JSX.Element {
  const [input, setInput] = useState('')

  useEffect(() => {
    if (tab) setInput(tab.url)
  }, [tab?.id, tab?.url])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input))
  }

  return (
    <form className="address-bar" onSubmit={handleSubmit}>
      <button type="button" disabled={!tab?.canGoBack} onClick={() => tab && window.nyx.tabs.goBack(tab.id)}>
        ←
      </button>
      <button type="button" disabled={!tab?.canGoForward} onClick={() => tab && window.nyx.tabs.goForward(tab.id)}>
        →
      </button>
      <button type="button" onClick={() => tab && window.nyx.tabs.reload(tab.id)}>
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
