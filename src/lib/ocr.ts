/**
 * Local OCR wrapper around Tesseract.js.
 *
 * Everything runs in a Web Worker inside the browser: the image is decoded and
 * recognised on the device, and no image or recognised text is sent anywhere.
 *
 * The worker script, WASM core and English language model are all served from
 * this origin rather than a CDN, which is what makes OCR work offline. They are
 * copied into `public/ocr/` by hand and cached by the service worker on first
 * use, so see `scripts/` and the PWA notes in the README before upgrading
 * Tesseract.js: the local copies must be refreshed in step with the dependency.
 */

import { withBase } from './paths'

/**
 * Where the self-hosted engine lives, relative to the deployment base.
 *
 * Tesseract appends the feature-detected filename to `corePath`, so this must
 * be a directory. With `OEM.LSTM_ONLY` it picks between three builds:
 * `tesseract-core-relaxedsimd-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`
 * and `tesseract-core-lstm.wasm.js`, depending on the browser's WASM support.
 * All three are shipped so no device is left without an offline engine.
 */
import * as Tesseract from 'tesseract.js'

const OCR_ASSET_BASE = withBase('ocr')

const OCR_WORKER_PATH = `${OCR_ASSET_BASE}/tesseract-worker.min.js`

const OCR_CORE_PATH = OCR_ASSET_BASE

/** Tesseract appends `/<lang>.traineddata.gz`, matching `public/ocr`. */
const OCR_LANG_PATH = OCR_ASSET_BASE

export type OcrStage =
  | 'preparing'
  | 'engine'
  | 'language'
  | 'recognizing'

export interface OcrProgress {
  stage: OcrStage
  /** Overall completion from 0 to 1, already weighted across phases. */
  progress: number
  label: string
}

export interface OcrOutput {
  text: string
  /** Tesseract confidence, 0-100. Null when the engine did not report one. */
  confidence: number | null
}

export const OCR_LANGUAGE = 'eng'

/**
 * Business cards are sparse blocks of text in no fixed reading order, and the
 * parser is content-driven rather than order-driven, so auto page segmentation
 * is the safest default. Plain `SINGLE_BLOCK` was tried and merges columns onto
 * shared lines, which corrupts email and phone detection.
 */
const OCR_PAGE_SEGMENTATION = Tesseract.PSM.AUTO

/** Card photos are usually well above 300 DPI once downscaled to OCR size. */
const OCR_USER_DEFINED_DPI = '300'

/** Keeps the gaps between columns, which helps the parser see column breaks. */
const OCR_PRESERVE_SPACES = '1'

const ENGINE_PROGRESS_END = 0.35
const LANGUAGE_PROGRESS_END = 0.6

interface StatusDescriptor {
  stage: OcrStage
  label: string
  start: number
  end: number
}

function describeStatus(status: string): StatusDescriptor {
  const normalized = status.toLowerCase()

  if (normalized.includes('recognizing')) {
    return {
      stage: 'recognizing',
      label: 'Reading text from the card',
      start: LANGUAGE_PROGRESS_END,
      end: 1,
    }
  }

  if (normalized.includes('language')) {
    return {
      stage: 'language',
      label: 'Loading the English language model',
      start: ENGINE_PROGRESS_END,
      end: LANGUAGE_PROGRESS_END,
    }
  }

  return {
    stage: 'engine',
    label: 'Starting the text recognition engine',
    start: 0,
    end: ENGINE_PROGRESS_END,
  }
}

let workerPromise: Promise<Tesseract.Worker> | null = null

/**
 * The worker is created once and reused. Its logger is fixed at creation time,
 * so progress is routed through this mutable bridge instead.
 */
let activeLogger: ((progress: OcrProgress) => void) | null = null

async function createOcrWorker(): Promise<Tesseract.Worker> {
  const worker = await Tesseract.createWorker(
    OCR_LANGUAGE,
    Tesseract.OEM.LSTM_ONLY,
    {
      // Self-hosted so a cached app can recognise text with no network at all.
      workerPath: OCR_WORKER_PATH,
      corePath: OCR_CORE_PATH,
      langPath: OCR_LANG_PATH,
      logger: (message: Tesseract.LoggerMessage) => {
        if (activeLogger === null) return

        const descriptor = describeStatus(message.status)
        const span = descriptor.end - descriptor.start
        const ratio = Math.min(1, Math.max(0, message.progress))

        activeLogger({
          stage: descriptor.stage,
          progress: descriptor.start + span * ratio,
          label: descriptor.label,
        })
      },
    },
  )

  await worker.setParameters({
    tessedit_pageseg_mode: OCR_PAGE_SEGMENTATION,
    user_defined_dpi: OCR_USER_DEFINED_DPI,
    preserve_interword_spaces: OCR_PRESERVE_SPACES,
  })

  return worker
}

function getWorker(): Promise<Tesseract.Worker> {
  if (workerPromise === null) {
    workerPromise = createOcrWorker().catch((error: unknown) => {
      // Let the next attempt retry from scratch.
      workerPromise = null
      throw error
    })
  }

  return workerPromise
}

/** Releases the worker. Mainly useful for tests and for freeing memory. */
export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise

  workerPromise = null
  activeLogger = null

  if (pending === null) return

  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // Nothing to clean up if the worker never finished starting.
  }
}

/**
 * Turns engine failures into something a person can act on. The original error
 * is kept on `cause` for debugging but is never shown as-is.
 */
function describeOcrFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('load timeout')
  ) {
    return new Error(
      'The text recognition engine is not on this device yet. Open Settings and use "Prepare for offline use" while online, then try again.',
      { cause: error },
    )
  }

  if (lower.includes('out of memory') || lower.includes('abort')) {
    return new Error(
      'This image was too large to process. Try a smaller photo, or close other tabs and retry.',
      { cause: error },
    )
  }

  if (lower.includes('tesseractcore') || lower.includes('wasm')) {
    return new Error(
      'This browser could not start the text recognition engine.',
      { cause: error },
    )
  }

  return new Error(
    'The card could not be read. Please try another photo.',
    { cause: error },
  )
}

export async function runOcr(
  image: HTMLCanvasElement,
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrOutput> {
  // Tesseract re-emits engine statuses as it initialises each WASM component,
  // so raw progress jumps backwards. The bar must never do that.
  let highWaterMark = 0

  const report = (next: OcrProgress): void => {
    highWaterMark = Math.max(highWaterMark, next.progress)
    onProgress(
      highWaterMark === next.progress
        ? next
        : { ...next, progress: highWaterMark },
    )
  }

  activeLogger = report

  report({ stage: 'preparing', progress: 0, label: 'Preparing the image' })

  try {
    const worker = await getWorker()
    const result = await worker.recognize(image)
    const confidence =
      typeof result.data.confidence === 'number' &&
      Number.isFinite(result.data.confidence)
        ? result.data.confidence
        : null

    return { text: result.data.text ?? '', confidence }
  } catch (error) {
    throw describeOcrFailure(error)
  } finally {
    activeLogger = null
  }
}
