/**
 * Reads pixel dimensions out of a JPEG, PNG or WebP header.
 *
 * The point of this module is to be able to *reject* an oversized image before
 * the browser decodes it. Decoding is the expensive step: a bitmap costs about
 * four bytes per pixel, so a 68-megapixel photo expands to roughly 270MB. On a
 * phone that is enough to terminate the tab, and by then the damage is done.
 *
 * `HTMLImageElement.naturalWidth` cannot be used for this, because it is only
 * populated once the decode has finished. Checking it is a report of what
 * already happened, not a guard against it.
 *
 * Everything here is pure and DOM-free so it can be unit tested in plain Node.
 */

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * How much of the file to read when looking for the header.
 *
 * A JPEG's dimensions live in a start-of-frame marker, which normally appears
 * within the first few hundred bytes but can be pushed later by a large EXIF
 * block or thumbnail. Reading a generous prefix keeps the common case cheap
 * while still catching those files. If the marker is not in this window the
 * caller falls back to checking after decoding, which is no worse than having
 * no check at all.
 */
export const HEADER_READ_BYTES = 512 * 1024

function matchesAscii(view: DataView, offset: number, text: string): boolean {
  if (offset + text.length > view.byteLength) return false

  for (let i = 0; i < text.length; i += 1) {
    if (view.getUint8(offset + i) !== text.charCodeAt(i)) return false
  }

  return true
}

/**
 * PNG: 8-byte signature, then the IHDR chunk whose data starts with the
 * dimensions as two big-endian 32-bit integers.
 */
function readPngDimensions(view: DataView): ImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  if (view.byteLength < 24) return null

  for (let i = 0; i < signature.length; i += 1) {
    if (view.getUint8(i) !== signature[i]) return null
  }

  // Bytes 8-11 are the chunk length, 12-15 are "IHDR", so the width is at 16.
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * JPEG: walk the marker segments until a start-of-frame marker, which carries
 * the dimensions after its length and precision fields.
 */
function readJpegDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 4) return null
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null

  let offset = 2

  while (offset + 3 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      // Resynchronise rather than give up: a stray padding byte is harmless.
      offset += 1
      continue
    }

    let marker = view.getUint8(offset + 1)

    // Runs of 0xff are legal padding before the real marker byte.
    while (marker === 0xff && offset + 2 < view.byteLength) {
      offset += 1
      marker = view.getUint8(offset + 1)
    }

    // Standalone markers: no payload, so no length to skip.
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2
      continue
    }

    // Start of scan: entropy-coded data follows and has no dimensions.
    if (marker === 0xda || marker === 0xd9) return null

    const length = view.getUint16(offset + 2)

    if (length < 2) return null

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc // DAC

    if (isStartOfFrame) {
      if (offset + 9 > view.byteLength) return null

      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      }
    }

    offset += 2 + length
  }

  return null
}

/** Reads a 24-bit little-endian integer, which is how VP8X stores its canvas. */
function readUint24LE(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) +
    view.getUint8(offset + 1) * 0x100 +
    view.getUint8(offset + 2) * 0x10000
  )
}

/** WebP: a RIFF container whose first chunk declares the dimensions. */
function readWebpDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 16) return null
  if (!matchesAscii(view, 0, 'RIFF') || !matchesAscii(view, 8, 'WEBP')) {
    return null
  }

  let offset = 12

  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8

    // Extended format: canvas size minus one, in 24-bit little-endian.
    if (matchesAscii(view, offset, 'VP8X')) {
      if (start + 10 > view.byteLength) return null

      return {
        width: 1 + readUint24LE(view, start + 4),
        height: 1 + readUint24LE(view, start + 7),
      }
    }

    // Lossy: a 3-byte frame tag, then the sync code, then 14-bit dimensions.
    if (matchesAscii(view, offset, 'VP8 ')) {
      if (start + 10 > view.byteLength) return null
      if (
        view.getUint8(start + 3) !== 0x9d ||
        view.getUint8(start + 4) !== 0x01 ||
        view.getUint8(start + 5) !== 0x2a
      ) {
        return null
      }

      return {
        width: view.getUint16(start + 6, true) & 0x3fff,
        height: view.getUint16(start + 8, true) & 0x3fff,
      }
    }

    // Lossless: one signature byte, then both dimensions packed into 28 bits.
    if (matchesAscii(view, offset, 'VP8L')) {
      if (start + 5 > view.byteLength) return null
      if (view.getUint8(start) !== 0x2f) return null

      const packed = view.getUint32(start + 1, true)

      return {
        width: 1 + (packed & 0x3fff),
        height: 1 + ((packed >> 14) & 0x3fff),
      }
    }

    // Chunks are padded to an even length.
    offset = start + size + (size % 2)
  }

  return null
}

/**
 * Returns the pixel dimensions of a JPEG, PNG or WebP, or null when the bytes
 * are not one of those or the header cannot be parsed.
 *
 * A null result is not an error. It means the caller has to fall back to
 * measuring the image after decoding it, which is slower and less safe but
 * still correct.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const png = readPngDimensions(view)
  if (png !== null) return png

  const jpeg = readJpegDimensions(view)
  if (jpeg !== null) return jpeg

  return readWebpDimensions(view)
}