import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import type { CredentialV1 } from '../../../shared/credential-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import CredentialBanner from '../credentials/CredentialBanner'
import { extractHostname } from '../credentials/extractHostname'
import { GENERIC_ERROR } from '../errors'
import './browser.css'

const ERROR_DISMISS_MS = 5000

interface SubmissionCapture {
  domain: string
  username: string
  password: string
}

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState('')
  const [activeCredential, setActiveCredential] = useState<CredentialV1 | null>(null)
  const [fillConfirmPending, setFillConfirmPending] = useState(false)
  const [saveCapture, setSaveCapture] = useState<SubmissionCapture | null>(null)

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

  useEffect(() => {
    const domain = activeTab ? extractHostname(activeTab.url) : null
    if (!domain) {
      setActiveCredential(null)
      return undefined
    }
    let cancelled = false
    window.nyx.credentials
      .getForDomain(domain)
      .then((credential) => {
        if (!cancelled) setActiveCredential(credential)
      })
      .catch((err) => {
        // "No saved login" is a resolved null, not a rejection — a rejection here
        // means the IPC call itself failed (e.g. the vault locked mid-lookup), so
        // make it visible in DevTools instead of silently indistinguishable.
        console.warn('Failed to look up saved credential for domain:', err)
        if (!cancelled) setActiveCredential(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab?.url])

  useEffect(() => window.nyx.credentials.onSubmissionDetected((capture) => setSaveCapture(capture)), [])

  useEffect(
    () =>
      window.nyx.credentials.onFillRequested(() => {
        setFillConfirmPending((pending) => pending || activeCredential !== null)
      }),
    [activeCredential]
  )

  useEffect(() => {
    if (activeCredential === null) setFillConfirmPending(false)
  }, [activeCredential])

  return (
    <div className="browser-chrome">
      <TabStrip
        tabs={tabs}
        onActivate={(id) => run(() => window.nyx.tabs.activate(id))}
        onClose={(id) => run(() => window.nyx.tabs.close(id))}
        onNewTab={() => run(() => window.nyx.tabs.create('https://search.brave.com'))}
        onLock={() => run(() => window.nyx.vault.lock())}
      />
      <AddressBar
        tab={activeTab}
        onRun={run}
        hasCredential={activeCredential !== null}
        onFillRequest={() => setFillConfirmPending(true)}
      />
      {fillConfirmPending && activeCredential && (
        <CredentialBanner
          message={`Fill saved login for ${activeCredential.domain}?`}
          actions={[
            {
              label: 'Fill',
              primary: true,
              onClick: () => {
                setFillConfirmPending(false)
                run(() => window.nyx.credentials.fill(activeCredential.domain))
              }
            },
            { label: 'Cancel', onClick: () => setFillConfirmPending(false) }
          ]}
        />
      )}
      {!fillConfirmPending && saveCapture && (
        <CredentialBanner
          message={`Save password for ${saveCapture.domain}?`}
          actions={[
            {
              label: 'Save',
              primary: true,
              onClick: () => {
                const capture = saveCapture
                setSaveCapture(null)
                // The domain-lookup effect only re-runs on a URL change, so adopt
                // the saved credential directly — otherwise the Fill button would
                // not appear until the user navigated away and back.
                run(async () => {
                  const credential = await window.nyx.credentials.save(
                    capture.domain,
                    capture.username,
                    capture.password
                  )
                  setActiveCredential(credential)
                })
              }
            },
            { label: 'Not now', onClick: () => setSaveCapture(null) }
          ]}
        />
      )}
      {error && <p className="chrome-error">{error}</p>}
    </div>
  )
}
