/**
 * Browser-level tests for image preparation.
 *
 * These need a real DOM -- `Image`, `File`, canvas -- so they run in headless
 * Chrome against the Vite dev server rather than in Node.
 *
 * The suite covers the four behaviours the production bug turned on:
 *   1. a normal phone photo prepares successfully
 *   2. an oversized image is refused from its header, before any decode
 *   3. a large-but-valid image is downscaled to the 2200px OCR cap
 *   4. a corrupt image fails with a distinct, meaningful reason
 */

import {
  makeCorruptBytes,
  makeEncodedFile,
  makeFile,
  synthesiseJpegHeader,
} from '../helpers/synthetic-image'
import { assertEqual, assertTrue, publish, run } from '../helpers/harness'
import { readImageDimensions } from '../../src/lib/imageDimensions'
import {
  describePrepareFailure,
  getOcrTargetSize,
  ImagePrepareError,
  MAX_OCR_DIMENSION,
  MAX_SOURCE_PIXELS,
  prepareImageForOcr,
} from '../../src/lib/image'

/**
 * Runs `body` while counting `new Image()` constructions.
 *
 * This is how the suite proves the size guard runs *before* decoding: a
 * rejection with a zero count means the file was refused from its header and
 * the browser was never asked to expand it into a bitmap.
 */
async function measure(
  body: () => Promise<unknown>,
): Promise<{ decodes: number; reason: string | null }> {
  const original = window.Image
  let decodes = 0

  class CountingImage extends original {
    constructor() {
      super()
      decodes += 1
    }
  }

  window.Image = CountingImage as unknown as typeof Image

  let reason: string | null = null

  try {
    await body()
  } catch (error) {
    reason =
      error instanceof ImagePrepareError
        ? error.reason
        : `not-an-image-prepare-error: ${String(error)}`
  } finally {
    window.Image = original
  }

  return { decodes, reason }
}

