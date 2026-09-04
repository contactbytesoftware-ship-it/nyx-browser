import { describe, it, expect } from 'vitest'
import { isLockShortcut, isFillShortcut } from './shortcuts'

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
