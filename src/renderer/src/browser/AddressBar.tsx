import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import { resolveAddressBarInput } from './resolveAddressBarInput'
import { generatePassword } from '../credentials/generatePassword'

interface AddressBarProps {
  tab: TabInfo | null
  /** Runs an IPC call, surfacing a rejection instead of leaving it unhandled. */
  onRun: (action: () => Promise<unknown>) => void
  hasCredential: boolean
  onFillRequest: () => void
  searchUrlTemplate: string
}

const COPIED_RESET_MS = 2000

export default function AddressBar({
  tab,
  onRun,
  hasCredential,
  onFillRequest,
  searchUrlTemplate
}: AddressBarProps): JSX.Element {
  const [input, setInput] = useState('')
  const [justGenerated, setJustGenerated] = useState(false)

  useEffect(() => {
    if (tab) setInput(tab.url)
  }, [tab?.id, tab?.url])

  useEffect(() => {
    if (!justGenerated) return undefined
    const timer = setTimeout(() => setJustGenerated(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [justGenerated])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input, searchUrlTemplate)))
  }

  async function handleGenerate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(generatePassword())
      setJustGenerated(true)
    } catch {
      // Clipboard access can fail in unusual environments; nothing to recover here.
    }
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
      {hasCredential && (
        <button type="button" className="address-fill" onClick={onFillRequest}>
          Fill
        </button>
      )}
      <button type="button" className="address-generate" onClick={handleGenerate}>
        {justGenerated ? 'Copied' : 'Generate'}
      </button>
    </form>
  )
}
