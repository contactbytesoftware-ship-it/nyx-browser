import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import './browser.css'

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])

  useEffect(() => {
    let cancelled = false
    window.nyx.tabs.list().then((existing) => {
      if (cancelled) return
      if (existing.length === 0) {
        window.nyx.tabs.create('https://search.brave.com')
      } else {
        setTabs(existing)
      }
    })
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
        onActivate={(id) => window.nyx.tabs.activate(id)}
        onClose={(id) => window.nyx.tabs.close(id)}
        onNewTab={() => window.nyx.tabs.create('https://search.brave.com')}
        onLock={() => window.nyx.vault.lock()}
      />
      <AddressBar tab={activeTab} />
    </div>
  )
}
