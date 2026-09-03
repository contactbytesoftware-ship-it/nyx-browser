# NYX Browser Phase 1 (Core Shell + Vault + Unlock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable Electron browser shell (tabs, navigation, Brave Search) gated behind a master-password + TOTP unlock screen, backed by a single AES-256-GCM encrypted vault file on disk.

**Architecture:** Electron main process owns the vault (keys never leave it), TOTP verification, and tab (`WebContentsView`) lifecycle. A React/Vite "chrome" renderer (our trusted UI: unlock screen, tab strip, address bar) talks to main only through a narrow `contextBridge` API. Tab content renderers are default-sandboxed with no privileged access.

**Tech Stack:** Electron + `electron-vite`, TypeScript, React, Node's built-in `crypto` (scrypt + AES-256-GCM, no native modules), `otpauth` (TOTP), `qrcode`, `vitest`.

**Spec:** [docs/superpowers/specs/2026-09-03-nyx-browser-phase1-design.md](../specs/2026-09-03-nyx-browser-phase1-design.md)

## Global Constraints

- No native Node modules (keeps Windows builds simple) — crypto uses only `node:crypto`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow`/`WebContentsView`.
- Vault file: `%APPDATA%/NYX Browser/vault.nyx`, format defined in Task 5 as `MAGIC("NYX1",4) || passwordSalt(16) || passwordWrappedKey(60) || recoverySalt(16) || recoveryWrappedKey(60) || mainBlob` — a random vault key wrapped twice (password-derived, recovery-code-derived) so either secret independently unlocks the same content.
- Key derivation: `scrypt(password, salt, N=2^17, r=8, p=1, dklen=32)`.
- Never write decrypted vault contents to disk; the in-memory key/plaintext is zeroed on lock.
- Default search engine: Brave Search (`https://search.brave.com/search?q=%s`).
- Writes to the vault file are temp-file-then-rename; a failed write must never corrupt the existing vault.

---

### Task 1: Project scaffolding (Electron + Vite + React + TS)

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: a running `npm run dev` that opens a window showing placeholder text "NYX Browser". Later tasks replace `App.tsx`'s contents and expand `src/main/index.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "nyx-browser",
  "productName": "NYX Browser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "otpauth": "^9.3.6",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 2: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
```

- [ ] **Step 3: Write `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/main/**/*", "src/preload/**/*"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/renderer/src/**/*"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
})
```

- [ ] **Step 5: Write the main process entry `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Write `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('nyx', {})
```

- [ ] **Step 7: Write the renderer shell**

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>NYX Browser</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:
```tsx
export default function App(): JSX.Element {
  return (
    <div style={{ color: 'white', background: '#111', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      NYX Browser
    </div>
  )
}
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: installs without errors (no native modules to rebuild).

- [ ] **Step 9: Verify the app launches**

Run: `npm run dev`
Expected: an Electron window opens showing "NYX Browser" centered on a dark background. Close the window to stop.

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Electron + Vite + React + TS project"
```

---

### Task 2: Vault crypto primitives + generic encrypted file I/O

**Files:**
- Create: `src/main/vault/crypto.ts`
- Test: `src/main/vault/crypto.test.ts`

**Interfaces:**
- Produces (used by Tasks 4, 5, 6): `deriveKey(password: string, salt: Buffer): Buffer`, `encrypt(plaintext: Buffer, key: Buffer): Buffer`, `decrypt(blob: Buffer, key: Buffer): Buffer`, `encryptJSON(data: unknown, key: Buffer): Buffer`, `decryptJSON<T>(blob: Buffer, key: Buffer): T`, `loadRawFile(path: string): Promise<Buffer | null>`, `saveRawFile(path: string, data: Buffer): Promise<void>`, `backupCorruptFile(path: string): Promise<string>`, constants `SALT_LEN = 16`, `NONCE_LEN = 12`, `AUTH_TAG_LEN = 16`, `KEY_LEN = 32`.
- Note: this module is deliberately format-agnostic (no notion of "vault" file layout) — Task 5 defines the actual on-disk container format on top of these primitives, because a single password-derived salt+blob can't support the dual password/recovery unlock the spec requires (see Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/vault/crypto.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, loadRawFile, saveRawFile, backupCorruptFile, SALT_LEN } from './crypto'

describe('encrypt/decrypt', () => {
  it('round-trips plaintext', () => {
    const key = deriveKey('correct horse', randomBytes(SALT_LEN))
    const blob = encrypt(Buffer.from('hello vault', 'utf8'), key)
    expect(decrypt(blob, key).toString('utf8')).toBe('hello vault')
  })

  it('rejects the wrong key', () => {
    const key1 = deriveKey('password-a', randomBytes(SALT_LEN))
    const key2 = deriveKey('password-b', randomBytes(SALT_LEN))
    const blob = encrypt(Buffer.from('secret'), key1)
    expect(() => decrypt(blob, key2)).toThrow()
  })

  it('round-trips JSON', () => {
    const key = deriveKey('pw', randomBytes(SALT_LEN))
    const blob = encryptJSON({ a: 1, b: 'two' }, key)
    expect(decryptJSON<{ a: number; b: string }>(blob, key)).toEqual({ a: 1, b: 'two' })
  })
})

describe('raw file I/O', () => {
  it('returns null when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    expect(await loadRawFile(join(dir, 'vault.nyx'))).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips save/load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    const path = join(dir, 'vault.nyx')
    await saveRawFile(path, Buffer.from('vault contents'))
    const loaded = await loadRawFile(path)
    expect(loaded?.toString('utf8')).toBe('vault contents')
    await rm(dir, { recursive: true, force: true })
  })

  it('backs up a corrupt file instead of deleting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-'))
    const path = join(dir, 'vault.nyx')
    await saveRawFile(path, Buffer.from('junk'))
    const backupPath = await backupCorruptFile(path)
    expect(backupPath).toContain('vault.nyx.corrupt-')
    expect(await loadRawFile(path)).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/crypto.test.ts`
Expected: FAIL — `./crypto` module does not exist yet.

- [ ] **Step 3: Implement `src/main/vault/crypto.ts`**

```ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'

