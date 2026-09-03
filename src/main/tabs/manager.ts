import { EventEmitter } from 'node:events'
import { BrowserWindow, WebContentsView } from 'electron'
import type { TabInfo } from '../../shared/tab-types'

const CHROME_HEIGHT = 88

export class TabManager extends EventEmitter {
  private views = new Map<number, WebContentsView>()
  private order: number[] = []
  private activeId: number | null = null
  private nextId = 1

  constructor(
    private readonly window: BrowserWindow,
    private readonly onTabCreated?: (webContents: Electron.WebContents) => void
  ) {
    super()
    window.on('resize', () => this.layoutActive())
  }

  private layoutActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (!view) return
    const bounds = this.window.getContentBounds()
    view.setBounds({ x: 0, y: CHROME_HEIGHT, width: bounds.width, height: Math.max(0, bounds.height - CHROME_HEIGHT) })
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }

  createTab(url: string): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    const wc = view.webContents
    wc.on('page-title-updated', () => this.emitChanged())
    wc.on('did-navigate', () => this.emitChanged())
    wc.on('did-navigate-in-page', () => this.emitChanged())
    wc.on('did-start-loading', () => this.emitChanged())
    wc.on('did-stop-loading', () => this.emitChanged())
    this.onTabCreated?.(wc)
    wc.loadURL(url)
    this.views.set(id, view)
    this.order.push(id)
    this.activateTab(id)
    return id
  }

  activateTab(id: number): void {
    const view = this.views.get(id)
    if (!view) return
    if (this.activeId !== null) {
      const prev = this.views.get(this.activeId)
      if (prev) this.window.contentView.removeChildView(prev)
    }
    this.activeId = id
    this.window.contentView.addChildView(view)
    this.layoutActive()
    this.emitChanged()
  }

  closeTab(id: number): void {
    const view = this.views.get(id)
    if (!view) return
    if (this.activeId === id) this.window.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(id)
    const closedIndex = this.order.indexOf(id)
    this.order = this.order.filter((tabId) => tabId !== id)
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[Math.min(closedIndex, this.order.length - 1)]
      if (next !== undefined) this.activateTab(next)
    }
    this.emitChanged()
  }

  navigate(id: number, url: string): void {
    this.views.get(id)?.webContents.loadURL(url)
  }

  goBack(id: number): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(id: number): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: number): void {
    this.views.get(id)?.webContents.reload()
  }

  list(): TabInfo[] {
    return this.order.map((id) => {
      const wc = this.views.get(id)!.webContents
      return {
        id,
        url: wc.getURL(),
        title: wc.getTitle() || wc.getURL(),
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isActive: id === this.activeId
      }
    })
  }

  hideActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (view) this.window.contentView.removeChildView(view)
  }

  showActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (view) {
      this.window.contentView.addChildView(view)
      this.layoutActive()
    }
  }
}
