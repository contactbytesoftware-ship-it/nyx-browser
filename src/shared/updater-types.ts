export interface UpdaterApi {
  onUpdateReady(callback: (version: string) => void): () => void
  restartNow(): void
}
