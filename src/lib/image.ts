import type { ImageOrigin } from '../types/contact'
import {
  HEADER_READ_BYTES,
  readImageDimensions,
  type ImageDimensions,
} from './imageDimensions'

/** Formats the OCR engine reliably recognises. */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const

/** Mirrors ACCEPTED_IMAGE_TYPES for the `accept` attribute on the file inputs. */
export const IMAGE_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_IMAGE_TYPES,
  'image/*',
].join(',')

/**
 * `image/*` is included above so iOS Safari offers the camera and the photo
 * library rather than a restricted list -- a tight `accept` removes the camera
 * option entirely on iOS.
 *
 * These extensions are a fallback for files whose MIME type is missing or
 * generic, such as `application/octet-stream`. They are not a claim that HEIC is
 * converted: Tesseract cannot decode HEIC, so a `.heic` chosen from Files is
 * rejected. Photos captured through the in-page camera arrive as JPEG.
 */
export const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const

export const MAX_FILE_BYTES = 20 * 1024 * 1024

/**
 * OCR is run on a downscaled copy. Tesseract is happiest around 300 DPI, so
 * capping the longest edge keeps large phone photos fast without starving small
 * card images of detail.
 */
export const MAX_OCR_DIMENSION = 2200

/**
 * Ceiling on the pixel count of a source image.
 *
 * This is a pre-decode guard, so it is the last line of defence before the
 * browser expands a file into a bitmap at roughly four bytes per pixel. A
 * bitmap is what kills a phone tab, not the compressed file: a 68-megapixel
 * photo is a 4MB JPEG but about 270MB once decoded, which exceeds the per-tab
 * budget and terminates the tab with no error, no message and no way back for
 * the user.
 *
 * The limit is deliberately generous. 80 megapixels is comfortably above any
 * camera capture the app will meet -- a 4MB phone photo lands around 68
 * megapixels -- and it still rejects the pathological inputs, such as a
 * stitched panorama or a decompression-bomb fixture, before they are decoded.
 *
 * `MAX_FILE_BYTES` remains the first filter. Together they bound both the
 * download and the decode: a file has to be under 20MB *and* under 80
 * megapixels to be considered.
 *
 * Reading the dimensions out of the file header, rather than from
 * `naturalWidth`, is what makes this a guard instead of a report: the width is
 * only known once decoding has already finished. See `imageDimensions.ts`.
 */
export const MAX_SOURCE_PIXELS = 80_000_000

/**
 * Why an image could not be prepared for OCR.
 *
 * Carried on `ImagePrepareError` so the screen can say something useful. These
 * are different problems with different remedies, and collapsing them into one
 * generic message is what made the production image-size bug look like a
 * corrupt-file bug.
 */
export type ImagePrepareReason =
  | 'too-many-pixels'
  | 'decode-failed'
  | 'empty-dimensions'
  | 'no-canvas'

/**
 * An image that cannot be prepared, tagged with why.
 *
 * The message on the error is for logs and tests. The screen renders copy
 * based on `reason` and never shows the raw message, so nothing internal or
 * stack-shaped reaches the user.
 */
export class ImagePrepareError extends Error {
  readonly reason: ImagePrepareReason

  constructor(reason: ImagePrepareReason, message: string) {
    super(message)
    this.name = 'ImagePrepareError'
    this.reason = reason
  }
}

export interface PreparedImage {
  /** Downscaled, white-backed bitmap handed to the OCR engine. */
  canvas: HTMLCanvasElement
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()

