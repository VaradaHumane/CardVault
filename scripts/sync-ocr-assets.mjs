// Copies the Tesseract engine, its WASM cores and the English language model
// out of node_modules and into public/ocr, so the app can run offline.
//
// This has to run after installing or upgrading tesseract.js. Vite only serves
// files it knows about, and the app deliberately does not fall back to a CDN,
// so an out-of-date public/ocr means offline OCR fails.
//
// Run with: npm run sync:ocr
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { gzipSync, constants } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
const modules = join(root, 'node_modules')

/**
 * All three cores are copied because Tesseract feature-detects SIMD support at
 * runtime and loads exactly one of them. Shipping only the fastest would leave
 * devices without WASM SIMD unable to recognise anything offline.
 */
const files = [
  ['tesseract.js/dist/worker.min.js', 'tesseract-worker.min.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
]

mkdirSync(out, { recursive: true })

for (const [from, to] of files) {
  copyFileSync(join(modules, from), join(out, to))
  console.log(`copied  ${to}`)
}

// The language model ships uncompressed in the repo root and is fetched by
// Tesseract as `.traineddata.gz`, so it is gzipped here.
const source = join(root, 'eng.traineddata')
const compressed = gzipSync(readFileSync(source), { level: constants.Z_BEST_COMPRESSION })
writeFileSync(join(out, 'eng.traineddata.gz'), compressed)
console.log(`gzip    eng.traineddata.gz (${(compressed.length / 1024 / 1024).toFixed(1)} MB)`)

console.log('\nOCR assets are ready. Run `npm run icons` if the app icons changed too.')