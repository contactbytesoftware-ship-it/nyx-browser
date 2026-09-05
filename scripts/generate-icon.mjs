import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const SOURCE_PATH = fileURLToPath(new URL('../resources/logo-source.png', import.meta.url))

// Bounding box of just the "N" mark in resources/logo-source.png (558x447),
// found by scanning for non-background pixels — excludes the "NYX" wordmark
// beneath it, which is illegible at the small sizes an app icon actually
// renders at (16-32px). A 15px margin on each side keeps the mark from
// touching the crop edges before it gets padded to a square below.
const MARK_CROP = { left: 190, top: 99, width: 179, height: 157 }

/**
 * Crops the source logo down to just its mark and pads it into a square,
 * transparent-backed 256x256 PNG buffer — the shape electron-builder/png-to-ico
 * expect an app icon source in.
 */
export async function buildIconPng() {
  const source = await readFile(SOURCE_PATH)
  return sharp(source)
    .extract(MARK_CROP)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

async function main() {
  const pngBuffer = await buildIconPng()
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