export const SCRYPT_N = 2 ** 17
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const KEY_LEN = 32
export const SALT_LEN = 16
export const NONCE_LEN = 12
export const AUTH_TAG_LEN = 16

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024
  })
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(NONCE_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  const nonce = blob.subarray(0, NONCE_LEN)
  const authTag = blob.subarray(NONCE_LEN, NONCE_LEN + AUTH_TAG_LEN)
  const ciphertext = blob.subarray(NONCE_LEN + AUTH_TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function encryptJSON(data: unknown, key: Buffer): Buffer {
  return encrypt(Buffer.from(JSON.stringify(data), 'utf8'), key)
}

export function decryptJSON<T>(blob: Buffer, key: Buffer): T {
  return JSON.parse(decrypt(blob, key).toString('utf8')) as T
}

export async function loadRawFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveRawFile(path: string, data: Buffer): Promise<void> {
  const tmpPath = `${path}.tmp-${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, data)
  await rename(tmpPath, path)
}

export async function backupCorruptFile(path: string): Promise<string> {
  const dest = `${path}.corrupt-${Date.now()}`
  await rename(path, dest)
  return dest
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/crypto.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/crypto.ts src/main/vault/crypto.test.ts
git commit -m "feat: add vault encryption primitives and generic encrypted file I/O"
```

---

### Task 3: TOTP module (RFC 6238, Google Authenticator-compatible)

**Files:**
- Create: `src/main/vault/totp.ts`
- Test: `src/main/vault/totp.test.ts`

**Interfaces:**
- Consumes: `otpauth` package (`Secret`, `TOTP` exports).
- Produces (used by Tasks 5, 6, 8): `generateTotpSecret(): string`, `totpProvisioningUri(secretBase32: string, accountLabel?: string): string`, `verifyTotpCode(secretBase32: string, code: string): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/vault/totp.test.ts
import { describe, it, expect } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'

describe('generateTotpSecret', () => {
  it('returns a base32 secret', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)
    expect(secret.length).toBeGreaterThanOrEqual(32)
  })

  it('returns a different secret each call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe('totpProvisioningUri', () => {
  it('returns an otpauth:// URI for NYX Browser', () => {
    const uri = totpProvisioningUri(generateTotpSecret(), 'me@example.com')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('NYX')
  })
})

describe('verifyTotpCode', () => {
  it('accepts the current valid code', () => {
    const secret = generateTotpSecret()
    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate()
    expect(verifyTotpCode(secret, code)).toBe(true)
  })

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret()
    const valid = new TOTP({ secret: Secret.fromBase32(secret) }).generate()
    const wrong = valid === '000000' ? '111111' : '000000'
    expect(verifyTotpCode(secret, wrong)).toBe(false)
  })

  it('rejects a code for a different secret', () => {
    const code = new TOTP({ secret: Secret.fromBase32(generateTotpSecret()) }).generate()
    expect(verifyTotpCode(generateTotpSecret(), code)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/totp.test.ts`
Expected: FAIL — `./totp` module does not exist yet.

- [ ] **Step 3: Implement `src/main/vault/totp.ts`**

```ts
import { Secret, TOTP } from 'otpauth'

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpProvisioningUri(secretBase32: string, accountLabel = 'NYX Browser'): string {
  const totp = new TOTP({
    issuer: 'NYX Browser',
    label: accountLabel,
    secret: Secret.fromBase32(secretBase32)
  })
  return totp.toString()
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32) })
  return totp.validate({ token: code, window: 1 }) !== null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/totp.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/totp.ts src/main/vault/totp.test.ts
git commit -m "feat: add TOTP generation/verification (Google Authenticator-compatible)"
```

---

### Task 4: Recovery key generation

**Files:**
- Create: `src/main/vault/recovery.ts`
- Test: `src/main/vault/recovery.test.ts`

**Interfaces:**
- Produces (used by Tasks 5, 6, 7): `generateRecoveryKey(): string` — returns a 24-character code from an unambiguous alphabet (no `0/O`, `1/I/L`), formatted as six hyphen-separated groups of four, e.g. `XK4M-9PQR-...`. The raw wrapping/unwrapping of the vault key under this code is done directly with Task 2's `deriveKey`/`encrypt`/`decrypt` in Task 5 — a recovery code is just another password from the crypto module's point of view, so no separate wrap/unwrap functions are needed here.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/vault/recovery.test.ts
import { describe, it, expect } from 'vitest'
import { generateRecoveryKey } from './recovery'

describe('generateRecoveryKey', () => {
  it('matches the expected grouped format', () => {
    expect(generateRecoveryKey()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/)
  })

  it('excludes ambiguous characters', () => {
    const key = generateRecoveryKey()
    expect(key).not.toMatch(/[01IOL]/)
  })

  it('returns a different key each call', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/recovery.test.ts`
Expected: FAIL — `./recovery` module does not exist yet.

- [ ] **Step 3: Implement `src/main/vault/recovery.ts`**

```ts
import { randomBytes } from 'node:crypto'

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L

export function generateRecoveryKey(): string {
  const bytes = randomBytes(24)
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4).join(''))
  }
  return groups.join('-')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/recovery.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/recovery.ts src/main/vault/recovery.test.ts
git commit -m "feat: add recovery key generation"
```

---

### Task 5: Vault container format (dual unlock: password and recovery key)

A single password-derived salt can't support an independent recovery path, so the container stores one random 32-byte vault key, wrapped twice: once under a key derived from the master password, once under a key derived from the recovery code. Either unwrap yields the same vault key, which decrypts the one `mainBlob` (containing the TOTP secret and settings).

**Files:**
- Create: `src/main/vault/container.ts`
- Test: `src/main/vault/container.test.ts`

**Interfaces:**
- Consumes: `deriveKey`, `encrypt`, `decrypt`, `encryptJSON`, `decryptJSON`, `SALT_LEN`, `KEY_LEN`, `NONCE_LEN`, `AUTH_TAG_LEN` from `./crypto` (Task 2).
- Produces (used by Task 6): `interface VaultContentsV1 { version: 1; totpSecret: string; settings: Record<string, unknown> }`, `interface VaultContainer { passwordSalt: Buffer; passwordWrappedKey: Buffer; recoverySalt: Buffer; recoveryWrappedKey: Buffer; mainBlob: Buffer }`, `createContainer(password: string, recoveryKey: string, contents: VaultContentsV1): VaultContainer`, `unlockWithPassword(container: VaultContainer, password: string): { contents: VaultContentsV1; vaultKey: Buffer }`, `unlockWithRecoveryKey(container: VaultContainer, recoveryKey: string): { contents: VaultContentsV1; vaultKey: Buffer }`, `serializeContainer(c: VaultContainer): Buffer`, `parseContainer(raw: Buffer): VaultContainer`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/vault/container.test.ts
import { describe, it, expect } from 'vitest'
import {
  createContainer, unlockWithPassword, unlockWithRecoveryKey,
  serializeContainer, parseContainer, VaultContentsV1
} from './container'

const contents: VaultContentsV1 = { version: 1, totpSecret: 'JBSWY3DPEHPK3PXP', settings: { theme: 'dark' } }

describe('createContainer + unlockWithPassword', () => {
  it('round-trips with the correct password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { contents: out } = unlockWithPassword(container, 'correct horse')
    expect(out).toEqual(contents)
  })

  it('rejects the wrong password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    expect(() => unlockWithPassword(container, 'wrong password')).toThrow()
  })
})

describe('createContainer + unlockWithRecoveryKey', () => {
  it('round-trips with the correct recovery key, independent of the password', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const { contents: out, vaultKey } = unlockWithRecoveryKey(container, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')
    expect(out).toEqual(contents)
    expect(vaultKey).toHaveLength(32)
  })

  it('rejects the wrong recovery key', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    expect(() => unlockWithRecoveryKey(container, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toThrow()
  })
})

describe('serializeContainer + parseContainer', () => {
  it('round-trips and both unlock paths still work after parsing', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const parsed = parseContainer(serializeContainer(container))
    expect(unlockWithPassword(parsed, 'correct horse').contents).toEqual(contents)
    expect(unlockWithRecoveryKey(parsed, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF').contents).toEqual(contents)
  })

  it('rejects a too-short buffer', () => {
    expect(() => parseContainer(Buffer.from('short'))).toThrow()
  })

  it('rejects a buffer with the wrong magic header', () => {
    const container = createContainer('correct horse', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', contents)
    const raw = serializeContainer(container)
    raw.write('XXXX', 0, 'utf8')
    expect(() => parseContainer(raw)).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/container.test.ts`
Expected: FAIL — `./container` module does not exist yet.

- [ ] **Step 3: Implement `src/main/vault/container.ts`**

```ts
import { randomBytes } from 'node:crypto'
import { deriveKey, encrypt, decrypt, encryptJSON, decryptJSON, SALT_LEN, KEY_LEN, NONCE_LEN, AUTH_TAG_LEN } from './crypto'

export interface VaultContentsV1 {
  version: 1
  totpSecret: string
  settings: Record<string, unknown>
}

export interface VaultContainer {
  passwordSalt: Buffer
  passwordWrappedKey: Buffer
  recoverySalt: Buffer
  recoveryWrappedKey: Buffer
  mainBlob: Buffer
}

const MAGIC = Buffer.from('NYX1', 'utf8')
const WRAPPED_KEY_LEN = NONCE_LEN + AUTH_TAG_LEN + KEY_LEN

export function createContainer(password: string, recoveryKey: string, contents: VaultContentsV1): VaultContainer {
  const vaultKey = randomBytes(KEY_LEN)
  const passwordSalt = randomBytes(SALT_LEN)
  const recoverySalt = randomBytes(SALT_LEN)
  return {
    passwordSalt,
    passwordWrappedKey: encrypt(vaultKey, deriveKey(password, passwordSalt)),
    recoverySalt,
    recoveryWrappedKey: encrypt(vaultKey, deriveKey(recoveryKey, recoverySalt)),
    mainBlob: encryptJSON(contents, vaultKey)
  }
}

export function unlockWithPassword(container: VaultContainer, password: string): { contents: VaultContentsV1; vaultKey: Buffer } {
  const vaultKey = decrypt(container.passwordWrappedKey, deriveKey(password, container.passwordSalt))
  return { contents: decryptJSON<VaultContentsV1>(container.mainBlob, vaultKey), vaultKey }
}

export function unlockWithRecoveryKey(container: VaultContainer, recoveryKey: string): { contents: VaultContentsV1; vaultKey: Buffer } {
  const vaultKey = decrypt(container.recoveryWrappedKey, deriveKey(recoveryKey, container.recoverySalt))
  return { contents: decryptJSON<VaultContentsV1>(container.mainBlob, vaultKey), vaultKey }
}

export function serializeContainer(c: VaultContainer): Buffer {
  return Buffer.concat([MAGIC, c.passwordSalt, c.passwordWrappedKey, c.recoverySalt, c.recoveryWrappedKey, c.mainBlob])
}

export function parseContainer(raw: Buffer): VaultContainer {
  const headerLen = MAGIC.length + SALT_LEN + WRAPPED_KEY_LEN + SALT_LEN + WRAPPED_KEY_LEN
  if (raw.length < headerLen) throw new Error('vault file is too short to be valid')
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('vault file has an unrecognized format')
  let offset = MAGIC.length
  const passwordSalt = raw.subarray(offset, (offset += SALT_LEN))
  const passwordWrappedKey = raw.subarray(offset, (offset += WRAPPED_KEY_LEN))
  const recoverySalt = raw.subarray(offset, (offset += SALT_LEN))
  const recoveryWrappedKey = raw.subarray(offset, (offset += WRAPPED_KEY_LEN))
  const mainBlob = raw.subarray(offset)
  return { passwordSalt, passwordWrappedKey, recoverySalt, recoveryWrappedKey, mainBlob }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/container.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/container.ts src/main/vault/container.test.ts
git commit -m "feat: add dual-unlock vault container format (password + recovery key)"
```

---

### Task 6: VaultManager (orchestration: setup, unlock, lock, lockout backoff)

**Files:**
- Create: `src/main/vault/manager.ts`
- Test: `src/main/vault/manager.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5 (`crypto.ts`, `totp.ts`, `recovery.ts`, `container.ts`).
- Produces (used by Task 7's IPC layer and Task 10's auto-lock wiring):
  ```ts
  type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }
  interface SetupResult { totpProvisioningUri: string; recoveryKey: string }
  class VaultManager {
    constructor(vaultPath: string)
    exists(): Promise<boolean>
    get isUnlocked(): boolean
    setup(password: string): Promise<SetupResult>
    unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult>
    unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult>
    lock(): void
  }
  ```
- Design notes: `setup()` writes the vault but leaves it locked — the caller must then unlock with the password + the TOTP code they just scanned, which doubles as confirmation the QR code was scanned correctly. `unlockWithRecoveryKey` does not check a TOTP code (the recovery key itself is the full-strength bypass secret) and immediately re-encrypts the vault under the new password with a freshly generated recovery key, invalidating the old one, per spec.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/vault/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOTP, Secret } from 'otpauth'
import { VaultManager } from './manager'

let dir: string
let vaultPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nyx-manager-'))
  vaultPath = join(dir, 'vault.nyx')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function codeFor(secretBase32: string): string {
  return new TOTP({ secret: Secret.fromBase32(secretBase32) }).generate()
}

describe('setup', () => {
  it('creates a vault file and returns a provisioning URI + recovery key', async () => {
    const manager = new VaultManager(vaultPath)
    expect(await manager.exists()).toBe(false)
    const result = await manager.setup('correct horse battery staple')
    expect(result.totpProvisioningUri).toMatch(/^otpauth:\/\/totp\//)
    expect(result.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/)
    expect(await manager.exists()).toBe(true)
    expect(manager.isUnlocked).toBe(false)
  })
})

describe('unlockWithPassword', () => {
  it('succeeds with the correct password and TOTP code', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    const result = await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    expect(result).toEqual({ ok: true })
    expect(manager.isUnlocked).toBe(true)
  })

  it('fails with the wrong password', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    const result = await manager.unlockWithPassword('wrong password', codeFor(secret))
    expect(result).toEqual({ ok: false, reason: 'wrong-credentials' })
    expect(manager.isUnlocked).toBe(false)
  })

  it('fails with the wrong TOTP code', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    const result = await manager.unlockWithPassword('correct horse battery staple', '000000')
    expect(result.ok).toBe(false)
    expect(manager.isUnlocked).toBe(false)
  })

  it('locks out immediately after a failed attempt (backoff window active)', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('correct horse battery staple')
    await manager.unlockWithPassword('wrong password', '000000')
    const second = await manager.unlockWithPassword('correct horse battery staple', '000000')
    expect(second).toEqual({ ok: false, reason: 'locked-out' })
  })
})

describe('lock', () => {
  it('clears unlocked state', async () => {
    const manager = new VaultManager(vaultPath)
    const { totpProvisioningUri } = await manager.setup('correct horse battery staple')
    const secret = new URL(totpProvisioningUri).searchParams.get('secret')!
    await manager.unlockWithPassword('correct horse battery staple', codeFor(secret))
    manager.lock()
    expect(manager.isUnlocked).toBe(false)
  })
})

describe('unlockWithRecoveryKey', () => {
  it('unlocks and replaces the password + recovery key', async () => {
    const manager = new VaultManager(vaultPath)
    const { recoveryKey } = await manager.setup('old password')
    const result = await manager.unlockWithRecoveryKey(recoveryKey, 'new password')
    expect(result).toEqual({ ok: true })
    expect(manager.isUnlocked).toBe(true)
    manager.lock()

    const oldPasswordAttempt = await manager.unlockWithPassword('old password', '000000')
    expect(oldPasswordAttempt).toEqual({ ok: false, reason: 'wrong-credentials' })
  })

  it('rejects the wrong recovery key without modifying the vault', async () => {
    const manager = new VaultManager(vaultPath)
    await manager.setup('old password')
    const result = await manager.unlockWithRecoveryKey('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'new password')
    expect(result.ok).toBe(false)
    expect(manager.isUnlocked).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/vault/manager.test.ts`
Expected: FAIL — `./manager` module does not exist yet.

- [ ] **Step 3: Implement `src/main/vault/manager.ts`**

```ts
import { loadRawFile, saveRawFile, backupCorruptFile } from './crypto'
import {
  createContainer,
  unlockWithPassword as containerUnlockWithPassword,
  unlockWithRecoveryKey as containerUnlockWithRecoveryKey,
  serializeContainer,
  parseContainer,
  VaultContainer,
  VaultContentsV1
} from './container'
import { generateTotpSecret, totpProvisioningUri, verifyTotpCode } from './totp'
import { generateRecoveryKey } from './recovery'

export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }
export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

const MAX_BACKOFF_MS = 60_000

export class VaultManager {
  private container: VaultContainer | null = null
  private vaultKey: Buffer | null = null
  private failedAttempts = 0
  private lockedUntil = 0

  constructor(private readonly vaultPath: string) {}

  async exists(): Promise<boolean> {
    return (await loadRawFile(this.vaultPath)) !== null
  }

  get isUnlocked(): boolean {
    return this.vaultKey !== null
  }

  async setup(password: string): Promise<SetupResult> {
    const totpSecret = generateTotpSecret()
    const recoveryKey = generateRecoveryKey()
    const contents: VaultContentsV1 = { version: 1, totpSecret, settings: {} }
    const container = createContainer(password, recoveryKey, contents)
    await saveRawFile(this.vaultPath, serializeContainer(container))
    this.container = container
    return { totpProvisioningUri: totpProvisioningUri(totpSecret), recoveryKey }
  }

  private async loadContainer(): Promise<VaultContainer> {
    if (this.container) return this.container
    const raw = await loadRawFile(this.vaultPath)
    if (!raw) throw new Error('no vault exists at this path')
    try {
      this.container = parseContainer(raw)
      return this.container
    } catch (err) {
      await backupCorruptFile(this.vaultPath)
      throw err
    }
  }

  private isLockedOut(): boolean {
    return Date.now() < this.lockedUntil
  }

  private registerFailure(): void {
    this.failedAttempts += 1
    this.lockedUntil = Date.now() + Math.min(1000 * 2 ** (this.failedAttempts - 1), MAX_BACKOFF_MS)
  }

  private registerSuccess(): void {
    this.failedAttempts = 0
    this.lockedUntil = 0
  }

  async unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult> {
    if (this.isLockedOut()) return { ok: false, reason: 'locked-out' }
    let unlocked: { contents: VaultContentsV1; vaultKey: Buffer }
    try {
      const container = await this.loadContainer()
      unlocked = containerUnlockWithPassword(container, password)
    } catch {
      this.registerFailure()
      return { ok: false, reason: 'wrong-credentials' }
    }
    if (!verifyTotpCode(unlocked.contents.totpSecret, totpCode)) {
      unlocked.vaultKey.fill(0)
      this.registerFailure()
      return { ok: false, reason: 'wrong-totp' }
    }
    this.vaultKey = unlocked.vaultKey
    this.registerSuccess()
    return { ok: true }
  }

  async unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult> {
    if (this.isLockedOut()) return { ok: false, reason: 'locked-out' }
    let unlocked: { contents: VaultContentsV1; vaultKey: Buffer }
    try {
      const container = await this.loadContainer()
      unlocked = containerUnlockWithRecoveryKey(container, recoveryKey)
    } catch {
      this.registerFailure()
      return { ok: false, reason: 'wrong-credentials' }
    }
    this.registerSuccess()
    unlocked.vaultKey.fill(0)
    const newRecoveryKey = generateRecoveryKey()
    const rekeyed = createContainer(newPassword, newRecoveryKey, unlocked.contents)
    await saveRawFile(this.vaultPath, serializeContainer(rekeyed))
    this.container = rekeyed
    this.vaultKey = containerUnlockWithPassword(rekeyed, newPassword).vaultKey
    return { ok: true }
  }

  lock(): void {
    this.vaultKey?.fill(0)
    this.vaultKey = null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/vault/manager.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/vault/manager.ts src/main/vault/manager.test.ts
git commit -m "feat: add VaultManager orchestrating setup, unlock, lock, and lockout backoff"
```

---

### Task 7: IPC bridge (main ↔ preload ↔ chrome renderer)

**Files:**
- Create: `src/shared/vault-types.ts`
- Create: `src/main/vault/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/nyx-global.d.ts`

**Interfaces:**
- Consumes: `VaultManager` (Task 6).
- Produces (used by Task 8): `window.nyx.vault` in the renderer, typed as `VaultApi`, with methods `exists`, `isUnlocked`, `setup`, `unlockWithPassword`, `unlockWithRecoveryKey`, `lock` mirroring `VaultManager` 1:1 (all Promise-returning since they cross IPC).
- Note: no code in this task is unit-testable in isolation (it's Electron IPC wiring) — verified manually in Step 4 below, and exercised for real by Task 8's UI.

- [ ] **Step 1: Write `src/shared/vault-types.ts`**

```ts
export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }

export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

export interface VaultApi {
  exists(): Promise<boolean>
  isUnlocked(): Promise<boolean>
  setup(password: string): Promise<SetupResult>
  unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult>
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult>
  lock(): Promise<void>
}
```

- [ ] **Step 2: Write `src/main/vault/ipc.ts`**

```ts
import { ipcMain } from 'electron'
import { VaultManager } from './manager'

export function registerVaultIpc(
  vault: VaultManager,
  onLock: () => void = () => vault.lock(),
  onUnlock: () => void = () => {}
): void {
  ipcMain.handle('vault:exists', () => vault.exists())
  ipcMain.handle('vault:isUnlocked', () => vault.isUnlocked)
  ipcMain.handle('vault:setup', (_event, password: string) => vault.setup(password))
  ipcMain.handle('vault:unlockWithPassword', async (_event, password: string, totpCode: string) => {
    const result = await vault.unlockWithPassword(password, totpCode)
    if (result.ok) onUnlock()
    return result
  })
  ipcMain.handle('vault:unlockWithRecoveryKey', async (_event, recoveryKey: string, newPassword: string) => {
    const result = await vault.unlockWithRecoveryKey(recoveryKey, newPassword)
    if (result.ok) onUnlock()
    return result
  })
  ipcMain.handle('vault:lock', () => onLock())
}
```

Note for a later task (Task 12): the defaults just call `vault.lock()`/do nothing, which is correct as of this task since no tabs exist yet. Task 12 passes fuller callbacks that also hide/show the active tab and notify the renderer — that's why `onLock`/`onUnlock` are parameters here instead of the handlers touching `vault` unconditionally.

- [ ] **Step 3: Wire it into `src/main/index.ts`, and expose it from `src/preload/index.ts`**

Modify `src/main/index.ts` — replace the `app.whenReady().then(...)` block:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
}

app.whenReady().then(() => {
  app.setName('NYX Browser')
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  registerVaultIpc(vault)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

Replace `src/preload/index.ts` entirely:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  lock: () => ipcRenderer.invoke('vault:lock')
}

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi })
```

Create `src/renderer/src/nyx-global.d.ts`:

```ts
import type { VaultApi } from '../../shared/vault-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi }
  }
}

