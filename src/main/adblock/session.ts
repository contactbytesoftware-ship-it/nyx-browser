import type { Session } from 'electron'
import { AD_TRACKER_BLOCKLIST, shouldBlockRequest } from './blocklist'

export function attachAdBlock(session: Session, isEnabled: () => boolean): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    if (isEnabled() && shouldBlockRequest(details.url, AD_TRACKER_BLOCKLIST)) {
      callback({ cancel: true })
      return
    }
    callback({ cancel: false })
  })
}
