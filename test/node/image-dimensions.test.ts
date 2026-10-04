/**
 * Node tests for the pure header parser.
 *
 * `imageDimensions.ts` imports nothing, so it runs directly in Node with no
 * bundler and no test framework. The DOM-dependent behaviour lives in
 * `test/browser/image-prepare.ts`, which needs a real browser.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  HEADER_READ_BYTES,
  readImageDimensions,
} from '../../src/lib/imageDimensions.ts'
import { synthesiseJpegHeader, makeCorruptBytes } from '../helpers/synthetic-image.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('reads dimensions from a synthesised JPEG header', () => {
  const dimensions = readImageDimensions(synthesiseJpegHeader(12000, 7000))

  assert.deepEqual(dimensions, { width: 12000, height: 7000 })
})

test('reads dimensions from a synthesised JPEG header at the phone size', () => {
  const dimensions = readImageDimensions(synthesiseJpegHeader(1512, 2016))

  assert.deepEqual(dimensions, { width: 1512, height: 2016 })
})

test('reads dimensions from a real PNG on disk', () => {
  // Any PNG works; the fixtures directory is not committed, so this is skipped
  // when absent rather than failing.
  const candidate = join(here, '..', '..', 'src', 'assets', 'hero.png')

  let bytes: Buffer

  try {
    bytes = readFileSync(candidate)
  } catch {
    return
  }

  const dimensions = readImageDimensions(new Uint8Array(bytes))

  assert.notEqual(dimensions, null)
  assert.ok((dimensions?.width ?? 0) > 0)
  assert.ok((dimensions?.height ?? 0) > 0)
})

test('returns null for bytes that are not an image', () => {
  assert.equal(readImageDimensions(makeCorruptBytes()), null)
})

test('returns null rather than throwing on a truncated header', () => {
  assert.equal(readImageDimensions(new Uint8Array(0)), null)
  assert.equal(readImageDimensions(new Uint8Array([0xff, 0xd8])), null)
  assert.equal(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0])), null)
})

test('returns null for a JPEG whose scan data is never reached', () => {
  // SOI immediately followed by SOS: no start-of-frame marker exists.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])

  assert.equal(readImageDimensions(bytes), null)
})

test('returns null for a RIFF container that is not WebP', () => {
  const bytes = new Uint8Array(16)

  bytes.set([0x52, 0x49, 0x46, 0x46]) // "RIFF"
  bytes.set([0x57, 0x41, 0x56, 0x45]) // "WAVE"

  assert.equal(readImageDimensions(bytes), null)
})

test('ignores trailing bytes after a PNG signature', () => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const bytes = new Uint8Array(24)

  bytes.set(signature)

  const view = new DataView(bytes.buffer)
  view.setUint32(16, 640)
  view.setUint32(20, 480)

  assert.deepEqual(readImageDimensions(bytes), { width: 640, height: 480 })
})

test('the header read window is large enough for a real photo prefix', () => {
  assert.ok(HEADER_READ_BYTES >= 64 * 1024, 'reads at least 64KB')
})