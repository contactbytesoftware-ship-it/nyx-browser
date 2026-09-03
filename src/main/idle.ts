import { powerMonitor } from 'electron'

const POLL_INTERVAL_MS = 5_000
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 15 * 60

export function startIdleWatcher(timeoutSeconds: number, onIdle: () => void): () => void {
  const interval = setInterval(() => {
    if (powerMonitor.getSystemIdleTime() >= timeoutSeconds) onIdle()
  }, POLL_INTERVAL_MS)
  const onSuspend = (): void => onIdle()
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('lock-screen', onSuspend)
  return () => {
    clearInterval(interval)
    powerMonitor.removeListener('suspend', onSuspend)
    powerMonitor.removeListener('lock-screen', onSuspend)
  }
}
