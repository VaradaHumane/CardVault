import type { ImageOrigin } from '../types/contact'

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
 * Ceiling on the decoded bitmap, in pixels.
 *
 * 12 megapixels is about 50MB once decoded, which is where a phone starts
 * terminating the tab instead of reporting an error.
 */
export const MAX_DECODED_PIXELS = 12_000_000

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
      reject(new Error('This image could not be opened by the browser.'))
    image.src = src
  })
}

/**
 * Decodes the file and produces an OCR-ready bitmap.
 *
 * Drawing through an `<img>` element means the browser has already applied the
 * EXIF orientation, which matters for photos taken on iPhone. Transparent PNGs
 * and WebPs are flattened onto white first, because alpha confuses the OCR
 * binarisation step.
 */
export async function prepareImageForOcr(file: File): Promise<PreparedImage> {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await loadImageElement(objectUrl)
    const originalWidth = image.naturalWidth
    const originalHeight = image.naturalHeight

    if (originalWidth === 0 || originalHeight === 0) {
      throw new Error('This image has no readable dimensions.')
    }

    /*
     * The decode above has already happened: a browser expands a JPEG to a full
     * bitmap at roughly 4 bytes per pixel, and Tesseract then allocates a WASM
     * heap on top. A 12MP phone photo is around 50MB of bitmap before any of
     * that. On iOS, exceeding the per-tab budget kills the tab outright, which
     * throws nothing, shows no message and loses the photo the user just took.
     *
     * Refusing an image this large turns an unexplained reload into an
     * explanation. The limit is well above any realistic card photo, which is
     * normally a couple of megapixels.
     */
    if (originalWidth * originalHeight > MAX_DECODED_PIXELS) {
      throw new Error(
        'This photo is too large to read on this device. Take the picture again from a little further away, or crop it first.',
      )
    }

    const longestEdge = Math.max(originalWidth, originalHeight)
    const scale =
      longestEdge > MAX_OCR_DIMENSION ? MAX_OCR_DIMENSION / longestEdge : 1
    const width = Math.max(1, Math.round(originalWidth * scale))
    const height = Math.max(1, Math.round(originalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    if (context === null) {
      throw new Error('This browser cannot prepare images for scanning.')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    return { canvas, width, height, originalWidth, originalHeight }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