export {}
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`
In the opened window, open DevTools (`Ctrl+Shift+I`), go to the Console tab, and run:
```js
await window.nyx.vault.exists()
```
Expected: `false` (no vault created yet in this fresh profile).

- [ ] **Step 5: Commit**

```bash
git add src/shared/vault-types.ts src/main/vault/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/src/nyx-global.d.ts
git commit -m "feat: wire vault IPC bridge between main process and chrome renderer"
```

---

### Task 8: Auth UI (first-run setup, unlock, recovery)

**Files:**
- Create: `src/renderer/src/auth/AuthGate.tsx`
- Create: `src/renderer/src/auth/SetupScreen.tsx`
- Create: `src/renderer/src/auth/UnlockScreen.tsx`
- Create: `src/renderer/src/auth/RecoveryScreen.tsx`
- Create: `src/renderer/src/auth/auth.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `package.json` (add `qrcode` to renderer-usable deps — already present from Task 1; add `@types/qrcode` — already present)

**Interfaces:**
- Consumes: `window.nyx.vault` (Task 7).
- Produces (used by Task 10): `<AuthGate onUnlocked={() => void}>` — renders whichever of setup/unlock/recovery is appropriate and calls `onUnlocked` once `window.nyx.vault.unlockWithPassword` or `unlockWithRecoveryKey` returns `{ ok: true }`. Task 10 wraps this with the browser chrome, switching between `AuthGate` and the real browser UI based on unlocked state.

