import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const BACKGROUND = { r: 0x1a, g: 0x1a, b: 0x1d }
const ACCENT = { r: 0x6c, g: 0x4c, b: 0xf1 }

/**
 * A flat placeholder mark: the app's accent-purple circle on its own dark
 * background. Not real design work — swap this script's output for a real
 * icon whenever one exists.
 */
export function drawMonogramPng(size) {
  const png = new PNG({ width: size, height: size })
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.38

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2
      const dx = x - cx
      const dy = y - cy
      const inCircle = dx * dx + dy * dy <= radius * radius
      const color = inCircle ? ACCENT : BACKGROUND
      png.data[idx] = color.r
      png.data[idx + 1] = color.g
      png.data[idx + 2] = color.b
      png.data[idx + 3] = 0xff
    }
  }

  return PNG.sync.write(png)
}

async function main() {
  const pngBuffer = drawMonogramPng(256)
  const icoBuffer = await pngToIco(pngBuffer)
  const outPath = fileURLToPath(new URL('../build/icon.ico', import.meta.url))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, icoBuffer)
  console.log(`Wrote ${outPath}`)
}

// Only run when executed directly (`node scripts/generate-icon.mjs`), not when
// imported by the test. pathToFileURL (not a raw `file://` template) keeps this
// comparison correct on Windows, where drive letters and backslashes would
// otherwise make a naive string comparison fail.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
