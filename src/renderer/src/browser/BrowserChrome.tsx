import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import { GENERIC_ERROR } from '../errors'
import './browser.css'

const ERROR_DISMISS_MS = 5000

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState('')

  /**
   * Runs a fire-and-forget IPC call. Without this, a main-process throw becomes an
   * unhandled promise rejection and the control simply appears to do nothing.
   */
  const run = useCallback((action: () => Promise<unknown>): void => {
    action().catch(() => setError(GENERIC_ERROR))
  }, [])

  useEffect(() => {
    if (!error) return undefined
    const timer = setTimeout(() => setError(''), ERROR_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    let cancelled = false

    async function loadTabs(): Promise<void> {
      try {
        const existing = await window.nyx.tabs.list()
        if (cancelled) return
        if (existing.length === 0) {
          await window.nyx.tabs.create('https://search.brave.com')
        } else {
          setTabs(existing)
        }
      } catch {
        if (!cancelled) setError(GENERIC_ERROR)
      }
    }

    void loadTabs()
    const unsubscribe = window.nyx.tabs.onChanged((updated) => {
      if (!cancelled) setTabs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null

  return (
    <div className="browser-chrome">
      <TabStrip
        tabs={tabs}
        onActivate={(id) => run(() => window.nyx.tabs.activate(id))}
        onClose={(id) => run(() => window.nyx.tabs.close(id))}
        onNewTab={() => run(() => window.nyx.tabs.create('https://search.brave.com'))}
        onLock={() => run(() => window.nyx.vault.lock())}
      />
      <AddressBar tab={activeTab} onRun={run} />
      {error && <p className="chrome-error">{error}</p>}
    </div>
  )
}