This task is UI-driven and is verified manually end-to-end rather than with unit tests, per the spec's testing approach.

- [ ] **Step 1: Write `src/renderer/src/auth/auth.css`**

```css
.auth-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
  margin: 10vh auto;
  padding: 24px;
  color: #e6e6e6;
  font-family: system-ui, sans-serif;
}

.auth-screen h1 {
  font-size: 20px;
  margin: 0 0 4px;
}

.auth-screen input {
  background: #1c1c1f;
  border: 1px solid #333;
  color: #e6e6e6;
  padding: 10px;
  border-radius: 6px;
  font-size: 14px;
}

.auth-screen button {
  background: #6c4cf1;
  color: white;
  border: none;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.auth-screen button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auth-screen .auth-link {
  background: none;
  color: #9d8cf5;
  padding: 0;
  text-align: left;
}

.auth-screen .auth-error {
  color: #f16c6c;
  font-size: 13px;
  margin: 0;
}

.auth-screen code {
  background: #1c1c1f;
  padding: 8px;
  border-radius: 6px;
  word-break: break-all;
  font-size: 13px;
}
```

- [ ] **Step 2: Write `src/renderer/src/auth/SetupScreen.tsx`**

```tsx
import { useState } from 'react'
import QRCode from 'qrcode'

interface SetupScreenProps {
  onComplete: () => void
}

type Step = 'password' | 'reveal'

export default function SetupScreen({ onComplete }: SetupScreenProps): JSX.Element {
  const [step, setStep] = useState<Step>('password')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [manualSecret, setManualSecret] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [savedConfirmed, setSavedConfirmed] = useState(false)

  async function handleCreate(): Promise<void> {
    if (password.length < 12) {
      setError('Master password must be at least 12 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    const result = await window.nyx.vault.setup(password)
    setRecoveryKey(result.recoveryKey)
    setManualSecret(new URL(result.totpProvisioningUri).searchParams.get('secret') ?? '')
    setQrDataUrl(await QRCode.toDataURL(result.totpProvisioningUri))
    setStep('reveal')
  }

  if (step === 'reveal') {
    return (
      <div className="auth-screen">
        <h1>Scan into your authenticator app</h1>
        <img src={qrDataUrl} alt="TOTP QR code" width={200} height={200} />
        <p>Can&apos;t scan? Enter this key manually: <code>{manualSecret}</code></p>
        <h1>Save your recovery key</h1>
        <p>
          This is the only way back into NYX Browser if you lose your password and authenticator.
          It will not be shown again.
        </p>
        <code>{recoveryKey}</code>
        <label>
          <input type="checkbox" checked={savedConfirmed} onChange={(e) => setSavedConfirmed(e.target.checked)} />
          {' '}I&apos;ve saved my recovery key
        </label>
        <button disabled={!savedConfirmed} onClick={onComplete}>
          Continue to unlock
        </button>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <h1>Set your master password</h1>
      <input
        type="password"
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirm password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="auth-error">{error}</p>}
      <button onClick={handleCreate}>Create vault</button>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/auth/RecoveryScreen.tsx`**

