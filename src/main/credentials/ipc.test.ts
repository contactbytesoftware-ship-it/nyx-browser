import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CredentialV1 } from '../../shared/credential-types'
import type { VaultManager } from '../vault/manager'
import type { TabManager } from '../tabs/manager'

type IpcHandler = (...args: unknown[]) => unknown

// `vi.hoisted` keeps the registry out of the TDZ: vitest lifts `vi.mock` above the
// imports, and the factory runs while './ipc' is being loaded.
const mocks = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => {
      mocks.handlers.set(channel, handler)
    }
  },
  // Loaded (as values) by ../tabs/manager, never constructed in these tests.
  BrowserWindow: class {},
  WebContentsView: class {}
}))

// Imported last purely for readability — the mock above is what './ipc' sees.
import { registerCredentialsIpc } from './ipc'

const CREDENTIAL: CredentialV1 = {
  id: 'cred-1',
  domain: 'bank.com',
  username: 'me',
  password: 'hunter2',
  updatedAt: 0
}

let executeJavaScript: ReturnType<typeof vi.fn>
let activeUrl: string | null

function fakeVault(): VaultManager {
  return {
    getCredentialForDomain: (domain: string) => (domain === CREDENTIAL.domain ? { ...CREDENTIAL } : null)
  } as unknown as VaultManager
}

function fakeTabs(): TabManager {
  return {
    getActiveWebContents: () =>
      activeUrl === null ? null : { getURL: () => activeUrl, executeJavaScript }
  } as unknown as TabManager
}

async function fill(domain: string): Promise<unknown> {
  const handler = mocks.handlers.get('credentials:fill')
  if (!handler) throw new Error('credentials:fill was never registered')
  return handler(null, domain)
}

beforeEach(() => {
  mocks.handlers.clear()
  executeJavaScript = vi.fn(async () => true)
  activeUrl = 'https://bank.com/login'
  registerCredentialsIpc(fakeVault(), fakeTabs())
})

describe('credentials:fill target verification', () => {
  it('fills when the active page really is the confirmed domain', async () => {
    await expect(fill('bank.com')).resolves.toBe(true)
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(String(executeJavaScript.mock.calls[0][0])).toContain('hunter2')
  })

  it('refuses when the user switched to a different tab between confirm and fill', async () => {
    activeUrl = 'https://evil.example/collect'
    await expect(fill('bank.com')).resolves.toBe(false)
    // The security property: the password never even reaches the page.
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses when the page navigated itself between confirm and fill', async () => {
    activeUrl = 'https://bank.com.attacker.test/login'
    await expect(fill('bank.com')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('does not treat a subdomain as a match', async () => {
    activeUrl = 'https://accounts.bank.com/login'
    await expect(fill('bank.com')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses a hostname-less page', async () => {
    activeUrl = 'about:blank'
    await expect(fill('bank.com')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses an unparseable page URL', async () => {
    activeUrl = ''
    await expect(fill('bank.com')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses when there is no active tab', async () => {
    activeUrl = null
    await expect(fill('bank.com')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses when the matching domain has no saved credential', async () => {
    activeUrl = 'https://nothing-saved.test/login'
    await expect(fill('nothing-saved.test')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('ignores port, path, query and hash when comparing hostnames', async () => {
    activeUrl = 'https://bank.com:8443/login?next=/home#form'
    await expect(fill('bank.com')).resolves.toBe(true)
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
  })
})
