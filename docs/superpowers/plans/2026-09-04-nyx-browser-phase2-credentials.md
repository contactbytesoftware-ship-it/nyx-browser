# NYX Browser Phase 2 (Password Manager + Autofill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted per-domain credential storage to the existing vault, plus a save/fill flow that never grants tab content any privileged access — all DOM interaction is driven from the main process via one-shot `executeJavaScript()` calls triggered by explicit user action or a browser-level navigation event.

**Architecture:** `VaultContentsV1` gains a `credentials` array, persisted through the existing AES-256-GCM container (a new `updateContainerContents` re-encrypts `mainBlob` under the already-derived vault key — no new key derivation). `VaultManager` starts retaining decrypted `contents` in memory while unlocked (it previously discarded them after the TOTP check) so credentials can be read/written without re-deriving keys. Detection/fill reuse Phase 1's `onTabCreated` extension point on `TabManager` to attach a `will-navigate` listener (captures a submitted password field just before navigation) and the fill hotkey listener, mirroring `attachLockShortcut`'s pattern exactly.

**Tech Stack:** Same as Phase 1 — Electron + TypeScript, React, `node:crypto` / Web Crypto, vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-04-nyx-browser-phase2-credentials-design.md](../specs/2026-09-04-nyx-browser-phase2-credentials-design.md)

## Global Constraints

- No privileged code (preload, contextBridge) is ever added to a tab's `webContents` — detection and fill are both one-shot `executeJavaScript()` calls from the main process, triggered only by explicit user action or a navigation event the app already observes.
- Credentials matched by exact hostname only (no public-suffix-list logic).
- One credential per domain — saving again for the same domain overwrites the existing entry.
- No new npm dependencies — `crypto.randomUUID()`/`crypto.getRandomValues()` are built in.
- Filled/captured passwords cross IPC as plain strings, consistent with how the master password already does during unlock.

Note: the spec's sketch of `CredentialsApi` is extended here with `fill(domain)` and `onFillRequested(callback)` — needed so the `Ctrl+Shift+F` hotkey (main process) can ask the *renderer* to show the same confirm-in-chrome-UI step a click would, rather than bypassing it. This keeps the spec's explicit requirement ("click or hotkey opens a confirm step") satisfied by both trigger paths.

---

### Task 1: Data model — `credentials` field + in-place re-encryption

**Files:**
- Create: `src/shared/credential-types.ts`
- Modify: `src/main/vault/container.ts`
- Modify (test): `src/main/vault/container.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 4, 6): `interface CredentialV1 { id: string; domain: string; username: string; password: string; notes?: string; updatedAt: number }` (in `src/shared/credential-types.ts`), `VaultContentsV1` gains `credentials: CredentialV1[]`, `updateContainerContents(container: VaultContainer, vaultKey: Buffer, contents: VaultContentsV1): VaultContainer`.

- [ ] **Step 1: Write `src/shared/credential-types.ts`**

```ts
export interface CredentialV1 {
  id: string
  domain: string
  username: string
  password: string
  notes?: string
  updatedAt: number
}
```

- [ ] **Step 2: Write the failing tests in `src/main/vault/container.test.ts`**

Modify the top of the file (the `contents` const now needs the new required field) and append a new `describe` block. Full replacement of the file's top section:

```ts
// src/main/vault/container.test.ts
import { describe, it, expect } from 'vitest'
import {
  createContainer, unlockWithPassword, unlockWithRecoveryKey,
  serializeContainer, parseContainer, updateContainerContents, VaultContentsV1
} from './container'

const contents: VaultContentsV1 = {
  version: 1,
  totpSecret: 'JBSWY3DPEHPK3PXP',
  settings: { theme: 'dark' },
  credentials: []
}
```

(The rest of the existing file's test bodies are unchanged — only the import line, which now also imports `updateContainerContents`, and the `contents` const, which now has `credentials: []`, change. Every existing `describe` block stays exactly as it was.)

Append this new `describe` block at the end of the file:

```ts
describe('updateContainerContents', () => {
  it('re-encrypts mainBlob under the same vault key, leaving both unlock paths working', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { vaultKey } = unlockWithPassword(container, 'correct horse')
    const updated: VaultContentsV1 = {
      ...contents,
      credentials: [{ id: '1', domain: 'example.com', username: 'me', password: 'hunter2', updatedAt: 0 }]
    }
    const newContainer = updateContainerContents(container, vaultKey, updated)
    expect(unlockWithPassword(newContainer, 'correct horse').contents).toEqual(updated)
    expect(unlockWithRecoveryKey(newContainer, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF').contents).toEqual(updated)
  })

  it('leaves the wrapped keys and salts unchanged', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { vaultKey } = unlockWithPassword(container, 'correct horse')
    const newContainer = updateContainerContents(container, vaultKey, contents)
    expect(newContainer.passwordSalt).toEqual(container.passwordSalt)
    expect(newContainer.passwordWrappedKey).toEqual(container.passwordWrappedKey)
    expect(newContainer.recoverySalt).toEqual(container.recoverySalt)
    expect(newContainer.recoveryWrappedKey).toEqual(container.recoveryWrappedKey)
  })
})
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run src/main/vault/container.test.ts`
Expected: the 7 pre-existing tests still PASS (the `credentials: []` addition doesn't change their behavior); the 2 new tests FAIL — `updateContainerContents` is not exported yet.

- [ ] **Step 4: Modify `src/main/vault/container.ts`**

The current file (after Phase 1's final fix wave) starts like this — do NOT replace this whole block, only make the two targeted edits described below it:

```ts
import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, SALT_LEN, KEY_LEN, NONCE_LEN, AUTH_TAG_LEN } from './crypto'

