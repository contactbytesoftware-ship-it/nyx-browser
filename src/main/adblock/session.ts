import type { Session } from 'electron'
import { AD_TRACKER_BLOCKLIST, shouldBlockRequest } from './blocklist'

export function attachAdBlock(session: Session, isEnabled: () => boolean): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    // Never cancel a top-level navigation. Several blocklist entries (taboola.com,
    // outbrain.com, criteo.com, media.net, applovin.com, …) are ordinary websites
    // as well as ad networks, and ad-blocking is on by default — without this,
    // typing one of those domains produced a blank ERR_BLOCKED_BY_CLIENT page with
    // no explanation. Blocking is for subresources the page pulls in, not for the
    // page the user asked for.
    if (details.resourceType === 'mainFrame') {
      callback({ cancel: false })
      return
    }
    if (isEnabled() && shouldBlockRequest(details.url, AD_TRACKER_BLOCKLIST)) {
      callback({ cancel: true })
      return
    }
    callback({ cancel: false })
  })
}
