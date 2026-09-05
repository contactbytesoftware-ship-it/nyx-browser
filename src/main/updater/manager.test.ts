import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Listener = (...args: unknown[]) => void

// `vi.hoisted` keeps the registry out of the TDZ: vitest lifts `vi.mock` above the
// imports, and the factory runs while './manager' is being loaded.
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  handlers: new Map<string, Listener>(),
  checkForUpdates: vi.fn(async () => undefined),
  quitAndInstall: vi.fn(),
  autoDownloadValue: undefined as boolean | undefined,
  disableWebInstallerValue: undefined as boolean | undefined
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Listener): void => {
      mocks.handlers.set(channel, handler)
    }
  },
  BrowserWindow: class {}
}))

// The real package exposes `autoUpdater` only via its default (CJS `exports`)
// export — see the comment in manager.ts — so the mock must match that shape,
// not provide `autoUpdater` as a named export of the mock module itself.
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, listener: Listener): void => {
        mocks.listeners.set(event, listener)
      },
      checkForUpdates: mocks.checkForUpdates,
      quitAndInstall: mocks.quitAndInstall,
      get autoDownload() {
        return mocks.autoDownloadValue
      },
      set autoDownload(value: boolean | undefined) {
        mocks.autoDownloadValue = value
      },
      get disableWebInstaller() {
        return mocks.disableWebInstallerValue
      },
      set disableWebInstaller(value: boolean | undefined) {
        mocks.disableWebInstallerValue = value
      }
    }
  }
}))

// Re-imported per test rather than statically, because './manager' tracks the
// downloaded-update version in module-level state: a static import would let the
// version recorded by one test leak into the next one's `updater:getReady` result.
// `vi.mock` registrations survive `vi.resetModules`, so the mocks above still
// apply to every reload.
type Manager = typeof import('./manager')
let attachAutoUpdater: Manager['attachAutoUpdater']
let registerUpdaterIpc: Manager['registerUpdaterIpc']

function fakeWindow(destroyed = false): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const win = { isDestroyed: () => destroyed, webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

beforeEach(async () => {
  vi.resetModules()
  mocks.listeners.clear()
  mocks.handlers.clear()
  mocks.checkForUpdates.mockClear()
  mocks.quitAndInstall.mockClear()
  mocks.autoDownloadValue = undefined
  mocks.disableWebInstallerValue = undefined
  ;({ attachAutoUpdater, registerUpdaterIpc } = await import('./manager'))
})

describe('attachAutoUpdater', () => {
  it('enables silent background downloads', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.autoDownloadValue).toBe(true)
  })

  it('turns off the unused web-installer download path', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.disableWebInstallerValue).toBe(true)
  })

  it('checks for updates once on startup', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('pushes the new version to the renderer once a download completes', () => {
    const { win, send } = fakeWindow()
    attachAutoUpdater(win)
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    onDownloaded({ version: '0.2.0' })
    expect(send).toHaveBeenCalledWith('updater:ready', '0.2.0')
  })

  it('does not throw when the window closed before a download finished', () => {
    const { win } = fakeWindow(true)
    attachAutoUpdater(win)
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    expect(() => onDownloaded({ version: '0.2.0' })).not.toThrow()
  })
})

describe('registerUpdaterIpc', () => {
  function getReady(): Promise<unknown> {
    const handler = mocks.handlers.get('updater:getReady')
    if (!handler) throw new Error('updater:getReady was never registered')
    return Promise.resolve(handler(null))
  }

  it('installs the downloaded update on request', async () => {
    registerUpdaterIpc()
    const handler = mocks.handlers.get('updater:restartNow')
    if (!handler) throw new Error('updater:restartNow was never registered')
    await handler(null)
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports no pending update before anything has downloaded', async () => {
    registerUpdaterIpc()
    await expect(getReady()).resolves.toBeNull()
  })

  // The push in attachAutoUpdater fires at startup, typically while the vault is
  // still locked and BrowserChrome is not mounted to hear it. This replay is what
  // lets the banner still appear once the user unlocks.
  it('replays the version to a renderer that asks after the download finished', async () => {
    const { win } = fakeWindow()
    attachAutoUpdater(win)
    registerUpdaterIpc()
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    onDownloaded({ version: '0.2.0' })
    await expect(getReady()).resolves.toBe('0.2.0')
  })

  it('records the version even when the window was already destroyed', async () => {
    const { win } = fakeWindow(true)
    attachAutoUpdater(win)
    registerUpdaterIpc()
    const onDownloaded = mocks.listeners.get('update-downloaded')
    if (!onDownloaded) throw new Error('update-downloaded listener was never registered')
    onDownloaded({ version: '0.2.0' })
    await expect(getReady()).resolves.toBe('0.2.0')
  })
})
