/**
 * Test-only image builders.
 *
 * The DOM tests need images with exact pixel dimensions, including ones no
 * camera produces, and committing multi-megabyte fixtures to the repository for
 * that would be wasteful. These helpers manufacture the bytes instead, so the
 * suite stays fast, deterministic and free of binary blobs.
 */

/** JPEG SOF0 marker. */
const SOF0 = 0xc0

/**
 * Builds a JPEG that declares the given dimensions but carries no image data.
 *
 * This is deliberate: a header-only JPEG is enough for the size guard, which
 * must reject the file from its header alone. If the guard regressed to
 * checking after decoding, this file could not be decoded and the test would
 * see the wrong failure instead, so it distinguishes the two behaviours.
 */
export function synthesiseJpegHeader(width: number, height: number): Uint8Array {
  const bytes: number[] = []

  const push16 = (value: number): void => {
    bytes.push((value >> 8) & 0xff, value & 0xff)
  }

  // SOI
  bytes.push(0xff, 0xd8)

  // APP0/JFIF, so the file looks like a normal JFIF header.
  bytes.push(0xff, 0xe0)
  push16(16)
  for (const char of 'JFIF') bytes.push(char.charCodeAt(0))
  bytes.push(0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)

  // SOF0: precision, height, width, component count, then one 3-byte entry per
  // component. Three components makes the declared size a believable 4:2:0.
  bytes.push(0xff, SOF0)
  push16(17)
  bytes.push(0x08)
  push16(height)
  push16(width)
  bytes.push(0x03)
  bytes.push(0x01, 0x22, 0x00)
  bytes.push(0x02, 0x11, 0x01)
  bytes.push(0x03, 0x11, 0x01)

  // EOI, so the byte string is a complete, if empty, JPEG.
  bytes.push(0xff, 0xd9)

  return new Uint8Array(bytes)
}

/** Wraps bytes in a File the app will accept as an image. */
export function makeFile(
  bytes: Uint8Array,
  name: string,
  type: string,
): File {
  return new File([bytes], name, { type })
}

/** Bytes that are deliberately not a decodable image in any format. */
export function makeCorruptBytes(): Uint8Array {
  const bytes = new Uint8Array(512)

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (i * 37 + 11) & 0xff
  }

  return bytes
}

/**
 * Draws a card-like image and encodes it, producing a genuinely decodable file
 * of the requested size. Used where the test needs a real decode, rather than
 * just a header.
 */
export async function makeEncodedFile(
  width: number,
  height: number,
  type = 'image/jpeg',
  quality = 0.92,
): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('test canvas unavailable')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#000000'

  // Some structure, so the encoder cannot compress the canvas down to nothing
  // and the file keeps roughly realistic proportions.
  for (let i = 0; i < 24; i += 1) {
    context.fillRect(
      Math.floor((width / 24) * i) + 4,
      Math.floor(height * 0.3),
      Math.max(2, Math.floor(width / 60)),
      Math.floor(height * 0.08),
    )
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })

  if (blob === null) {
    throw new Error('test image could not be encoded')
  }

  return new File([blob], `test-${width}x${height}`, { type })
}