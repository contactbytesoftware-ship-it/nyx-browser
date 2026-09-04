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
  autoDownloadValue: undefined as boolean | undefined
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Listener): void => {
      mocks.handlers.set(channel, handler)
    }
  },
  BrowserWindow: class {}
}))

vi.mock('electron-updater', () => ({
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
    }
  }
}))

// Imported last purely for readability — the mocks above are what './manager' sees.
import { attachAutoUpdater, registerUpdaterIpc } from './manager'

function fakeWindow(destroyed = false): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const win = { isDestroyed: () => destroyed, webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

beforeEach(() => {
  mocks.listeners.clear()
  mocks.handlers.clear()
  mocks.checkForUpdates.mockClear()
  mocks.quitAndInstall.mockClear()
  mocks.autoDownloadValue = undefined
})

describe('attachAutoUpdater', () => {
  it('enables silent background downloads', () => {
    attachAutoUpdater(fakeWindow().win)
    expect(mocks.autoDownloadValue).toBe(true)
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
  it('installs the downloaded update on request', async () => {
    registerUpdaterIpc()
    const handler = mocks.handlers.get('updater:restartNow')
    if (!handler) throw new Error('updater:restartNow was never registered')
    await handler(null)
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