```tsx
import { useState } from 'react'

interface RecoveryScreenProps {
  onUnlocked: () => void
  onCancel: () => void
}

export default function RecoveryScreen({ onUnlocked, onCancel }: RecoveryScreenProps): JSX.Element {
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')

  async function handleRecover(): Promise<void> {
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    const result = await window.nyx.vault.unlockWithRecoveryKey(recoveryKey, newPassword)
    if (result.ok) {
      onUnlocked()
      return
    }
    setError(result.reason === 'locked-out' ? 'Too many attempts. Wait a moment and try again.' : 'Incorrect recovery key.')
  }

  return (
    <div className="auth-screen">
      <h1>Recover your vault</h1>
      <input type="text" placeholder="Recovery key" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} />
      <input
        type="password"
        placeholder="New master password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="auth-error">{error}</p>}
      <button onClick={handleRecover}>Reset and unlock</button>
      <button className="auth-link" onClick={onCancel}>Cancel</button>
    </div>
  )
}
```

- [ ] **Step 4: Write `src/renderer/src/auth/UnlockScreen.tsx`**

```tsx
import { useState } from 'react'
import RecoveryScreen from './RecoveryScreen'

interface UnlockScreenProps {
  onUnlocked: () => void
}

export default function UnlockScreen({ onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)

  if (showRecovery) {
    return <RecoveryScreen onUnlocked={onUnlocked} onCancel={() => setShowRecovery(false)} />
  }

  async function handleUnlock(): Promise<void> {
    const result = await window.nyx.vault.unlockWithPassword(password, code)
    if (result.ok) {
      onUnlocked()
      return
    }
    setError(
      result.reason === 'locked-out' ? 'Too many attempts. Wait a moment and try again.' : 'Incorrect password or code.'
    )
    setCode('')
  }

  return (
    <div className="auth-screen">
      <h1>NYX Browser</h1>
      <input
        type="password"
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="text"
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={6}
      />
      {error && <p className="auth-error">{error}</p>}
      <button onClick={handleUnlock}>Unlock</button>
      <button className="auth-link" onClick={() => setShowRecovery(true)}>Forgot password?</button>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/auth/AuthGate.tsx`**

```tsx
import { useEffect, useState } from 'react'
import SetupScreen from './SetupScreen'
import UnlockScreen from './UnlockScreen'
import './auth.css'

interface AuthGateProps {
  onUnlocked: () => void
}

type Mode = 'loading' | 'setup' | 'unlock'

export default function AuthGate({ onUnlocked }: AuthGateProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('loading')

  useEffect(() => {
    window.nyx.vault.exists().then((exists) => setMode(exists ? 'unlock' : 'setup'))
  }, [])

  if (mode === 'loading') return <div className="auth-screen">Loading…</div>
  if (mode === 'setup') return <SetupScreen onComplete={() => setMode('unlock')} />
  return <UnlockScreen onUnlocked={onUnlocked} />
}
```

- [ ] **Step 6: Wire it into `App.tsx`**

```tsx
import { useState } from 'react'
import AuthGate from './auth/AuthGate'

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />
  }

  return (
    <div style={{ color: 'white', background: '#111', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Unlocked — browser chrome comes in Task 9.
    </div>
  )
}
```

- [ ] **Step 7: Verify manually end-to-end**

Run: `npm run dev`. In the app window:
1. First run shows the "Set your master password" screen. Enter a password under 12 characters — expect the length error. Enter matching 12+ character passwords — expect the QR + manual secret + recovery key screen.
2. Copy the manual secret text. In a separate terminal (from the project root, so `node_modules/otpauth` resolves), generate a valid code for it without touching production code — `--input-type=commonjs` is needed because this `package.json` has `"type": "module"`:
   `node --input-type=commonjs -e "const {TOTP,Secret}=require('otpauth'); console.log(new TOTP({secret:Secret.fromBase32(process.argv[1])}).generate())" <manual-secret>`
3. Check the "I've saved my recovery key" box and click "Continue to unlock" — expect the unlock screen.
4. Enter the master password and the generated code — expect the "Unlocked — browser chrome comes in Task 9" placeholder.
5. Reload the app (`Ctrl+R`) — expect the unlock screen again (not setup) since the vault now exists on disk.
6. On the unlock screen, click "Forgot password?", enter the saved recovery key and a new password — expect it to unlock. Reload again and confirm the old password no longer works but the new one does.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/auth src/renderer/src/App.tsx
git commit -m "feat: add first-run setup, unlock, and recovery UI"
```

---

### Task 9: Address bar input resolution (URL vs. Brave Search)

**Files:**
- Create: `src/renderer/src/browser/resolveAddressBarInput.ts`
- Test: `src/renderer/src/browser/resolveAddressBarInput.test.ts`

**Interfaces:**
- Produces (used by Task 11): `resolveAddressBarInput(input: string): string` — returns a navigable URL, either the input as-is/prefixed with `https://`, or a Brave Search URL for anything that isn't URL- or domain-shaped.

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/src/browser/resolveAddressBarInput.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAddressBarInput } from './resolveAddressBarInput'

