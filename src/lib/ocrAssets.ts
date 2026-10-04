import { withBase } from './paths'

/**
 * Reports and prepares the self-hosted OCR engine for offline use.
 *
 * The engine, its WASM core and the language model are too large to precache at
 * install time, so they are fetched the first time somebody scans a card. That
 * works, but it means a first scan with no connection fails.
 *
 * This module exposes the state of those files so the Settings screen can say
 * honestly whether offline OCR is ready, and can offer a way to make it ready
 * deliberately. It never inspects the Cache API for contacts or exports.
 */

const OCR_BASE = withBase('ocr')

/** Must stay in step with the copy step documented in the README. */
export const OCR_WORKER_URL = `${OCR_BASE}/tesseract-worker.min.js`

export const OCR_LANGUAGE_URL = `${OCR_BASE}/eng.traineddata.gz`

/**
 * All three core builds are shipped because Tesseract feature-detects WASM
 * SIMD support at runtime and will only ever load one of them.
 */
export const OCR_CORE_URLS = [
  `${OCR_BASE}/tesseract-core-relaxedsimd-lstm.wasm.js`,
  `${OCR_BASE}/tesseract-core-simd-lstm.wasm.js`,
  `${OCR_BASE}/tesseract-core-lstm.wasm.js`,
]

export const OCR_ASSET_URLS = [OCR_WORKER_URL, OCR_LANGUAGE_URL, ...OCR_CORE_URLS]

/** Must match the `cacheName` of the OCR runtime rule in vite.config.ts. */
const OCR_CACHE_NAME = 'cardvault-ocr'

export type OcrAssetState = 'ready' | 'partial' | 'missing' | 'unsupported'

export interface OcrAssetStatus {
  state: OcrAssetState
  /** How many of the expected files are already stored locally. */
  cached: number
  total: number
}

/**
 * True when this browser exposes a service worker, which is what makes the
 * cache persistent. Without one the files can still be fetched, but only for
 * the life of the page.
 */
export function supportsOfflineCache(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

async function readCachedUrls(): Promise<Set<string>> {
  if (!supportsOfflineCache() || typeof caches === 'undefined') return new Set()

  try {
    const cache = await caches.open(OCR_CACHE_NAME)
    const keys = await cache.keys()

    return new Set(keys.map((request) => new URL(request.url).pathname))
  } catch {
    // A blocked or unavailable Cache API just means "not cached".
    return new Set()
  }
}

/** Reports which OCR files are already stored on the device. */
export async function getOcrAssetStatus(): Promise<OcrAssetStatus> {
  const cached = await readCachedUrls()
  const total = OCR_ASSET_URLS.length

  // Only the core this browser will actually load is required; the other two
  // exist for devices with different WASM support.
  const present = OCR_ASSET_URLS.filter((url) => cached.has(url)).length
  const ready = cached.has(OCR_WORKER_URL) &&
    cached.has(OCR_LANGUAGE_URL) &&
    OCR_CORE_URLS.some((url) => cached.has(url))

  const state: OcrAssetState = !supportsOfflineCache()
    ? 'unsupported'
    : ready
      ? 'ready'
      : present > 0
        ? 'partial'
        : 'missing'

  return { state, cached: present, total }
}

/**
 * Downloads the OCR files so a later scan works with no connection.
 *
 * The response is only read to completion and discarded: the point is the
 * service-worker cache, and holding ~15 MB in memory would risk the tab being
 * killed on a phone. Failures are reported per file so one unavailable core
 * does not look like a total failure.
 */
export async function prepareOcrAssets(
  onProgress?: (done: number, total: number) => void,
): Promise<OcrAssetStatus> {
  const total = OCR_ASSET_URLS.length

  const results = await Promise.allSettled(
    OCR_ASSET_URLS.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' })

      if (!response.ok) throw new Error(`Could not download ${url}`)

      // Draining the body is what lets the service worker store the response.
      await response.arrayBuffer()

      return url
    }),
  )

  const failed = results.filter((result) => result.status === 'rejected')
  const done = results.length - failed.length

  onProgress?.(done, total)

  if (failed.length === total) {
    /*
     * Previously the rejections were discarded, so tapping this button with no
     * connection reset the label to "Not stored yet" and reported nothing. A
     * total failure has to be an error, not a status.
     */
    const offline =
      typeof navigator !== 'undefined' && navigator.onLine === false

    throw new Error(
      offline
        ? 'You appear to be offline. Reconnect and try again.'
        : 'None of the recognition files could be downloaded. Check your connection and try again.',
    )
  }

  return getOcrAssetStatus()
}

/** Approximate download size, used to warn before a large one-off download. */
export const OCR_PREPARE_SIZE_LABEL = 'About 15 MB'