const tests: Array<[string, () => Promise<void> | void]> = [
  [
    'header parsing reads a real encoded JPEG',
    async () => {
      const file = await makeEncodedFile(1512, 2016)
      const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
      const dimensions = readImageDimensions(head)

      assertEqual(dimensions?.width, 1512, 'jpeg width from header')
      assertEqual(dimensions?.height, 2016, 'jpeg height from header')
    },
  ],
  [
    'header parsing reads a real encoded PNG',
    async () => {
      const file = await makeEncodedFile(640, 480, 'image/png')
      const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
      const dimensions = readImageDimensions(head)

      assertEqual(dimensions?.width, 640, 'png width from header')
      assertEqual(dimensions?.height, 480, 'png height from header')
    },
  ],
  [
    'header parsing reads a real encoded WebP',
    async () => {
      const file = await makeEncodedFile(300, 200, 'image/webp')
      const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
      const dimensions = readImageDimensions(head)

      assertEqual(dimensions?.width, 300, 'webp width from header')
      assertEqual(dimensions?.height, 200, 'webp height from header')
    },
  ],
  [
    'header parsing reads a synthesised oversized JPEG header',
    () => {
      const dimensions = readImageDimensions(synthesiseJpegHeader(12000, 7000))

      assertEqual(dimensions?.width, 12000, 'synthesised jpeg width')
      assertEqual(dimensions?.height, 7000, 'synthesised jpeg height')
    },
  ],
  [
    'header parsing returns null for bytes that are not an image',
    () => {
      assertEqual(readImageDimensions(makeCorruptBytes()), null, 'corrupt bytes give null')
    },
  ],
  [
    'a normal phone-sized JPEG prepares successfully',
    async () => {
      const file = await makeEncodedFile(1512, 2016)
      const prepared = await prepareImageForOcr(file)

      assertEqual(prepared.originalWidth, 1512, 'original width preserved')
      assertEqual(prepared.originalHeight, 2016, 'original height preserved')
      assertEqual(prepared.width, 1512, 'small image is not upscaled')
      assertEqual(prepared.height, 2016, 'small image height unchanged')
    },
  ],
  [
    'an oversized image is rejected before any decode happens',
    async () => {
      const file = makeFile(
        synthesiseJpegHeader(12000, 7000),
        'huge.jpg',
        'image/jpeg',
      )

      const { decodes, reason } = await measure(() => prepareImageForOcr(file))

      assertEqual(decodes, 0, 'no Image element was constructed')
      assertEqual(reason, 'too-many-pixels', 'oversized image reports too-many-pixels')
    },
  ],
  [
    'an oversized image is above the documented limit',
    () => {
      assertEqual(
        12000 * 7000 > MAX_SOURCE_PIXELS,
        true,
        '84MP exceeds the limit',
      )
      assertEqual(
        1512 * 2016 <= MAX_SOURCE_PIXELS,
        true,
        'phone photo is under the limit',
      )
    },
  ],
  [
    'a large but valid image is downscaled to the 2200px cap',
    async () => {
      // 24 megapixels: double the limit that caused the production bug, so this
      // fails if the old ceiling ever comes back.
      const file = await makeEncodedFile(6000, 4000)
      const prepared = await prepareImageForOcr(file)

      assertEqual(prepared.originalWidth, 6000, 'source width reported')
      assertEqual(prepared.originalHeight, 4000, 'source height reported')
      assertEqual(prepared.width, MAX_OCR_DIMENSION, 'longest edge capped at 2200')
      assertEqual(prepared.height, 1467, 'aspect ratio preserved when scaled')
    },
  ],
  [
    'the production case: a ~68MP photo passes the size guard',
    async () => {
      // A 4.2MB phone JPEG measures about 68 megapixels. The old 12MP limit
      // rejected it and reported it as an unreadable image, which is the bug
      // this suite exists to prevent.
      const header = synthesiseJpegHeader(9216, 7392)

      assertEqual(9216 * 7392 > 12_000_000, true, 'this size was rejected before')
      assertEqual(9216 * 7392 <= MAX_SOURCE_PIXELS, true, 'and is accepted now')

      // Header-only bytes cannot decode, so reaching a decode failure is the
      // proof that the size guard let the file through rather than refusing it.
      const file = makeFile(header, 'photo.jpg', 'image/jpeg')
      const { decodes, reason } = await measure(() => prepareImageForOcr(file))

      assertEqual(reason, 'decode-failed', 'passed the size guard and reached decode')
      assertEqual(decodes, 1, 'exactly one decode was attempted')
    },
  ],
  [
    'target size preserves aspect ratio and never returns zero',
    () => {
      assertEqual(getOcrTargetSize(4000, 1000).height, 550, 'wide image scaled')
      assertEqual(getOcrTargetSize(1000, 4000).width, 550, 'tall image scaled')
      assertEqual(getOcrTargetSize(800, 600).width, 800, 'small image untouched')
      assertEqual(getOcrTargetSize(5000, 5000).width, 2200, 'square capped')
      assertTrue(getOcrTargetSize(1, 10_000).width >= 1, 'thin image keeps a pixel')
      assertTrue(getOcrTargetSize(10_000, 1).height >= 1, 'flat image keeps a pixel')
    },
  ],
  [
    'a corrupt image fails with the decode-failed reason',
    async () => {
      const file = makeFile(makeCorruptBytes(), 'broken.jpg', 'image/jpeg')
      const { decodes, reason } = await measure(() => prepareImageForOcr(file))

      assertEqual(reason, 'decode-failed', 'corrupt image reports decode-failed')
      assertTrue(decodes >= 1, 'a corrupt file is attempted once, then failed', `decodes=${decodes}`)
    },
  ],
  [
    'an unreadable header still falls back and is not mislabelled as too large',
    async () => {
      // A format this project does not measure. The browser may decode it, so
      // the point is only that the header fallback does not invent a size error.
      const file = await makeEncodedFile(800, 600, 'image/bmp')
      const { reason } = await measure(() => prepareImageForOcr(file))

      assertTrue(
        reason === null || reason === 'decode-failed',
        'unmeasured format is not reported as too-many-pixels',
        `reason=${String(reason)}`,
      )
    },
  ],
  [
    'each failure reason produces its own user-facing message',
    () => {
      const tooLarge = describePrepareFailure(
        new ImagePrepareError('too-many-pixels', 'internal detail 84MP'),
      )
      const decode = describePrepareFailure(
        new ImagePrepareError('decode-failed', 'internal detail onerror'),
      )
      const empty = describePrepareFailure(
        new ImagePrepareError('empty-dimensions', 'internal detail 0x0'),
      )
      const canvas = describePrepareFailure(
        new ImagePrepareError('no-canvas', 'internal detail null context'),
      )

      const messages = [tooLarge, decode, empty, canvas]

      assertEqual(
        new Set(messages).size,
        4,
        'all four reasons give distinct copy',
      )
      assertTrue(
        messages.every((message) => !message.includes('internal detail')),
        'raw error text never reaches the user',
        messages.join(' | '),
      )
      assertTrue(
        messages.every((message) => !message.includes('at ') || !message.includes('.ts:')),
        'no stack-shaped text reaches the user',
      )
      assertTrue(
        tooLarge.toLowerCase().includes('too large'),
        'oversized copy names the real problem',
        tooLarge,
      )
    },
  ],
  [
    'an unexpected error still yields safe copy',
    () => {
      const message = describePrepareFailure(new Error('boom at foo.ts:12'))

      assertTrue(
        message.length > 0 && !message.includes('boom'),
        'unexpected errors are not leaked verbatim',
        message,
      )
    },
  ],
]

async function main(): Promise<void> {
  for (const [name, body] of tests) {
    await run(name, body)
  }

  publish()
}

void main()