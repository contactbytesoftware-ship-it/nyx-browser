import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { drawMonogramPng } from './generate-icon.mjs'

describe('drawMonogramPng', () => {
  it('produces a valid PNG buffer', () => {
    const buffer = drawMonogramPng(256)
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('paints the corners with the background color and the center with the accent color', () => {
    const buffer = drawMonogramPng(256)
    const png = PNG.sync.read(buffer)
    const pixelAt = (x, y) => {
      const idx = (png.width * y + x) << 2
      return [png.data[idx], png.data[idx + 1], png.data[idx + 2]]
    }
    // Background: the app's existing --bg dark shade (see global.css).
    expect(pixelAt(0, 0)).toEqual([0x1a, 0x1a, 0x1d])
    // Center: the app's existing --accent purple (see settings-types.ts DEFAULT_SETTINGS).
    expect(pixelAt(128, 128)).toEqual([0x6c, 0x4c, 0xf1])
  })
})
