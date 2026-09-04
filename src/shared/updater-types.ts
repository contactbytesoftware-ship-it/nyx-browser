export interface UpdaterApi {
  onUpdateReady(callback: (version: string) => void): () => void
  /**
   * The version of an already-downloaded update waiting to install, or null if
   * none is. `onUpdateReady` alone is not enough: the main process may have
   * finished downloading before this renderer ever subscribed (the app checks at
   * startup, while the vault is usually still locked), and the subscription is
   * torn down again on every re-lock.
   */
  getReady(): Promise<string | null>
  restartNow(): Promise<void>
}
