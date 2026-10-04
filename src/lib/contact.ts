import type {
  Contact,
  ContactFields,
  ImageOrigin,
  OcrMeta,
  SourceImageMeta,
} from '../types/contact'
import { createId } from './id'
import type { PreparedImage } from './image'

/** Below this the engine is essentially guessing, so the UI says so. */
export const LOW_CONFIDENCE_THRESHOLD = 45

export function isUnreadableImage(
  text: string,
  confidence: number | null,
): boolean {
  if (text.trim() === '') return true

  return confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD
}

export function buildSourceImageMeta(
  file: File,
  origin: ImageOrigin,
  prepared: PreparedImage | null,
): SourceImageMeta {
  return {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: prepared?.originalWidth ?? null,
    height: prepared?.originalHeight ?? null,
    ocrWidth: prepared?.width ?? null,
    ocrHeight: prepared?.height ?? null,
    origin,
    capturedAt: new Date().toISOString(),
  }
}

export function buildOcrMeta(
  rawText: string,
  confidence: number | null,
): OcrMeta {
  return {
    rawText,
    confidence,
    processedAt: new Date().toISOString(),
  }
}

/**
 * Builds a contact from reviewed fields.
 *
 * Timestamps are written once here. `updatedAt` only moves when a stored
 * contact is edited, which is why nothing else touches it.
 *
 * `id` can be supplied so a single scan keeps one identity even if the save is
 * attempted more than once. That way a repeat attempt collides on the primary
 * key instead of quietly storing the same person twice.
 */
export function createContact(input: {
  fields: ContactFields
  ocr: OcrMeta
  sourceImage: SourceImageMeta | null
  id?: string
}): Contact {
  const timestamp = new Date().toISOString()

  return {
    id: input.id ?? createId(),
    fields: input.fields,
    ocr: input.ocr,
    sourceImage: input.sourceImage,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