  return ACCEPTED_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * Returns a human-readable reason to reject the file, or null when it is fine.
 * Kept separate from the file input so the same rules can be reused later by
 * drag-and-drop or paste handlers.
 */
export function getImageFileError(file: File | null): string | null {
  if (file === null) return 'No file was selected.'

  if (file.size === 0) return 'That file is empty.'

  if (file.size > MAX_FILE_BYTES) {
    return `That image is ${formatBytes(file.size)}. Please choose one under ${formatBytes(MAX_FILE_BYTES)}.`
  }

  const typeIsAccepted = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(
    file.type,
  )

  // iOS Safari can report an empty or vendor-specific type for camera roll
  // items, so fall back to the extension before rejecting.
  if (!typeIsAccepted && !hasAcceptedExtension(file.name)) {
    return 'Please choose a JPG, PNG or WebP image.'
  }

  return null
}

/**
 * Turns a preparation failure into something a person can act on.
 *
 * These are different problems with different remedies, so they get different
 * messages. Reporting every one of them as "that image could not be opened" is
 * what made an oversized photo look like a corrupt file: the user is sent
 * looking for damage that is not there, and the real cause stays invisible.
 *
 * Copy is chosen by `reason`, so the underlying message and its stack never
 * reach the screen. The original is kept on the error for the console.
 *
 * Unsupported file types are not handled here because they never get this far:
 * `getImageFileError` rejects them at selection with its own message.
 */
export function describePrepareFailure(error: unknown): string {
  if (!(error instanceof ImagePrepareError)) {
    return 'That image could not be prepared for scanning. Please choose another one.'
  }

  switch (error.reason) {
    case 'too-many-pixels':
      return 'That image is too large to read on this device. Cropping it or exporting a smaller copy will work — a card only needs a readable photo, not a full-resolution one.'
    case 'decode-failed':
      return 'That image could not be opened. It may be damaged, or still uploading. Try choosing it again.'
    case 'empty-dimensions':
      return 'That image came back empty. Please choose another one.'
    case 'no-canvas':
      return 'This browser could not prepare the image for scanning. Updating the browser, or using another one, usually fixes this.'
  }
}

export function inferImageOrigin(file: File, requested: ImageOrigin): ImageOrigin {
  // Camera captures arrive as "IMG_xxxx.jpg"; anything explicitly named by the
  // user is treated as an upload so the metadata stays honest.
  if (requested === 'camera') return 'camera'

  return /^img[_-]?\d/i.test(file.name) ? 'camera' : 'upload'
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(
        new ImagePrepareError(
          'decode-failed',
          'The browser could not decode this image.',
        ),
      )
    image.src = src
  })
}

/**
 * Reads the pixel dimensions out of the file itself.
 *
 * Only a prefix of the file is read, so this stays cheap on a large photo. A
 * null result means the header was not recognised -- a format the parser does
 * not cover, or a malformed one -- and the caller falls back to measuring the
 * image after decoding, which is the behaviour this module replaced.
 */
async function readHeaderDimensions(
  file: File,
): Promise<ImageDimensions | null> {
  try {
    const head = await file.slice(0, HEADER_READ_BYTES).arrayBuffer()

    return readImageDimensions(new Uint8Array(head))
  } catch {
    // Reading a prefix can fail on an exotic File implementation. Not knowing
    // the dimensions is survivable, so this must not become an error.
    return null
  }
}

function exceedsPixelLimit(dimensions: ImageDimensions): boolean {
  return dimensions.width * dimensions.height > MAX_SOURCE_PIXELS
}

/**
 * Computes the OCR bitmap size, preserving the aspect ratio and capping the
 * longest edge at `MAX_OCR_DIMENSION`. Tesseract is happiest around 300 DPI, so
 * there is nothing to gain from a larger bitmap than this.
 */
export function getOcrTargetSize(
  originalWidth: number,
  originalHeight: number,
): { width: number; height: number } {
  const longestEdge = Math.max(originalWidth, originalHeight)
  const scale =
    longestEdge > MAX_OCR_DIMENSION ? MAX_OCR_DIMENSION / longestEdge : 1

  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  }
}

/**
 * Decodes the file and produces an OCR-ready bitmap.
 *
 * Drawing through an `<img>` element means the browser has already applied the
 * EXIF orientation, which matters for photos taken on iPhone. Transparent PNGs
 * and WebPs are flattened onto white first, because alpha confuses the OCR
 * binarisation step.
 *
 * The pixel budget is enforced twice on purpose. When the header can be read it
 * is checked before anything is decoded, which is the only point where refusing
 * actually saves memory. The same limit is re-checked afterwards for the case
 * where the header was unreadable, so an image that slipped past the cheap check
 * still cannot take the tab down.
 */
export async function prepareImageForOcr(file: File): Promise<PreparedImage> {
  const declared = await readHeaderDimensions(file)

  if (declared !== null && exceedsPixelLimit(declared)) {
    throw new ImagePrepareError(
      'too-many-pixels',
      `Source image is ${declared.width}x${declared.height}, above the ${MAX_SOURCE_PIXELS} pixel limit.`,
    )
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await loadImageElement(objectUrl)
    const originalWidth = image.naturalWidth
    const originalHeight = image.naturalHeight

    if (originalWidth === 0 || originalHeight === 0) {
      throw new ImagePrepareError(
        'empty-dimensions',
        'Decoded image reported no dimensions.',
      )
    }

    if (originalWidth * originalHeight > MAX_SOURCE_PIXELS) {
      throw new ImagePrepareError(
        'too-many-pixels',
        `Source image is ${originalWidth}x${originalHeight}, above the ${MAX_SOURCE_PIXELS} pixel limit.`,
      )
    }

    const { width, height } = getOcrTargetSize(originalWidth, originalHeight)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    if (context === null) {
      throw new ImagePrepareError(
        'no-canvas',
        'The browser refused a 2D canvas context.',
      )
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    return { canvas, width, height, originalWidth, originalHeight }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