describe('resolveAddressBarInput', () => {
  it('passes through a full URL unchanged', () => {
    expect(resolveAddressBarInput('https://example.com')).toBe('https://example.com')
  })

  it('adds https:// to a bare domain', () => {
    expect(resolveAddressBarInput('example.com')).toBe('https://example.com')
  })

  it('preserves a path on a bare domain', () => {
    expect(resolveAddressBarInput('example.com/blog')).toBe('https://example.com/blog')
  })

  it('sends a single ambiguous word to Brave Search', () => {
    expect(resolveAddressBarInput('github')).toBe('https://search.brave.com/search?q=github')
  })

  it('sends a multi-word query to Brave Search', () => {
    expect(resolveAddressBarInput('how tall is the eiffel tower')).toBe(
      'https://search.brave.com/search?q=how%20tall%20is%20the%20eiffel%20tower'
    )
  })

  it('trims whitespace', () => {
    expect(resolveAddressBarInput('  example.com  ')).toBe('https://example.com')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/browser/resolveAddressBarInput.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `src/renderer/src/browser/resolveAddressBarInput.ts`**

```ts
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i

export function resolveAddressBarInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return ''
  if (URL_LIKE.test(trimmed)) return trimmed
  if (!trimmed.includes(' ') && DOMAIN_LIKE.test(trimmed)) return `https://${trimmed}`
  return `https://search.brave.com/search?q=${encodeURIComponent(trimmed)}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/browser/resolveAddressBarInput.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/browser/resolveAddressBarInput.ts src/renderer/src/browser/resolveAddressBarInput.test.ts
git commit -m "feat: add address bar input resolution (URL vs Brave Search)"
```

---

### Task 10: Tab management (main process `WebContentsView` lifecycle + IPC)

`TabManager` is a thin orchestration layer over Electron's windowing APIs, which only run inside a real Electron process — there is no meaningful way to unit test it under vitest (mocking `BrowserWindow`/`WebContentsView` would test the mock, not real behavior). It's verified manually in Step 3, the same way Task 7's IPC wiring was.

**Files:**
- Create: `src/main/tabs/manager.ts`
- Create: `src/main/tabs/ipc.ts`
- Modify: `src/shared/vault-types.ts` → rename usage stays, but add `src/shared/tab-types.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/nyx-global.d.ts`

**Interfaces:**
- Produces (used by Task 11):
  ```ts
  interface TabInfo { id: number; url: string; title: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean; isActive: boolean }
  interface TabsApi {
    list(): Promise<TabInfo[]>
    create(url: string): Promise<number>
    activate(id: number): Promise<void>
    close(id: number): Promise<void>
    navigate(id: number, url: string): Promise<void>
    goBack(id: number): Promise<void>
    goForward(id: number): Promise<void>
    reload(id: number): Promise<void>
    onChanged(callback: (tabs: TabInfo[]) => void): () => void
  }
  ```
  exposed as `window.nyx.tabs`. Also produces `class TabManager` with `hideActive()`/`showActive()` methods (used by Task 12's auto-lock).

- [ ] **Step 1: Write `src/shared/tab-types.ts`**

```ts
export interface TabInfo {
  id: number
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

export interface TabsApi {
  list(): Promise<TabInfo[]>
  create(url: string): Promise<number>
  activate(id: number): Promise<void>
  close(id: number): Promise<void>
  navigate(id: number, url: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  onChanged(callback: (tabs: TabInfo[]) => void): () => void
}
```

- [ ] **Step 2: Implement `src/main/tabs/manager.ts`**

```ts
import { EventEmitter } from 'node:events'
import { BrowserWindow, WebContentsView } from 'electron'
import type { TabInfo } from '../../shared/tab-types'

const CHROME_HEIGHT = 88

export class TabManager extends EventEmitter {
  private views = new Map<number, WebContentsView>()
  private order: number[] = []
  private activeId: number | null = null
  private nextId = 1

  constructor(
    private readonly window: BrowserWindow,
    private readonly onTabCreated?: (webContents: Electron.WebContents) => void
  ) {
    super()
    window.on('resize', () => this.layoutActive())
  }

  private layoutActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (!view) return
    const bounds = this.window.getContentBounds()
    view.setBounds({ x: 0, y: CHROME_HEIGHT, width: bounds.width, height: Math.max(0, bounds.height - CHROME_HEIGHT) })
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }

  createTab(url: string): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    const wc = view.webContents
    wc.on('page-title-updated', () => this.emitChanged())
    wc.on('did-navigate', () => this.emitChanged())
    wc.on('did-navigate-in-page', () => this.emitChanged())
    wc.on('did-start-loading', () => this.emitChanged())
    wc.on('did-stop-loading', () => this.emitChanged())
    this.onTabCreated?.(wc)
    wc.loadURL(url)
    this.views.set(id, view)
    this.order.push(id)
    this.activateTab(id)
    return id
  }

  activateTab(id: number): void {
    const view = this.views.get(id)
    if (!view) return
    if (this.activeId !== null) {
      const prev = this.views.get(this.activeId)
      if (prev) this.window.contentView.removeChildView(prev)
    }
    this.activeId = id
    this.window.contentView.addChildView(view)
    this.layoutActive()
    this.emitChanged()
  }

  closeTab(id: number): void {
    const view = this.views.get(id)
    if (!view) return
    if (this.activeId === id) this.window.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(id)
    const closedIndex = this.order.indexOf(id)
    this.order = this.order.filter((tabId) => tabId !== id)
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[Math.min(closedIndex, this.order.length - 1)]
      if (next !== undefined) this.activateTab(next)
    }
    this.emitChanged()
  }

  navigate(id: number, url: string): void {
    this.views.get(id)?.webContents.loadURL(url)
  }

  goBack(id: number): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(id: number): void {
    const wc = this.views.get(id)?.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: number): void {
    this.views.get(id)?.webContents.reload()
  }

  list(): TabInfo[] {
    return this.order.map((id) => {
      const wc = this.views.get(id)!.webContents
      return {
        id,
        url: wc.getURL(),
        title: wc.getTitle() || wc.getURL(),
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isActive: id === this.activeId
      }
    })
  }

  hideActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (view) this.window.contentView.removeChildView(view)
  }

  showActive(): void {
    if (this.activeId === null) return
    const view = this.views.get(this.activeId)
    if (view) {
      this.window.contentView.addChildView(view)
      this.layoutActive()
    }
  }
}
```

- [ ] **Step 3: Implement `src/main/tabs/ipc.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { TabManager } from './manager'

export function registerTabsIpc(win: BrowserWindow, tabs: TabManager): void {
  tabs.on('changed', (list) => win.webContents.send('tabs:changed', list))

  ipcMain.handle('tabs:list', () => tabs.list())
  ipcMain.handle('tabs:create', (_e, url: string) => tabs.createTab(url))
  ipcMain.handle('tabs:activate', (_e, id: number) => tabs.activateTab(id))
  ipcMain.handle('tabs:close', (_e, id: number) => tabs.closeTab(id))
  ipcMain.handle('tabs:navigate', (_e, id: number, url: string) => tabs.navigate(id, url))
  ipcMain.handle('tabs:goBack', (_e, id: number) => tabs.goBack(id))
  ipcMain.handle('tabs:goForward', (_e, id: number) => tabs.goForward(id))
  ipcMain.handle('tabs:reload', (_e, id: number) => tabs.reload(id))
}
```

- [ ] **Step 4: Wire tabs into `src/main/index.ts`**

Add alongside the existing vault wiring inside `app.whenReady().then(...)`, after `createWindow()` is called and the window reference is retained:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  app.setName('NYX Browser')
  const vault = new VaultManager(join(app.getPath('userData'), 'vault.nyx'))
  registerVaultIpc(vault)

  const win = createWindow()
  const tabs = new TabManager(win)
  registerTabsIpc(win, tabs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 5: Expose `window.nyx.tabs` from `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
  lock: () => ipcRenderer.invoke('vault:lock')
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

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi, tabs: tabsApi })
```

- [ ] **Step 6: Update `src/renderer/src/nyx-global.d.ts`**

```ts
import type { VaultApi } from '../../shared/vault-types'
import type { TabsApi } from '../../shared/tab-types'

declare global {
  interface Window {
    nyx: { vault: VaultApi; tabs: TabsApi }
  }
}

export {}
```

- [ ] **Step 7: Verify manually**

Run: `npm run dev`, unlock the vault (as set up in Task 8), then in DevTools console:
```js
const id = await window.nyx.vault.isUnlocked() && await window.nyx.tabs.create('https://example.com')
```
Expected: a `WebContentsView` appears below the (currently empty, y=88px reserved) top of the window showing example.com. Run `await window.nyx.tabs.list()` — expect an array with one entry whose `url` is `https://example.com/` and `title` is `"Example Domain"`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/tab-types.ts src/main/tabs src/main/index.ts src/preload/index.ts src/renderer/src/nyx-global.d.ts
git commit -m "feat: add tab management (WebContentsView lifecycle) and tabs IPC"
```

---

### Task 11: Browser chrome UI (tab strip + address bar)

**Files:**
- Create: `src/renderer/src/browser/TabStrip.tsx`
- Create: `src/renderer/src/browser/AddressBar.tsx`
- Create: `src/renderer/src/browser/BrowserChrome.tsx`
- Create: `src/renderer/src/browser/browser.css`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.nyx.tabs` (Task 10), `resolveAddressBarInput` (Task 9), `TabInfo` (Task 10).
- Produces (used by Task 12): `<BrowserChrome />` — self-contained, subscribes to tab state itself, no props needed. `TabInfo.isActive` (added retroactively to Task 10 above) is the single source of truth for which tab is active — the renderer never tracks its own "active tab" state, it just derives `tabs.find(t => t.isActive)` on every update, so it can never drift from what the main process actually did.

Verified manually alongside Task 10's Step 7 — this is UI wiring over already-verified IPC, not new logic worth a separate unit-test harness (its one piece of real logic, `resolveAddressBarInput`, already has its own tests from Task 9).

- [ ] **Step 1: Write `src/renderer/src/browser/browser.css`**

```css
.browser-chrome {
  display: flex;
  flex-direction: column;
  height: 88px;
  background: #1a1a1d;
  color: #e6e6e6;
  font-family: system-ui, sans-serif;
}

.tab-strip {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 140px 0 8px;
  gap: 4px;
  -webkit-app-region: drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 30px;
  border-radius: 6px;
  background: #26262b;
  max-width: 200px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.tab-active {
  background: #34343c;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.tab-close,
.tab-new {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  line-height: 1;
  -webkit-app-region: no-drag;
}

.tab-close {
  font-size: 14px;
}

.tab-new {
  font-size: 16px;
}

.address-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 8px;
  background: #111113;
}

.address-bar button {
  background: #26262b;
  border: none;
  color: inherit;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
}

.address-bar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.address-input {
  flex: 1;
  background: #26262b;
  border: 1px solid #333;
  color: #e6e6e6;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
}
```

- [ ] **Step 2: Write `src/renderer/src/browser/TabStrip.tsx`**

```tsx
import type { TabInfo } from '../../../shared/tab-types'

interface TabStripProps {
  tabs: TabInfo[]
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onNewTab: () => void
}

export default function TabStrip({ tabs, onActivate, onClose, onNewTab }: TabStripProps): JSX.Element {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.isActive ? ' tab-active' : ''}`}
          onClick={() => onActivate(tab.id)}
        >
          <span className="tab-title">{tab.isLoading ? 'Loading…' : tab.title}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" aria-label="New tab" onClick={onNewTab}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/browser/AddressBar.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import { resolveAddressBarInput } from './resolveAddressBarInput'

interface AddressBarProps {
  tab: TabInfo | null
}

export default function AddressBar({ tab }: AddressBarProps): JSX.Element {
  const [input, setInput] = useState('')

  useEffect(() => {
    if (tab) setInput(tab.url)
  }, [tab?.id, tab?.url])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!tab) return
    window.nyx.tabs.navigate(tab.id, resolveAddressBarInput(input))
  }

  return (
    <form className="address-bar" onSubmit={handleSubmit}>
      <button type="button" disabled={!tab?.canGoBack} onClick={() => tab && window.nyx.tabs.goBack(tab.id)}>
        ←
      </button>
      <button type="button" disabled={!tab?.canGoForward} onClick={() => tab && window.nyx.tabs.goForward(tab.id)}>
        →
      </button>
      <button type="button" onClick={() => tab && window.nyx.tabs.reload(tab.id)}>
        ⟳
      </button>
      <input
        className="address-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search Brave or enter address"
      />
    </form>
  )
}
```

- [ ] **Step 4: Write `src/renderer/src/browser/BrowserChrome.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/tab-types'
import TabStrip from './TabStrip'
import AddressBar from './AddressBar'
import './browser.css'

export default function BrowserChrome(): JSX.Element {
  const [tabs, setTabs] = useState<TabInfo[]>([])

  useEffect(() => {
    let cancelled = false
    window.nyx.tabs.list().then((existing) => {
      if (cancelled) return
      if (existing.length === 0) {
        window.nyx.tabs.create('https://search.brave.com')
      } else {
        setTabs(existing)
      }
    })
    const unsubscribe = window.nyx.tabs.onChanged((updated) => {
      if (!cancelled) setTabs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null

  return (
    <div className="browser-chrome">
      <TabStrip
        tabs={tabs}
        onActivate={(id) => window.nyx.tabs.activate(id)}
        onClose={(id) => window.nyx.tabs.close(id)}
        onNewTab={() => window.nyx.tabs.create('https://search.brave.com')}
      />
      <AddressBar tab={activeTab} />
    </div>
  )
}
```

- [ ] **Step 5: Wire it into `App.tsx`**

```tsx
import { useState } from 'react'
import AuthGate from './auth/AuthGate'
import BrowserChrome from './browser/BrowserChrome'

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />
  }

  return <BrowserChrome />
}
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, complete setup/unlock as before. Expect: on first unlock, a tab opens automatically to Brave Search, shown as a native view below the 88px chrome. Open a couple more tabs with "+", navigate one to `example.com` via the address bar, confirm the title updates in the tab strip, confirm back/forward/reload work, confirm closing a tab falls back to an adjacent one, confirm the window can be dragged by its tab-strip area and the native Windows minimize/maximize/close buttons still work in the top-right.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/browser src/renderer/src/App.tsx
git commit -m "feat: add browser chrome UI (tab strip + address bar)"
```

---

### Task 12: Auto-lock, manual lock hotkey, and lock/unlock UI swap

Ties everything together: idle timeout, system sleep/lock-screen, a Ctrl+Shift+L shortcut that works regardless of which tab has focus, a manual "Lock" button, and hiding/restoring tabs so their content isn't visible while locked.

**Files:**
- Create: `src/main/shortcuts.ts`
- Test: `src/main/shortcuts.test.ts`
- Create: `src/main/idle.ts`
- Modify: `src/shared/vault-types.ts`
- Modify: `src/main/vault/ipc.ts` (already accepts `onLock`/`onUnlock` from Task 7 — no code change here, just start passing real callbacks from `index.ts`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/browser/TabStrip.tsx`
- Modify: `src/renderer/src/browser/BrowserChrome.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `isLockShortcut(input: Electron.Input): boolean`, `attachLockShortcut(webContents: Electron.WebContents, onLock: () => void): void`, `startIdleWatcher(timeoutSeconds: number, onIdle: () => void): () => void`, `DEFAULT_IDLE_TIMEOUT_SECONDS = 900`. `VaultApi` gains `onLocked(callback: () => void): () => void`.
- Design notes: the shortcut is attached to the chrome window's `webContents` **and** to every tab's `webContents` (via `TabManager`'s `onTabCreated` hook added in Task 10) so it fires no matter which view has focus — a global OS-wide shortcut (`globalShortcut`) was deliberately avoided since it would fire even while using other applications. Idle/lock-screen/hotkey/manual-button all funnel through one `lock()` closure in `index.ts` so tab-hiding and the `vault:locked` broadcast can never be forgotten on one path but not another.

- [ ] **Step 1: Write the failing test for the shortcut matcher**

```ts
// src/main/shortcuts.test.ts
import { describe, it, expect } from 'vitest'
import { isLockShortcut } from './shortcuts'

describe('isLockShortcut', () => {
  it('matches Ctrl+Shift+L on keydown', () => {
    expect(isLockShortcut({ type: 'keyDown', control: true, shift: true, key: 'L' } as Electron.Input)).toBe(true)
  })

  it('matches lowercase l', () => {
    expect(isLockShortcut({ type: 'keyDown', control: true, shift: true, key: 'l' } as Electron.Input)).toBe(true)
  })

  it('rejects without shift', () => {
    expect(isLockShortcut({ type: 'keyDown', control: true, shift: false, key: 'l' } as Electron.Input)).toBe(false)
  })

  it('rejects a different key', () => {
    expect(isLockShortcut({ type: 'keyDown', control: true, shift: true, key: 'k' } as Electron.Input)).toBe(false)
  })

  it('rejects keyUp events', () => {
    expect(isLockShortcut({ type: 'keyUp', control: true, shift: true, key: 'l' } as Electron.Input)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shortcuts.test.ts`
Expected: FAIL — `./shortcuts` module does not exist yet.

- [ ] **Step 3: Implement `src/main/shortcuts.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shortcuts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement `src/main/idle.ts`** (no unit test — thin wrapper over `powerMonitor`, which only runs inside Electron; verified manually in Step 10)

```ts
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
```

- [ ] **Step 6: Add `onLocked` to `src/shared/vault-types.ts`**

```ts
export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong-credentials' | 'wrong-totp' | 'locked-out' }

export interface SetupResult {
  totpProvisioningUri: string
  recoveryKey: string
}

export interface VaultApi {
  exists(): Promise<boolean>
  isUnlocked(): Promise<boolean>
  setup(password: string): Promise<SetupResult>
  unlockWithPassword(password: string, totpCode: string): Promise<UnlockResult>
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<UnlockResult>
  lock(): Promise<void>
  onLocked(callback: () => void): () => void
}
```

- [ ] **Step 7: Wire `onLocked` into `src/preload/index.ts`** (full file — replaces Task 10's version)

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '../shared/vault-types'
import type { TabInfo, TabsApi } from '../shared/tab-types'

const vaultApi: VaultApi = {
  exists: () => ipcRenderer.invoke('vault:exists'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  setup: (password) => ipcRenderer.invoke('vault:setup', password),
  unlockWithPassword: (password, totpCode) => ipcRenderer.invoke('vault:unlockWithPassword', password, totpCode),
  unlockWithRecoveryKey: (recoveryKey, newPassword) =>
    ipcRenderer.invoke('vault:unlockWithRecoveryKey', recoveryKey, newPassword),
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

contextBridge.exposeInMainWorld('nyx', { vault: vaultApi, tabs: tabsApi })
```

- [ ] **Step 8: Final `src/main/index.ts`** (full file — replaces Task 10's version)

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultManager } from './vault/manager'
import { registerVaultIpc } from './vault/ipc'
import { TabManager } from './tabs/manager'
import { registerTabsIpc } from './tabs/ipc'
import { attachLockShortcut } from './shortcuts'
import { startIdleWatcher, DEFAULT_IDLE_TIMEOUT_SECONDS } from './idle'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1d', symbolColor: '#e6e6e6', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  app.setName('NYX Browser')
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

  tabs = new TabManager(win, (wc) => attachLockShortcut(wc, lock))
  registerVaultIpc(vault, lock, unlock)
  registerTabsIpc(win, tabs)
  attachLockShortcut(win.webContents, lock)

  const stopIdleWatcher = startIdleWatcher(DEFAULT_IDLE_TIMEOUT_SECONDS, lock)
  win.on('closed', stopIdleWatcher)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 9: Add a manual lock button and lock-state listener in the renderer**

Modify `src/renderer/src/browser/TabStrip.tsx` — add an `onLock` prop and a button:

```tsx
import type { TabInfo } from '../../../shared/tab-types'

interface TabStripProps {
  tabs: TabInfo[]
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onNewTab: () => void
  onLock: () => void
}

export default function TabStrip({ tabs, onActivate, onClose, onNewTab, onLock }: TabStripProps): JSX.Element {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.isActive ? ' tab-active' : ''}`}
          onClick={() => onActivate(tab.id)}
        >
          <span className="tab-title">{tab.isLoading ? 'Loading…' : tab.title}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" aria-label="New tab" onClick={onNewTab}>
        +
      </button>
      <button className="tab-lock" aria-label="Lock NYX Browser" onClick={onLock}>
        Lock
      </button>
    </div>
  )
}
```

Add a `.tab-lock` rule to `src/renderer/src/browser/browser.css` (alongside the existing `.tab-close, .tab-new` rule) so the text button doesn't look like an unstyled default:

```css
.tab-lock {
  background: #26262b;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  -webkit-app-region: no-drag;
}
```

Modify `src/renderer/src/browser/BrowserChrome.tsx` — pass the new prop:

```tsx
      <TabStrip
        tabs={tabs}
        onActivate={(id) => window.nyx.tabs.activate(id)}
        onClose={(id) => window.nyx.tabs.close(id)}
        onNewTab={() => window.nyx.tabs.create('https://search.brave.com')}
        onLock={() => window.nyx.vault.lock()}
      />
```

Modify `src/renderer/src/App.tsx` — listen for main-initiated locks (idle/sleep/hotkey):

```tsx
import { useEffect, useState } from 'react'
import AuthGate from './auth/AuthGate'
import BrowserChrome from './browser/BrowserChrome'

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => window.nyx.vault.onLocked(() => setUnlocked(false)), [])

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />
  }

  return <BrowserChrome />
}
```

- [ ] **Step 10: Verify manually**

Run: `npm run dev`, unlock, open a couple of tabs.
1. Click the "Lock" button — expect the unlock screen to reappear immediately and the tab content to no longer be visible. Unlock again — expect your tabs to still be there, showing the pages you left them on.
2. Click into a tab's page content (so it, not the chrome, has focus) and press `Ctrl+Shift+L` — expect the same instant lock. This specifically checks the hotkey works when a tab (not the chrome UI) has focus.
3. To check the idle timer without waiting 15 minutes: temporarily change `DEFAULT_IDLE_TIMEOUT_SECONDS` in `src/main/idle.ts` to `10`, restart `npm run dev`, unlock, then don't touch the mouse/keyboard for 10+ seconds — expect it to auto-lock. Revert the value afterward.
4. Lock, then simulate sleep by running `pmset sleepnow`-equivalent on Windows (or just trust the `suspend`/`lock-screen` listener registration from Step 5 by code review, since actually sleeping the test machine isn't practical mid-session) — note in your PR/commit that this path is covered by the same `onIdle` callback already verified in steps 1-3, not independently exercised.

- [ ] **Step 11: Commit**

```bash
git add src/main/shortcuts.ts src/main/shortcuts.test.ts src/main/idle.ts src/shared/vault-types.ts src/preload/index.ts src/main/index.ts src/renderer/src/browser/TabStrip.tsx src/renderer/src/browser/BrowserChrome.tsx src/renderer/src/App.tsx
git commit -m "feat: add auto-lock (idle/sleep), lock hotkey, manual lock button, and lock/unlock UI swap"
```

---

## Phase 1 complete

At this point: `npm run dev` launches NYX Browser, first run walks through master-password + TOTP + recovery-key setup, every subsequent launch requires the password and a 6-digit code, the vault is one AES-256-GCM-encrypted file with no native dependencies, tabs work (open/close/switch/navigate/back/forward/reload), the address bar defaults to Brave Search, and the browser locks on idle/sleep/hotkey/manual click while preserving open tabs. Phase 2 (password manager + autofill) builds directly on `VaultContentsV1` (add a `credentials` field) and the existing vault/unlock infrastructure.
