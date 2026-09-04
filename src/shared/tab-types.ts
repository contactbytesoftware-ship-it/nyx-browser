export interface TabInfo {
  id: number
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

export interface TabsApi {
  list(): Promise<TabInfo[]>
  create(url: string): Promise<number>
  activate(id: number): Promise<void>
  close(id: number): Promise<void>
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  hideActive(): Promise<void>
  showActive(): Promise<void>
  onChanged(callback: (tabs: TabInfo[]) => void): () => void
}
