import type { Input, WebContents } from 'electron'

export function isLockShortcut(input: Input): boolean {
  return input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'l'
}

export function attachLockShortcut(webContents: WebContents, onLock: () => void): void {
  webContents.on('before-input-event', (event, input) => {
    if (isLockShortcut(input)) {
      event.preventDefault()
      onLock()
    }
  })
}
