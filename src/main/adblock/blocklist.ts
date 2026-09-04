// A curated, hand-written set of well-known ad and tracking network hostnames —
// not a filter-list engine and not exhaustive. Catches the most common,
// widely-known trackers with zero dependencies and zero network calls. A real
// EasyList-compatible engine is a documented future upgrade, not this phase's job.
export const AD_TRACKER_BLOCKLIST: readonly string[] = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'adnxs.com',
  'scorecardresearch.com',
  'outbrain.com',
  'taboola.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'adsrvr.org',
  'moatads.com',
  'quantserve.com',
  'quantcount.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'adroll.com',
  'bluekai.com',
  'demdex.net',
  'mathtag.com',
  'agkn.com',
  'indexww.com',
  'contextweb.com',
  'smartadserver.com',
  'media.net',
  'yieldmo.com',
  'sharethrough.com',
  'spotxchange.com',
  'tremorhub.com',
  'adform.net',
  'adition.com',
  'advertising.com',
  'zedo.com',
  'adsafeprotected.com',
  'serving-sys.com',
  'flashtalking.com',
  'adcolony.com',
  'applovin.com',
  'vungle.com',
  'chartboost.com',
  'ironsrc.com',
  'tapjoy.com',
  'mopub.com',
  'inmobi.com',
  'startapp.com',
  'smaato.com',
  'krxd.net',
  'exelator.com',
  'tapad.com',
  'id5-sync.com'
]

export function shouldBlockRequest(url: string, blocklist: readonly string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return blocklist.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`))
}
