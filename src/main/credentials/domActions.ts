import type { WebContents } from 'electron'

interface CapturedCredential {
  username: string
  password: string
}

// Runs inside the page's own context via executeJavaScript — no privileged
// APIs are reachable from here, and nothing about this script is injected
// as a standing listener; it runs once, on demand.
const CAPTURE_SCRIPT = `
(() => {
  const passwordField = document.querySelector('input[type="password"]')
  if (!passwordField || !passwordField.value) return null
  const form = passwordField.closest('form') || document
  const usernameField = form.querySelector('input[type="text" i], input[type="email" i], input:not([type])')
  return { username: usernameField ? usernameField.value : '', password: passwordField.value }
})()
`

export async function captureSubmittedCredential(webContents: WebContents): Promise<CapturedCredential | null> {
  try {
    const result = await webContents.executeJavaScript(CAPTURE_SCRIPT)
    return result ?? null
  } catch {
    // The page may already be tearing down for navigation, or block script
    // execution entirely — either way, no capture, never a crash.
    return null
  }
}

function fillScript(username: string, password: string): string {
  // JSON.stringify safely embeds these strings into the script text regardless
  // of what characters they contain (quotes, backticks, `${...}`) — the values
  // come from our own vault, not from the page, but this is still the correct
  // way to embed arbitrary strings into a generated script.
  return `
(() => {
  const passwordField = document.querySelector('input[type="password"]')
  if (!passwordField) return false
  const form = passwordField.closest('form') || document
  const usernameField = form.querySelector('input[type="text" i], input[type="email" i], input:not([type])')

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  if (usernameField) setValue(usernameField, ${JSON.stringify(username)})
  setValue(passwordField, ${JSON.stringify(password)})
  return true
})()
`
}

export async function fillCredential(webContents: WebContents, username: string, password: string): Promise<boolean> {
  try {
    return await webContents.executeJavaScript(fillScript(username, password))
  } catch {
    return false
  }
}

export function attachCredentialCapture(
  webContents: WebContents,
  onCapture: (capture: CapturedCredential & { domain: string }) => void
): void {
  webContents.on('will-navigate', () => {
    let domain: string | null
    try {
      domain = new URL(webContents.getURL()).hostname || null
    } catch {
      domain = null
    }
    if (!domain) return
    // will-navigate fires before the navigation commits, so getURL() above and
    // this capture both still see the page that's about to be left.
    void captureSubmittedCredential(webContents).then((captured) => {
      if (captured && captured.password) onCapture({ ...captured, domain: domain as string })
    })
  })
}
