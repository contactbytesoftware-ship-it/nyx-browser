import { describe, it, expect, vi } from 'vitest'
import type { WebContents } from 'electron'
import { fillScript, captureSubmittedCredential, attachCredentialCapture } from './domActions'

/**
 * `fillScript` is a pure string builder — no WebContents, no Electron, no real
 * page. These tests compile and then actually run the generated script against a
 * minimal stand-in DOM, which is what makes the "safe against arbitrary password
 * characters" claim in domActions.ts verifiable rather than just asserted.
 */

interface FakeField {
  value: string
  events: string[]
}

function runFillScript(script: string): { password: FakeField; username: FakeField; returned: unknown } {
  class FakeInput {
    private inner = ''
    events: string[] = []
    get value(): string {
      return this.inner
    }
    set value(next: string) {
      this.inner = next
    }
    closest(): unknown {
      return form
    }
    dispatchEvent(event: { type: string }): boolean {
      this.events.push(event.type)
      return true
    }
  }

  const passwordField = new FakeInput()
  const usernameField = new FakeInput()
  const form = { querySelector: (): unknown => usernameField }
  const document = { querySelector: (): unknown => passwordField }
  const window = { HTMLInputElement: FakeInput }

  // The parentheses matter: `return` followed by a newline would otherwise hit
  // automatic semicolon insertion and return undefined.
  const returned = new Function('document', 'window', `return (${script})`)(document, window)
  return { password: passwordField, username: usernameField, returned }
}

describe('fillScript', () => {
  it('safely embeds a password containing quotes, backticks, and template-literal syntax', () => {
    const tricky = `p"a'ss\`word${'${injected}'}`
    const script = fillScript('user', tricky)
    // The generated script must remain syntactically valid JS regardless of
    // what characters the password contains — constructing a Function from it
    // should not throw a SyntaxError.
    expect(() => new Function(script)).not.toThrow()
    // And the tricky password must appear verbatim as a JSON string literal,
    // not have broken out of its quoting.
    expect(script).toContain(JSON.stringify(tricky))
  })

  it('writes the tricky password into the field verbatim when the script runs', () => {
    const tricky = `p"a'ss\`word${'${injected}'}`
    const { password, username, returned } = runFillScript(fillScript('u"ser`\\', tricky))
    expect(password.value).toBe(tricky)
    expect(username.value).toBe('u"ser`\\')
    expect(returned).toBe(true)
  })

  it('survives a password made entirely of script-terminating characters', () => {
    // A naive template-literal implementation would be broken by any of these.
    const hostile = '`); alert(1); (() => { return ("'
    const script = fillScript('', hostile)
    expect(() => new Function(script)).not.toThrow()
    expect(runFillScript(script).password.value).toBe(hostile)
  })

  it('survives a password containing a script-closing tag and newlines', () => {
    const hostile = '</script>\n"\n\\"'
    const script = fillScript('', hostile)
    expect(() => new Function(script)).not.toThrow()
    expect(runFillScript(script).password.value).toBe(hostile)
  })

  it('fires input and change events so page-side frameworks observe the fill', () => {
    const { password, username } = runFillScript(fillScript('me', 'hunter2'))
    expect(password.events).toEqual(['input', 'change'])
    expect(username.events).toEqual(['input', 'change'])
  })
})

/** Minimal stand-in for the parts of WebContents these two functions touch. */
function fakeWebContents(options: { url?: string; result?: unknown; throws?: boolean }): {
  wc: WebContents
  executeJavaScript: ReturnType<typeof vi.fn>
  emitWillNavigate: () => void
} {
  const listeners: Array<() => void> = []
  const executeJavaScript = vi.fn(async () => {
    if (options.throws) throw new Error('page is tearing down')
    return options.result
  })
  const wc = {
    getURL: () => options.url ?? 'https://example.com/login',
    executeJavaScript,
    on: (event: string, listener: () => void) => {
      if (event === 'will-navigate') listeners.push(listener)
    }
  } as unknown as WebContents
  return { wc, executeJavaScript, emitWillNavigate: () => listeners.forEach((l) => l()) }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('captureSubmittedCredential', () => {
  it('returns a well-formed capture', async () => {
    const { wc } = fakeWebContents({ result: { username: 'me', password: 'hunter2' } })
    await expect(captureSubmittedCredential(wc)).resolves.toEqual({ username: 'me', password: 'hunter2' })
  })

  it('strips extra properties a hostile page attached to the result', async () => {
    const { wc } = fakeWebContents({
      result: { username: 'me', password: 'hunter2', exfiltrate: 'anything', __proto__: null }
    })
    await expect(captureSubmittedCredential(wc)).resolves.toEqual({ username: 'me', password: 'hunter2' })
  })

  // The value crosses back from the page's own context, so a page that overrides
  // document.querySelector can resolve literally anything here.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an object'],
    ['a number', 42],
    ['an empty object', {}],
    ['a missing username', { password: 'hunter2' }],
    ['a missing password', { username: 'me' }],
    ['a non-string username', { username: 1, password: 'hunter2' }],
    ['a non-string password', { username: 'me', password: { toString: 'nope' } }],
    ['an array', ['me', 'hunter2']]
  ])('rejects %s', async (_label, result) => {
    const { wc } = fakeWebContents({ result })
    await expect(captureSubmittedCredential(wc)).resolves.toBeNull()
  })

  it('returns null instead of throwing when the page refuses to run the script', async () => {
    const { wc } = fakeWebContents({ throws: true })
    await expect(captureSubmittedCredential(wc)).resolves.toBeNull()
  })
})

describe('attachCredentialCapture', () => {
  it('captures on navigation and reports the domain being left', async () => {
    const captures: unknown[] = []
    const { wc, emitWillNavigate } = fakeWebContents({
      url: 'https://bank.com/login',
      result: { username: 'me', password: 'hunter2' }
    })
    attachCredentialCapture(wc, (c) => captures.push(c))
    emitWillNavigate()
    await flush()
    expect(captures).toEqual([{ domain: 'bank.com', username: 'me', password: 'hunter2' }])
  })

  it('does not even run the capture script while the gate is closed', async () => {
    // Tabs stay alive after a vault lock and can still navigate; a locked vault
    // must not keep pulling plaintext passwords out of them.
    const captures: unknown[] = []
    const { wc, executeJavaScript, emitWillNavigate } = fakeWebContents({
      url: 'https://bank.com/login',
      result: { username: 'me', password: 'hunter2' }
    })
    let unlocked = false
    attachCredentialCapture(wc, (c) => captures.push(c), () => unlocked)

    emitWillNavigate()
    await flush()
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(captures).toEqual([])

    // ...and it resumes once the gate reopens.
    unlocked = true
    emitWillNavigate()
    await flush()
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(captures).toHaveLength(1)
  })

  it('ignores a navigation away from a hostname-less page', async () => {
    const captures: unknown[] = []
    const { wc, executeJavaScript, emitWillNavigate } = fakeWebContents({
      url: 'about:blank',
      result: { username: 'me', password: 'hunter2' }
    })
    attachCredentialCapture(wc, (c) => captures.push(c))
    emitWillNavigate()
    await flush()
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(captures).toEqual([])
  })

  it('does not report a capture with an empty password', async () => {
    const captures: unknown[] = []
    const { wc, emitWillNavigate } = fakeWebContents({
      url: 'https://bank.com/login',
      result: { username: 'me', password: '' }
    })
    attachCredentialCapture(wc, (c) => captures.push(c))
    emitWillNavigate()
    await flush()
    expect(captures).toEqual([])
  })
})
