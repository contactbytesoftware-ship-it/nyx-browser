import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import type { CredentialV1 } from '../../../shared/credential-types'
import type { SettingsV1 } from '../../../shared/settings-types'
import { DEFAULT_SETTINGS } from '../../../shared/settings-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import CredentialBanner from '../credentials/CredentialBanner'
import SettingsPanel from '../settings/SettingsPanel'
import { extractHostname } from '../credentials/extractHostname'
import { applyTheme } from '../applyTheme'
import { GENERIC_ERROR } from '../errors'
import './browser.css'

const ERROR_DISMISS_MS = 5000
// Derived, not re-typed: the shipped default engine lives in DEFAULT_SETTINGS, and
// a second literal here would silently diverge from it.
const DEFAULT_SEARCH_TEMPLATE = DEFAULT_SETTINGS.searchEngines[0].urlTemplate
const DEFAULT_HOMEPAGE = new URL(DEFAULT_SEARCH_TEMPLATE).origin

interface SubmissionCapture {
  domain: string
  username: string
  password: string
}

function defaultSearchUrlTemplate(current: SettingsV1 | null): string {
  if (!current) return DEFAULT_SEARCH_TEMPLATE
  const engine = current.searchEngines.find((e) => e.id === current.defaultSearchEngineId)
  return engine?.urlTemplate ?? DEFAULT_SEARCH_TEMPLATE
}

/**
 * Where a new tab opens. There is no separate homepage setting, so the default
 * search engine's own origin stands in for one — otherwise picking DuckDuckGo
 * still landed every new tab on Brave.
 */
function defaultHomepage(current: SettingsV1 | null): string {
  const template = defaultSearchUrlTemplate(current)
  try {
    return new URL(template).origin
  } catch {
    // A user-added engine's template is free text and need not be a valid URL.
    return DEFAULT_HOMEPAGE
  }
}

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState('')
  const [activeCredential, setActiveCredential] = useState<CredentialV1 | null>(null)
  const [fillConfirmPending, setFillConfirmPending] = useState(false)
  const [saveCapture, setSaveCapture] = useState<SubmissionCapture | null>(null)
  const [settings, setSettings] = useState<SettingsV1 | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [updateReady, setUpdateReady] = useState<string | null>(null)

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
    window.nyx.settings.get().then(setSettings).catch(() => setError(GENERIC_ERROR))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadTabs(): Promise<void> {
      try {
        const existing = await window.nyx.tabs.list()
        if (cancelled) return
        if (existing.length === 0) {
          // Mount-time `settings` may still be null here (its fetch is a separate
          // effect); defaultHomepage falls back to the shipped engine in that case,
          // which is exactly the URL this used to hardcode.
          await window.nyx.tabs.create(defaultHomepage(settings))
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

  useEffect(() => window.nyx.updater.onUpdateReady((version) => setUpdateReady(version)), [])

  function openSettings(): void {
    run(() => window.nyx.tabs.hideActive())
    setShowSettings(true)
  }

  function closeSettings(): void {
    run(() => window.nyx.tabs.showActive())
    setShowSettings(false)
  }

  function handleSettingsChange(next: SettingsV1): void {
    setSettings(next)
    applyTheme(next)
    run(() => window.nyx.settings.update(next))
  }

  // `settings` can still be null for the first frames after mount, so "the panel is
  // showing" means the flag AND a loaded settings object.
  const settingsOpen = showSettings && settings !== null

  return (
    <div className={`chrome-root${settingsOpen ? ' chrome-root-settings' : ''}`}>
      {settingsOpen && settings ? (
        <SettingsPanel settings={settings} onChange={handleSettingsChange} onClose={closeSettings} />
      ) : (
        <div className="browser-chrome">
          <TabStrip
            tabs={tabs}
            onActivate={(id) => run(() => window.nyx.tabs.activate(id))}
            onClose={(id) => run(() => window.nyx.tabs.close(id))}
            onNewTab={() => run(() => window.nyx.tabs.create(defaultHomepage(settings)))}
            onLock={() => run(() => window.nyx.vault.lock())}
            onOpenSettings={openSettings}
          />
          <AddressBar
            tab={activeTab}
            onRun={run}
            hasCredential={activeCredential !== null}
            onFillRequest={() => setFillConfirmPending(true)}
            searchUrlTemplate={defaultSearchUrlTemplate(settings)}
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
                    run(async () => {
                      const credential = await window.nyx.credentials.save(
                        capture.domain,
                        capture.username,
                        capture.password
                      )
                      // The domain-lookup effect only re-runs on a URL change, so adopt
                      // the saved credential directly here — otherwise the Fill button
                      // would not appear until the user navigated away and back.
                      setActiveCredential(credential)
                    })
                  }
                },
                { label: 'Not now', onClick: () => setSaveCapture(null) }
              ]}
            />
          )}
        </div>
      )}
      {/* Outside both branches on purpose: a rejected settings:update (disk full,
          permissions) sets `error` while the Settings panel is showing, and inside
          the chrome branch nothing ever rendered it — the panel showed the change
          as applied even though it never reached disk. Same reasoning applies to
          the update banner below. */}
      {error && <p className="chrome-error">{error}</p>}
      {/* Gated on the credential banners being absent: .credential-banner is an
          absolutely-positioned full-width bar, so an update banner and a fill/save
          prompt would render exactly on top of each other if both were shown at
          once. The credential prompt is time-sensitive (tied to what the user just
          did); updateReady simply stays true and reappears on the next render once
          neither prompt is pending. */}
      {updateReady && !fillConfirmPending && !saveCapture && (
        <CredentialBanner
          message={`Update ready (v${updateReady}) — restart to install`}
          actions={[
            {
              label: 'Restart Now',
              primary: true,
              onClick: () => window.nyx.updater.restartNow()
            },
            { label: 'Later', onClick: () => setUpdateReady(null) }
          ]}
        />
      )}
    </div>
  )
}
