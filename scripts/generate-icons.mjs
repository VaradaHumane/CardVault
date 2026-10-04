/**
 * Generates the PWA icon set.
 *
 * Written as a dependency-free PNG encoder rather than pulling in an image
 * library: the artwork is a handful of rounded rectangles, and `zlib` is the
 * only thing needed to emit a valid PNG. Keeping it in the repo means the icons
 * can be regenerated and reviewed like any other source file.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/icons')

// Matches --bg and --accent in src/index.css so the installed app keeps the
// existing beige and green identity.
const BEIGE = [246, 239, 227]
const GREEN = [47, 111, 78]

/** 4x supersampling, so the rounded corners and bars land cleanly. */
const SAMPLES = 4

/* ------------------------------------------------------------------ *
 * Minimal RGBA PNG encoder (8-bit truecolour with alpha, no interlace)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1

    table[n] = c >>> 0
  }

  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff

  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)

  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)

  return Buffer.concat([length, body, crc])
}

/** `pixels` is RGBA, row-major, `size` x `size`. */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: truecolour with alpha
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // interlace

  // Each scanline is prefixed with its filter type; 0 (None) keeps this simple
  // and the files are tiny either way.
  const raw = Buffer.alloc(size * (size * 4 + 1))

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 * Shape helpers, all in fractional 0..1 coordinates
 * ------------------------------------------------------------------ */

/** Signed-distance test for a rounded rectangle, sampled with supersampling. */
function insideRoundedRect(x, y, rect) {
  const { x0, y0, x1, y1, radius } = rect
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius)
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius)

  const dx = x - cx
  const dy = y - cy

  return dx * dx + dy * dy <= radius * radius
}

/**
 * Draws the business-card glyph.
 *
 * A rounded card outline with two text bars inside: recognisable at 48px and
 * identical in both colourways so only the fill changes between variants.
 *
 * `scale` shrinks the artwork about the centre, which is how the maskable
 * variants keep it inside the safe zone the launcher may crop to.
 */
function cardGlyph(color, scale = 1) {
  const at = (v) => 0.5 + (v - 0.5) * scale

  const resize = (rect) => ({
    x0: at(rect.x0),
    y0: at(rect.y0),
    x1: at(rect.x1),
    y1: at(rect.y1),
    radius: rect.radius * scale,
  })

  const outline = { x0: 0.215, y0: 0.3, x1: 0.785, y1: 0.7, radius: 0.055 }

  return [
    {
      shape: resize(outline),
      mode: 'outline',
      stroke: 0.052 * scale,
      color,
    },
    { shape: resize({ x0: 0.325, y0: 0.415, x1: 0.675, y1: 0.468, radius: 0.026 }), mode: 'fill', color },
    { shape: resize({ x0: 0.325, y0: 0.532, x1: 0.545, y1: 0.585, radius: 0.026 }), mode: 'fill', color },
  ]
}

/**
 * Renders one icon.
 *
 * `bleed` paints the background edge to edge (for maskable icons, which the
 * platform crops), otherwise a rounded beige plate with transparent corners.
 */
function render(size, { background, glyph, rounded, scale = 1 }) {
  const pixels = Buffer.alloc(size * size * 4)
  const step = 1 / (size * SAMPLES)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px * SAMPLES + sx + 0.5) * step
          const y = (py * SAMPLES + sy + 0.5) * step

          let sample = [0, 0, 0, 0]

          if (!rounded || insideRoundedRect(x, y, { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98, radius: 0.22 })) {
            sample = [...background, 255]

            for (const part of cardGlyph(glyph, scale)) {
              const hit =
                part.mode === 'fill'
                  ? insideRoundedRect(x, y, part.shape)
                  : insideRoundedRect(x, y, part.shape) &&
                    !insideRoundedRect(x, y, {
                      x0: part.shape.x0 + part.stroke,
                      y0: part.shape.y0 + part.stroke,
                      x1: part.shape.x1 - part.stroke,
                      y1: part.shape.y1 - part.stroke,
                      radius: Math.max(0, part.shape.radius - part.stroke),
                    })

              if (hit) sample = [...part.color, 255]
            }
          }

          r += sample[0] * sample[3]
          g += sample[1] * sample[3]
          b += sample[2] * sample[3]
          a += sample[3]
        }
      }

      const offset = (py * size + px) * 4
      // Average in premultiplied space, then un-premultiply, so transparent
      // corners do not bleed dark fringes into the edge pixels. The divisor is
      // 1/a, because r already carries one factor of alpha per sample.
      const weight = a === 0 ? 0 : 1 / a

      pixels[offset] = Math.round(r * weight)
      pixels[offset + 1] = Math.round(g * weight)
      pixels[offset + 2] = Math.round(b * weight)
      pixels[offset + 3] = Math.round(a / (SAMPLES * SAMPLES))
    }
  }

  return encodePng(pixels, size)
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

const VARIANTS = [
  // Purpose-built sizes for the manifest and the iOS home-screen icon.
  { file: 'icon-192.png', size: 192, background: BEIGE, glyph: GREEN, rounded: true },
  { file: 'icon-512.png', size: 512, background: BEIGE, glyph: GREEN, rounded: true },
  { file: 'apple-touch-icon.png', size: 180, background: BEIGE, glyph: GREEN, rounded: false },
  // Maskable icons must survive a circular crop, so the artwork stays inside
  // the central 80% safe zone and the background bleeds to every edge.
  { file: 'maskable-192.png', size: 192, background: GREEN, glyph: BEIGE, rounded: false, scale: 0.8 },
  { file: 'maskable-512.png', size: 512, background: GREEN, glyph: BEIGE, rounded: false, scale: 0.8 },
]

mkdirSync(OUT, { recursive: true })

for (const variant of VARIANTS) {
  const png = render(variant.size, variant)
  writeFileSync(resolve(OUT, variant.file), png)
  console.log(`${variant.file.padEnd(24)} ${variant.size}x${variant.size}  ${(png.length / 1024).toFixed(1)} KB`)
}

// A favicon that matches the app, replacing the leftover template artwork.
writeFileSync(resolve(OUT, '../favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${rgb(BEIGE)}"/>
  <rect x="13.8" y="19.2" width="36.4" height="25.6" rx="3.5" fill="none" stroke="${rgb(GREEN)}" stroke-width="3.3"/>
  <rect x="20.8" y="26.6" width="22.4" height="3.4" rx="1.7" fill="${rgb(GREEN)}"/>
  <rect x="20.8" y="34" width="14.1" height="3.4" rx="1.7" fill="${rgb(GREEN)}"/>
</svg>
`)
console.log('favicon.svg               CardVault card mark')

function rgb([r, g, b]) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}