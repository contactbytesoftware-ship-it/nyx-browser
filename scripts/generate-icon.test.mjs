import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { buildIconPng } from './generate-icon.mjs'

describe('buildIconPng', () => {
  it('produces a valid, correctly-sized PNG buffer', async () => {
    const buffer = await buildIconPng()
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const png = PNG.sync.read(buffer)
    expect(png.width).toBe(256)
    expect(png.height).toBe(256)
  })

  it('centers real mark content inside the padded square, not just a blank canvas', async () => {
    const buffer = await buildIconPng()
    const png = PNG.sync.read(buffer)
    const alphaAt = (x, y) => png.data[(png.width * y + x) << 2 | 3]
    // The corners are outside the "contain"-fitted mark, so they stay fully
    // transparent padding.
    expect(alphaAt(2, 2)).toBe(0)
    expect(alphaAt(253, 253)).toBe(0)
    // The center falls inside the mark itself, which must not be transparent —
    // this is the check that would fail if the crop rectangle ever missed the
    // logo (e.g. the source image changed) and produced an empty icon.
    expect(alphaAt(128, 128)).toBeGreaterThan(0)
  })
})