/** The only vault content version this build understands. */
export const VAULT_VERSION = 1

export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
}
```

Edit 1 — add one import line, right after the existing `import { deriveKey, ... } from './crypto'` line (do not touch or remove anything else, `VAULT_VERSION` stays exactly where it is):
```ts
import type { CredentialV1 } from '../../shared/credential-types'
```

Edit 2 — add one field to the `VaultContentsV1` interface, changing:
```ts
export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
}
```
to:
```ts
export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
  credentials: CredentialV1[]
}
```

Everything else in the file (`VaultContentsCorruptError`, `openContents`, `VaultContainer`, `MAGIC`, `WRAPPED_KEY_LEN`, `createContainer`, `unlockWithPassword`, `unlockWithRecoveryKey`, `serializeContainer`, `parseContainer`) is unchanged — leave it exactly as it is.

Add this new function at the end of the file:

```ts
export function updateContainerContents(container: VaultContainer, vaultKey: Buffer, contents: VaultContentsV1): VaultContainer {
  return { ...container, mainBlob: encryptJSON(contents, vaultKey) }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/container.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/credential-types.ts src/main/vault/container.ts src/main/vault/container.test.ts
git commit -m "feat: add credentials field to vault contents and in-place re-encryption

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: VaultManager credential storage

**Files:**
- Modify: `src/main/vault/manager.ts`
- Modify (test): `src/main/vault/manager.test.ts`

**Interfaces:**
- Consumes: `updateContainerContents`, `CredentialV1` (Task 1).
- Produces (used by Task 4's IPC layer): on `VaultManager` — `listCredentials(): CredentialV1[]`, `getCredentialForDomain(domain: string): CredentialV1 | null`, `saveCredential(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1>`, `deleteCredential(id: string): Promise<void>`. All four throw synchronously (the two sync ones) or reject (the two async ones) if called while the vault is locked — Task 4's IPC handlers are only reachable while unlocked in practice (same assumption Phase 1 already made for the rest of the vault IPC), so this is a defensive guard, not a case the UI needs to design around.
- Design note: `VaultManager` previously discarded decrypted `contents` right after checking the TOTP code — it only kept the derived key. This task makes it retain `contents` in memory for the lifetime of the unlock (mirroring how `vaultKey` already works: set on unlock, nulled on `lock()`), since credential reads/writes need it without re-deriving keys from the password every time.

- [ ] **Step 1: Write the failing tests**

Append this new `describe` block to the end of `src/main/vault/manager.test.ts` (after the existing `'corrupt and unsupported vaults'` block, still inside the same file — no changes to any existing test):

```ts
describe('credentials', () => {
  async function unlockedManager(): Promise<VaultManager> {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    return manager
  }

  it('starts with an empty credential list', async () => {
    const manager = await unlockedManager()
    expect(manager.listCredentials()).toEqual([])
    expect(manager.getCredentialForDomain('example.com')).toBeNull()
  })

  it('saves a credential and returns it', async () => {
    const manager = await unlockedManager()
    const saved = await manager.saveCredential('example.com', 'me', 'hunter2')
    expect(saved.domain).toBe('example.com')
    expect(saved.username).toBe('me')
    expect(saved.password).toBe('hunter2')
    expect(saved.id).toBeTruthy()
    expect(manager.listCredentials()).toEqual([saved])
    expect(manager.getCredentialForDomain('example.com')).toEqual(saved)
  })

  it('overwrites the existing entry when saving again for the same domain', async () => {
    const manager = await unlockedManager()
    const first = await manager.saveCredential('example.com', 'me', 'oldpass')
    const second = await manager.saveCredential('example.com', 'me', 'newpass')
    expect(second.id).toBe(first.id)
    expect(manager.listCredentials()).toHaveLength(1)
    expect(manager.getCredentialForDomain('example.com')?.password).toBe('newpass')
  })

  it('deletes a credential', async () => {
    const manager = await unlockedManager()
    const saved = await manager.saveCredential('example.com', 'me', 'hunter2')
    await manager.deleteCredential(saved.id)
    expect(manager.listCredentials()).toEqual([])
    expect(manager.getCredentialForDomain('example.com')).toBeNull()
  })

  it('deleting an unknown id is a no-op', async () => {
    const manager = await unlockedManager()
    await manager.saveCredential('example.com', 'me', 'hunter2')
    await manager.deleteCredential('does-not-exist')
    expect(manager.listCredentials()).toHaveLength(1)
  })

  it(
    'persists credentials across a reopen (re-unlock) of the vault',
    async () => {
      const manager = new VaultManager(vaultPath)
      const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
      const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
      await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
      await manager.saveCredential('example.com', 'me', 'hunter2')
      manager.lock()

      const reopened = new VaultManager(vaultPath)
      await reopened.unlockWithPassword('correct horse battery staple', codeFor(secret))
      expect(reopened.getCredentialForDomain('example.com')?.password).toBe('hunter2')
    },
    SLOW
  )

  it('throws when reading or writing credentials while locked', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    expect(() => manager.listCredentials()).toThrow()
    await expect(manager.saveCredential('example.com', 'me', 'hunter2')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/manager.test.ts`
Expected: the 12 pre-existing tests still PASS; the 7 new tests FAIL — `listCredentials`/`getCredentialForDomain`/`saveCredential`/`deleteCredential` don't exist on `VaultManager` yet (TypeScript would also fail to compile the test file, which is expected at this point).

- [ ] **Step 3: Modify `src/main/vault/manager.ts`**

The current file's imports and class field declarations look like this — do NOT replace the whole file, apply the four targeted edits below it:

```ts
import { loadRawFile, saveRawFile, backupCorruptFile } from './crypto'
import {
  createContainer,
  unlockWithPassword as containerUnlockWithPassword,
  unlockWithRecoveryKey as containerUnlockWithRecoveryKey,
  serializeContainer,
  parseContainer,
  VaultContentsCorruptError,
  VAULT_VERSION,
  VaultContainer,
  VaultContentsV1
} from './container'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'
import { generateRecoveryKey } from './recovery'
import type { RecoveryUnlockResult, SetupResult, UnlockResult } from '../../shared/vault-types'
```

and

```ts
export class VaultManager {
  private container: VaultContainer | null = null
  private vaultKey: Buffer | null = null
  private failedAttempts = 0
  private lockedUntil = 0
```

**Edit 1 — imports.** Add `updateContainerContents` to the existing `from './container'` import, and add two new import lines below it:
```ts
import { loadRawFile, saveRawFile, backupCorruptFile } from './crypto'
import {
  createContainer,
  unlockWithPassword as containerUnlockWithPassword,
  unlockWithRecoveryKey as containerUnlockWithRecoveryKey,
  serializeContainer,
  parseContainer,
  updateContainerContents,
  VaultContentsCorruptError,
  VAULT_VERSION,
  VaultContainer,
  VaultContentsV1
} from './container'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'
import { generateRecoveryKey } from './recovery'
import { randomUUID } from 'node:crypto'
import type { CredentialV1 } from '../../shared/credential-types'
import type { RecoveryUnlockResult, SetupResult, UnlockResult } from '../../shared/vault-types'
```

**Edit 2 — new field.** Add `private contents: VaultContentsV1 | null = null` alongside the existing fields:
```ts
export class VaultManager {
  private container: VaultContainer | null = null
  private vaultKey: Buffer | null = null
  private contents: VaultContentsV1 | null = null
  private failedAttempts = 0
  private lockedUntil = 0
```

**Edit 3 — `setup()` initializes an empty credential list.** Change:
```ts
    const contents: VaultContentsV1 = { version: VAULT_VERSION, totpSecret, settings: {} }
```
to:
```ts
    const contents: VaultContentsV1 = { version: VAULT_VERSION, totpSecret, settings: {}, credentials: [] }
```

**Edit 4 — retain `contents` across unlock, clear it on lock.** In `unlockWithPassword`, change the success path from:
```ts
    this.vaultKey = unlocked.vaultKey
    this.registerSuccess()
    return { ok: true }
```
to:
```ts
    this.vaultKey = unlocked.vaultKey
    this.contents = unlocked.contents
    this.registerSuccess()
    return { ok: true }
```

In `unlockWithRecoveryKey`, change the success path at the end of the method from:
```ts
    this.container = rekeyed
    this.vaultKey = newVaultKey
    return { ok: true, recoveryKey: newRecoveryKey }
```
to:
```ts
    this.container = rekeyed
    this.vaultKey = newVaultKey
    this.contents = unlocked.contents
    return { ok: true, recoveryKey: newRecoveryKey }
```

In `lock()`, change:
```ts
  lock(): void {
    this.vaultKey?.fill(0)
    this.vaultKey = null
  }
```
to:
```ts
  lock(): void {
    this.vaultKey?.fill(0)
    this.vaultKey = null
    this.contents = null
  }
```

**Edit 5 — add the credential methods and a `persistContents` helper.** Add these as new methods on the class, right before the closing `lock()` method (or anywhere else in the class body — placement doesn't matter, TypeScript classes don't care about method order):

```ts
  private async persistContents(): Promise<void> {
    if (!this.container || !this.vaultKey || !this.contents) {
      throw new Error('cannot persist credentials while the vault is locked')
    }
    const updated = updateContainerContents(this.container, this.vaultKey, this.contents)
    await saveRawFile(this.vaultPath, serializeContainer(updated))
    this.container = updated
  }

  listCredentials(): CredentialV1[] {
    if (!this.contents) throw new Error('cannot list credentials while the vault is locked')
    return [...this.contents.credentials]
  }

  getCredentialForDomain(domain: string): CredentialV1 | null {
    if (!this.contents) throw new Error('cannot read credentials while the vault is locked')
    return this.contents.credentials.find((c) => c.domain === domain) ?? null
  }

  async saveCredential(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1> {
    if (!this.contents) throw new Error('cannot save a credential while the vault is locked')
    const existing = this.contents.credentials.find((c) => c.domain === domain)
    const credential: CredentialV1 = {
      id: existing?.id ?? randomUUID(),
      domain,
      username,
      password,
      notes,
      updatedAt: Date.now()
    }
    this.contents = {
      ...this.contents,
      credentials: existing
        ? this.contents.credentials.map((c) => (c.domain === domain ? credential : c))
        : [...this.contents.credentials, credential]
    }
    await this.persistContents()
    return credential
  }

  async deleteCredential(id: string): Promise<void> {
    if (!this.contents) throw new Error('cannot delete a credential while the vault is locked')
    this.contents = { ...this.contents, credentials: this.contents.credentials.filter((c) => c.id !== id) }
    await this.persistContents()
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/manager.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/manager.ts src/main/vault/manager.test.ts
git commit -m "feat: add credential storage to VaultManager (list/save/delete, persisted)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Password generator + hostname extraction (pure renderer functions)

**Files:**
- Create: `src/renderer/src/credentials/generatePassword.ts`
- Test: `src/renderer/src/credentials/generatePassword.test.ts`
- Create: `src/renderer/src/credentials/extractHostname.ts`
- Test: `src/renderer/src/credentials/extractHostname.test.ts`

**Interfaces:**
- Produces (used by Task 6): `generatePassword(): string` — a 20-character password from Web Crypto (`crypto.getRandomValues`), unbiased via rejection sampling (no `% length` shortcuts, matching the technique the vault's recovery-key generator already uses). `extractHostname(url: string): string | null` — the exact hostname (subdomain-sensitive, no public-suffix-list logic per the spec), or `null` if the URL doesn't parse or has no hostname (e.g. `about:blank`).
- Both are pure functions with no dependency on any other Phase 2 task — implement in either order, or in parallel.

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/src/credentials/generatePassword.test.ts
import { describe, it, expect } from 'vitest'
import { generatePassword } from './generatePassword'

describe('generatePassword', () => {
  it('returns a 20-character password', () => {
    expect(generatePassword()).toHaveLength(20)
  })

  it('only uses characters from the expected charset', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*\-_=+]+$/)
  })

  it('returns a different password each call', () => {
    expect(generatePassword()).not.toBe(generatePassword())
  })

  it('draws from a wide enough range that all character classes appear across many generations', () => {
    const samples = Array.from({ length: 50 }, () => generatePassword()).join('')
    expect(samples).toMatch(/[A-Z]/)
    expect(samples).toMatch(/[a-z]/)
    expect(samples).toMatch(/[0-9]/)
    expect(samples).toMatch(/[!@#$%^&*\-_=+]/)
  })
})
```

```ts
// src/renderer/src/credentials/extractHostname.test.ts
import { describe, it, expect } from 'vitest'
import { extractHostname } from './extractHostname'

describe('extractHostname', () => {
  it('extracts the hostname from a plain URL', () => {
    expect(extractHostname('https://example.com/path')).toBe('example.com')
  })

  it('extracts the hostname ignoring a port', () => {
    expect(extractHostname('https://example.com:8443/path')).toBe('example.com')
  })

  it('extracts the hostname ignoring query and hash', () => {
    expect(extractHostname('https://example.com/path?x=1#y')).toBe('example.com')
  })

  it('distinguishes a subdomain from its parent domain', () => {
    expect(extractHostname('https://accounts.example.com')).toBe('accounts.example.com')
    expect(extractHostname('https://accounts.example.com')).not.toBe('example.com')
  })

  it('returns null for an unparseable URL', () => {
    expect(extractHostname('not a url')).toBeNull()
  })

  it('returns null for a hostname-less scheme', () => {
    expect(extractHostname('about:blank')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/credentials/generatePassword.test.ts src/renderer/src/credentials/extractHostname.test.ts`
Expected: FAIL — neither module exists yet.

- [ ] **Step 3: Implement `src/renderer/src/credentials/generatePassword.ts`**

```ts
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'
const LENGTH = 20

function randomIndex(max: number): number {
  // Rejection sampling: discard draws that would introduce modulo bias when
  // 2^32 isn't a multiple of `max` — the same technique the vault's
  // recovery-key generator uses (src/main/vault/recovery.ts).
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % max
}

export function generatePassword(): string {
  let result = ''
  for (let i = 0; i < LENGTH; i++) {
    result += CHARSET[randomIndex(CHARSET.length)]
  }
  return result
}
```

- [ ] **Step 4: Implement `src/renderer/src/credentials/extractHostname.ts`**

```ts
export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/credentials/generatePassword.test.ts src/renderer/src/credentials/extractHostname.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/credentials/generatePassword.ts src/renderer/src/credentials/generatePassword.test.ts src/renderer/src/credentials/extractHostname.ts src/renderer/src/credentials/extractHostname.test.ts
git commit -m "feat: add password generator and hostname extraction helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: DOM capture/fill (main process, no privileged code on tabs)

Like `TabManager` and `idle.ts` in Phase 1, this is Electron-specific code (`webContents.executeJavaScript`, event wiring) with no automated test — verified by build and manual trace, not vitest. Note the same standing limitation as every Electron-specific task before it: there is no GUI/display server available anywhere in this process, so the actual DOM behavior has never been visually confirmed by anyone — only by code review and a clean build.

**Files:**
- Create: `src/main/credentials/domActions.ts`
- Modify: `src/main/tabs/manager.ts`

**Interfaces:**
- Produces (used by Task 5): `captureSubmittedCredential(webContents: Electron.WebContents): Promise<{ username: string; password: string } | null>`, `fillCredential(webContents: Electron.WebContents, username: string, password: string): Promise<boolean>`, `attachCredentialCapture(webContents: Electron.WebContents, onCapture: (capture: { domain: string; username: string; password: string }) => void): void`. `TabManager` gains `getActiveWebContents(): Electron.WebContents | null`.
- Design note: mirrors `src/main/shortcuts.ts`'s shape exactly — a detection/action function plus a thin `attachX` wiring function in the same file, attached per-tab through the same `onTabCreated` extension point Phase 1 already built for the lock shortcut. `TabManager` itself is not modified to know anything about credentials — it only gains a generic accessor.

- [ ] **Step 1: Implement `src/main/credentials/domActions.ts`**

```ts
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
```

- [ ] **Step 2: Add `getActiveWebContents()` to `src/main/tabs/manager.ts`**

Add this method anywhere in the class body (e.g. right after `list()`):

```ts
  getActiveWebContents(): Electron.WebContents | null {
    if (this.activeId === null) return null
    return this.views.get(this.activeId)?.webContents ?? null
  }
```

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build`
Expected: exit 0, no TypeScript errors.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main/credentials/domActions.ts src/main/tabs/manager.ts
git commit -m "feat: add credential capture/fill via one-shot executeJavaScript

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Credentials IPC, fill hotkey, and wiring into `main/index.ts` + preload

**Files:**
- Modify: `src/main/shortcuts.ts`
- Modify (test): `src/main/shortcuts.test.ts`
- Modify: `src/shared/credential-types.ts`
- Create: `src/main/credentials/ipc.ts`
- Modify: `src/preload/index.ts` (full file replacement)
- Modify: `src/renderer/src/nyx-global.d.ts` (full file replacement)
- Modify: `src/main/index.ts` (full file replacement)

**Interfaces:**
- Consumes: `captureSubmittedCredential`, `fillCredential`, `attachCredentialCapture`, `TabManager.getActiveWebContents()` (Task 4); `VaultManager`'s credential methods (Task 2).
- Produces (used by Task 6): `window.nyx.credentials`, typed as `CredentialsApi`, with `list`, `getForDomain`, `save`, `delete`, `fill` (all Promise-returning) plus two push subscriptions, `onSubmissionDetected` and `onFillRequested`, each returning an unsubscribe function — same shape as the existing `tabs.onChanged`/`vault.onLocked`.
- Design note: `Ctrl+Shift+F` (the fill hotkey) does NOT bypass confirmation — pressing it sends `credentials:fillRequested` to the renderer, which is expected to show the same confirm step a click on the address-bar indicator would (Task 6's job). The actual DOM fill only happens once the renderer calls `credentials:fill` after that confirmation.

- [ ] **Step 1: Write the failing test for the fill shortcut**

Append to `src/main/shortcuts.test.ts` (the existing `isLockShortcut` import and describe block are unchanged):

```ts
import { describe, it, expect } from 'vitest'
import { isLockShortcut, isFillShortcut } from './shortcuts'
```

(only the import line changes — add `isFillShortcut` to the existing import. Then append this new block at the end of the file:)

```ts
describe('isFillShortcut', () => {
  it('matches Ctrl+Shift+F on keydown', () => {
    expect(isFillShortcut({ type: 'keyDown', control: true, shift: true, key: 'F' } as Electron.Input)).toBe(true)
  })

  it('rejects without shift', () => {
    expect(isFillShortcut({ type: 'keyDown', control: true, shift: false, key: 'f' } as Electron.Input)).toBe(false)
  })

  it('rejects a different key', () => {
    expect(isFillShortcut({ type: 'keyDown', control: true, shift: true, key: 'l' } as Electron.Input)).toBe(false)
  })

  it('does not match the lock shortcut', () => {
    const lockInput = { type: 'keyDown', control: true, shift: true, key: 'l' } as Electron.Input
    expect(isFillShortcut(lockInput)).toBe(false)
    expect(isLockShortcut(lockInput)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/shortcuts.test.ts`
Expected: the 5 pre-existing `isLockShortcut` tests still PASS; the 4 new tests FAIL — `isFillShortcut` is not exported yet.

- [ ] **Step 3: Add `isFillShortcut`/`attachFillShortcut` to `src/main/shortcuts.ts`**

The current file is short — append these two functions at the end, after the existing `attachLockShortcut`:

```ts
export function isFillShortcut(input: Input): boolean {
  return input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'f'
}

export function attachFillShortcut(webContents: WebContents, onFillRequested: () => void): void {
  webContents.on('before-input-event', (event, input) => {
    if (isFillShortcut(input)) {
      event.preventDefault()
      onFillRequested()
    }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/shortcuts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Add `CredentialsApi` to `src/shared/credential-types.ts`**

Append this interface to the file (the existing `CredentialV1` interface from Task 1 is unchanged):

```ts
export interface CredentialsApi {
  list(): Promise<CredentialV1[]>
  getForDomain(domain: string): Promise<CredentialV1 | null>
  save(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1>
  delete(id: string): Promise<void>
  fill(domain: string): Promise<boolean>
  onSubmissionDetected(callback: (capture: { domain: string; username: string; password: string }) => void): () => void
  onFillRequested(callback: () => void): () => void
}
```

- [ ] **Step 6: Implement `src/main/credentials/ipc.ts`**

```ts
import { ipcMain } from 'electron'
import { VaultManager } from '../vault/manager'
import { TabManager } from '../tabs/manager'
import { fillCredential } from './domActions'

export function registerCredentialsIpc(vault: VaultManager, tabs: TabManager): void {
  ipcMain.handle('credentials:list', () => vault.listCredentials())
  ipcMain.handle('credentials:getForDomain', (_e, domain: string) => vault.getCredentialForDomain(domain))
  ipcMain.handle('credentials:save', (_e, domain: string, username: string, password: string, notes?: string) =>
    vault.saveCredential(domain, username, password, notes)
  )
  ipcMain.handle('credentials:delete', (_e, id: string) => vault.deleteCredential(id))
  ipcMain.handle('credentials:fill', async (_e, domain: string) => {
    const credential = vault.getCredentialForDomain(domain)
    const webContents = tabs.getActiveWebContents()
    if (!credential || !webContents) return false
    return fillCredential(webContents, credential.username, credential.password)
  })
}
```

- [ ] **Step 7: Replace `src/preload/index.ts` entirely**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'
import type { CredentialsApi } from '../shared/credential-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  unlockComplete: () => ipcRenderer.invoke('vault:unlockComplete'),
  lock: () => ipcRenderer.invoke('vault:lock'),
  onLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:locked', listener)
    return () => ipcRenderer.removeListener('vault:locked', listener)
  }
}

const tabsApi: TabsApi = {
  list: () => ipcRenderer.invoke('tabs:list'),
  create: (url) => ipcRenderer.invoke('tabs:create', url),
  activate: (id) => ipcRenderer.invoke('tabs:activate', id),
  close: (id) => ipcRenderer.invoke('tabs:close', id),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', id, url),
  goBack: (id) => ipcRenderer.invoke('tabs:goBack', id),
  goForward: (id) => ipcRenderer.invoke('tabs:goForward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  onChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, tabs: TabInfo[]): void => callback(tabs)
    ipcRenderer.on('tabs:changed', listener)
    return () => ipcRenderer.removeListener('tabs:changed', listener)
  }
}

const credentialsApi: CredentialsApi = {
  list: () => ipcRenderer.invoke('credentials:list'),
  getForDomain: (domain) => ipcRenderer.invoke('credentials:getForDomain', domain),
  save: (domain, username, password, notes) =>
    ipcRenderer.invoke('credentials:save', domain, username, password, notes),
  delete: (id) => ipcRenderer.invoke('credentials:delete', id),
  fill: (domain) => ipcRenderer.invoke('credentials:fill', domain),
  onSubmissionDetected: (callback) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      capture: { domain: string; username: string; password: string }
    ): void => callback(capture)
    ipcRenderer.on('credentials:submissionDetected', listener)
    return () => ipcRenderer.removeListener('credentials:submissionDetected', listener)
  },
  onFillRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('credentials:fillRequested', listener)
    return () => ipcRenderer.removeListener('credentials:fillRequested', listener)
  }
}

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi, tabs: tabsApi, credentials: credentialsApi })
```

- [ ] **Step 8: Replace `src/renderer/src/nyx-global.d.ts` entirely**

```ts
import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'
import type { CredentialsApi } from '../../shared/credential-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi; credentials: CredentialsApi }
  }
}

export {}
```

- [ ] **Step 9: Replace `src/main/index.ts` entirely**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'
import { registerCredentialsIpc } from './credentials/ipc'
import { attachCredentialCapture } from './credentials/domActions'
import { attachLockShortcut, attachFillShortcut } from './shortcuts'
import { startIdleWatcher, DEFAULT_IDLE_TIMEOUT_SECONDS } from './idle'

// Must run before anything reads app.getPath('userData'), which is derived from
// the app name — so at module scope, not inside app.whenReady().
app.setName('NYX Browser')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  const win = createWindow()

  let tabs: TabManager
  const lock = (): void => {
    if (!vault.isUnlocked) return
    vault.lock()
    tabs.hideActive()
    win.webContents.send('vault:locked')
  }
  const unlock = (): void => {
    tabs.showActive()
  }
  const requestFill = (): void => {
    win.webContents.send('credentials:fillRequested')
  }

  tabs = new TabManager(win, (wc) => {
    attachLockShortcut(wc, lock)
    attachFillShortcut(wc, requestFill)
    attachCredentialCapture(wc, (capture) => win.webContents.send('credentials:submissionDetected', capture))
  })
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  registerCredentialsIpc(vault, tabs)
  attachLockShortcut(win.webContents, lock)
  attachFillShortcut(win.webContents, requestFill)

  const stopIdleWatcher = startIdleWatcher(DEFAULT_IDLE_TIMEOUT_SECONDS, lock)
  win.on('closed', stopIdleWatcher)

  // Zero the in-memory vault key on quit, per the spec's key-hygiene requirement.
  app.on('will-quit', () => vault.lock())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 10: Verify**

Run: `npx vitest run src/main/shortcuts.test.ts` — expect PASS (9 tests).
Run: `npm run build` — expect exit 0, no errors.
Run: `npm run typecheck` — expect exit 0.

Then, since there is no GUI/display server available (same standing limitation as every Electron-wiring task before it), manually trace: every `credentials:*` channel name in `src/main/credentials/ipc.ts` has an exact string match in `src/preload/index.ts`'s `credentialsApi`; `registerCredentialsIpc(vault, tabs)` is actually called in `main/index.ts`; `attachFillShortcut`/`attachCredentialCapture` are attached both to `win.webContents` (chrome) and inside the `onTabCreated` callback (every tab) where the design requires it (fill shortcut on both, capture only on tabs).

- [ ] **Step 11: Commit**

```bash
git add src/main/shortcuts.ts src/main/shortcuts.test.ts src/shared/credential-types.ts src/main/credentials/ipc.ts src/preload/index.ts src/renderer/src/nyx-global.d.ts src/main/index.ts
git commit -m "feat: wire credentials IPC, fill hotkey, and preload API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer UI (fill button, save-password banner, generate)

**Files:**
- Create: `src/renderer/src/credentials/CredentialBanner.tsx`
- Modify: `src/renderer/src/browser/AddressBar.tsx`
- Modify: `src/renderer/src/browser/BrowserChrome.tsx`
- Modify: `src/renderer/src/browser/browser.css`

**Interfaces:**
- Consumes: `window.nyx.credentials` (Task 5), `extractHostname`/`generatePassword` (Task 3), `GENERIC_ERROR` from the existing `src/renderer/src/errors.ts`.
- Produces: nothing further consumes this — it's the top of the credentials feature.
- **Deviation from the spec's sketch, decided here:** the spec described a "Generate" button living inside the save-password banner, to double as signup-form support. That doesn't actually work: the save banner only appears *after* `will-navigate` has already captured a submitted password — by then, if it was a signup form, the account was already created with whatever password the user actually typed. Swapping in a freshly generated password at that point would save a password into the vault that doesn't match the real account. Instead, Generate is a standalone button in the address bar: click it, a strong password is generated and copied to the clipboard, the user pastes it into whatever form they're filling (signup or otherwise) *before* submitting, and the normal save-capture flow then correctly captures and offers to save exactly what was actually submitted. The save banner itself is just Save / Not now.
- **Chrome height constraint:** `.browser-chrome` is a hard `--chrome-height` (88px) box — anything below it is physically covered by the tab's `WebContentsView` (see the existing `.chrome-error` rule's comment in `browser.css`). Both new UI pieces (fill confirm, save banner) are small absolutely-positioned overlays *within* that existing box, following the same pattern `.chrome-error` already established — not new rows, not a modal, and not the `unlockComplete`-style full takeover Phase 1 used for the one-time recovery-key reveal (that was justified for a critical one-time secret; a routine "save this password?" prompt doesn't warrant hiding the page).
- This task has no automated test (React UI wired to real IPC, same category as Phase 1's Tasks 8/11) — verified by `npm run build`/`npm run typecheck` plus manual trace, with the same standing caveat: no GUI/display server has been available anywhere in this process, so click through the real result yourself.

- [ ] **Step 1: Implement `src/renderer/src/credentials/CredentialBanner.tsx`**

```tsx
interface CredentialBannerAction {
  label: string
  onClick: () => void
  primary?: boolean
}

interface CredentialBannerProps {
  message: string
  actions: CredentialBannerAction[]
}

export default function CredentialBanner({ message, actions }: CredentialBannerProps): JSX.Element {
  return (
    <div className="credential-banner">
      <span className="credential-banner-message">{message}</span>
      {actions.map((action) => (
        <button
          key={action.label}
          className={action.primary ? 'credential-banner-primary' : 'credential-banner-secondary'}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add the banner and button styles to `src/renderer/src/browser/browser.css`**

Append at the end of the file:

```css
.address-fill,
.address-generate {
  width: auto;
  padding: 0 8px;
  font-size: 11px;
}

/* Same containment rule as .chrome-error above: this must stay inside the
   fixed --chrome-height band, or the tab WebContentsView covers it. */
.credential-banner {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: #1c1c1f;
  border: 1px solid #333;
  font-size: 12px;
  z-index: 1;
}

.credential-banner-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.credential-banner-primary,
.credential-banner-secondary {
  border: none;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}

.credential-banner-primary {
  background: #6c4cf1;
  color: white;
}

.credential-banner-secondary {
  background: #26262b;
  color: inherit;
}
```

- [ ] **Step 3: Replace `src/renderer/src/browser/AddressBar.tsx` entirely**

```tsx
import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import { resolveAddressBarInput } from './resolveAddressBarInput'
import { generatePassword } from '../credentials/generatePassword'

interface AddressBarProps {
  tab: TabInfo | null
  /** Runs an IPC call, surfacing a rejection instead of leaving it unhandled. */
  onRun: (action: () => Promise<unknown>) => void
  hasCredential: boolean
  onFillRequest: () => void
}

const COPIED_RESET_MS = 2000

export default function AddressBar({ tab, onRun, hasCredential, onFillRequest }: AddressBarProps): JSX.Element {
  const [input, setInput] = useState('')
  const [justGenerated, setJustGenerated] = useState(false)

  useEffect(() => {
    if (tab) setInput(tab.url)
  }, [tab?.id, tab?.url])

  useEffect(() => {
    if (!justGenerated) return undefined
    const timer = setTimeout(() => setJustGenerated(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [justGenerated])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    onRun(() => window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input)))
  }

  async function handleGenerate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(generatePassword())
      setJustGenerated(true)
    } catch {
      // Clipboard access can fail in unusual environments; nothing to recover here.
    }
  }

  return (
    <form className="address-bar" onSubmit={handleSubmit}>
      <button type="button" disabled={!tab?.canGoBack} onClick={() => tab && onRun(() => window.nyx.tabs.goBack(tab.id))}>
        ←
      </button>
      <button
        type="button"
        disabled={!tab?.canGoForward}
        onClick={() => tab && onRun(() => window.nyx.tabs.goForward(tab.id))}
      >
        →
      </button>
      <button type="button" onClick={() => tab && onRun(() => window.nyx.tabs.reload(tab.id))}>
        ⟳
      </button>
      <input
        className="address-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search Brave or enter address"
      />
      {hasCredential && (
        <button type="button" className="address-fill" onClick={onFillRequest}>
          Fill
        </button>
      )}
      <button type="button" className="address-generate" onClick={handleGenerate}>
        {justGenerated ? 'Copied' : 'Generate'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Replace `src/renderer/src/browser/BrowserChrome.tsx` entirely**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import type { CredentialV1 } from '../../../shared/credential-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import CredentialBanner from '../credentials/CredentialBanner'
import { extractHostname } from '../credentials/extractHostname'
import { GENERIC_ERROR } from '../errors'
import './browser.css'

const ERROR_DISMISS_MS = 5000

interface SubmissionCapture {
  domain: string
  username: string
  password: string
}

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState('')
  const [activeCredential, setActiveCredential] = useState<CredentialV1 | null>(null)
  const [fillConfirmPending, setFillConfirmPending] = useState(false)
  const [saveCapture, setSaveCapture] = useState<SubmissionCapture | null>(null)

  /**
   * Runs a fire-and-forget IPC call. Without this, a main-process throw becomes an
   * unhandled promise rejection and the control simply appears to do nothing.
   */
  const run = useCallback((action: () => Promise<unknown>): void => {
    action().catch(() => setError(GENERIC_ERROR))
  }, [])

  useEffect(() => {
    if (!error) return undefined
    const timer = setTimeout(() => setError(''), ERROR_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    let cancelled = false

    async function loadTabs(): Promise<void> {
      try {
        const existing = await window.nyx.tabs.list()
        if (cancelled) return
        if (existing.length === 0) {
          await window.nyx.tabs.create('https://search.brave.com')
        } else {
          setTabs(existing)
        }
      } catch {
        if (!cancelled) setError(GENERIC_ERROR)
      }
    }

    void loadTabs()
    const unsubscribe = window.nyx.tabs.onChanged((updated) => {
      if (!cancelled) setTabs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null

  useEffect(() => {
    const domain = activeTab ? extractHostname(activeTab.url) : null
    if (!domain) {
      setActiveCredential(null)
      return undefined
    }
    let cancelled = false
    window.nyx.credentials
      .getForDomain(domain)
      .then((credential) => {
        if (!cancelled) setActiveCredential(credential)
      })
      .catch(() => {
        if (!cancelled) setActiveCredential(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab?.url])

  useEffect(() => window.nyx.credentials.onSubmissionDetected((capture) => setSaveCapture(capture)), [])

  useEffect(
    () =>
      window.nyx.credentials.onFillRequested(() => {
        setFillConfirmPending((pending) => pending || activeCredential !== null)
      }),
    [activeCredential]
  )

  return (
    <div className="browser-chrome">
      <TabStrip
        tabs={tabs}
        onActivate={(id) => run(() => window.nyx.tabs.activate(id))}
        onClose={(id) => run(() => window.nyx.tabs.close(id))}
        onNewTab={() => run(() => window.nyx.tabs.create('https://search.brave.com'))}
        onLock={() => run(() => window.nyx.vault.lock())}
      />
      <AddressBar
        tab={activeTab}
        onRun={run}
        hasCredential={activeCredential !== null}
        onFillRequest={() => setFillConfirmPending(true)}
      />
      {fillConfirmPending && activeCredential && (
        <CredentialBanner
          message={`Fill saved login for ${activeCredential.domain}?`}
          actions={[
            {
              label: 'Fill',
              primary: true,
              onClick: () => {
                setFillConfirmPending(false)
                run(() => window.nyx.credentials.fill(activeCredential.domain))
              }
            },
            { label: 'Cancel', onClick: () => setFillConfirmPending(false) }
          ]}
        />
      )}
      {!fillConfirmPending && saveCapture && (
        <CredentialBanner
          message={`Save password for ${saveCapture.domain}?`}
          actions={[
            {
              label: 'Save',
              primary: true,
              onClick: () => {
                const capture = saveCapture
                setSaveCapture(null)
                run(() => window.nyx.credentials.save(capture.domain, capture.username, capture.password))
              }
            },
            { label: 'Not now', onClick: () => setSaveCapture(null) }
          ]}
        />
      )}
      {error && <p className="chrome-error">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run build` — expect exit 0, no errors.
Run: `npm run typecheck` — expect exit 0.
Run: `npm test` — expect the full suite (Tasks 1-3's new tests plus everything from Phase 1) still passes.

Manually trace (no GUI available, same standing limitation as the rest of this plan): `AddressBar`'s `hasCredential`/`onFillRequest` props are actually passed by `BrowserChrome`; `CredentialBanner`'s two usages never render simultaneously (`!fillConfirmPending &&` guard on the save banner); the fill banner's "Fill" button clears `fillConfirmPending` *before* calling `run(...)`, so a slow IPC round-trip can't leave the banner stuck open.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/credentials/CredentialBanner.tsx src/renderer/src/browser/AddressBar.tsx src/renderer/src/browser/BrowserChrome.tsx src/renderer/src/browser/browser.css
git commit -m "feat: add fill button, save-password banner, and password generator to the chrome UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Phase 2 complete

At this point: saved logins persist in the encrypted vault alongside everything from Phase 1; the address bar shows a Fill button (or responds to `Ctrl+Shift+F`) when the active tab's domain has a saved credential, filling via a one-shot main-process DOM write after explicit confirmation; submitting a login form on any tab offers to save it; a Generate button produces and copies a strong password for use in any form. No tab ever gained privileged access to reach `window.nyx` — every DOM interaction is a one-shot `executeJavaScript()` call gated by user action or the `will-navigate` browser event. Phase 3 (customization + privacy) is next per the original spec's phasing.