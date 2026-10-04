import type { Contact } from '../../types/contact'
import { downloadBlob } from '../download'
import type { ExportDelivery } from '../download'
import { assertColumnsMatchModel } from './columns'
import { buildFileName } from './sheetNames'
import { buildWorkbook, planSheetNames } from './workbook'
import type { ExcelJsModule, SheetPlan } from './workbook'

/**
 * Excel export pipeline.
 *
 * Everything runs in the browser: contacts already in memory are turned into a
 * workbook and handed to the user as a file. Nothing is uploaded, and no
 * contact is created, changed or deleted along the way.
 *
 * ExcelJS is large, so it is fetched on demand the first time an export runs
 * instead of being bundled into the initial page load.
 */

let cachedExcelJs: ExcelJsModule | null = null

/**
 * Loads ExcelJS once and caches the module.
 *
 * The specifier is a plain string literal so the bundler can code-split it into
 * its own chunk. Depending on how the interop resolves, the namespace is either
 * the module itself or carries it under `default`.
 */
export async function loadExcelJs(): Promise<ExcelJsModule> {
  if (cachedExcelJs !== null) return cachedExcelJs

  const imported: unknown = await import('exceljs')
  const module = asExcelJsModule(imported)

  if (module === null) {
    throw new ExportError('The Excel library could not be loaded.')
  }

  cachedExcelJs = module

  return module
}

/** Narrows the unknown namespace to a usable ExcelJS module, or null. */
function asExcelJsModule(value: unknown): ExcelJsModule | null {
  if (typeof value !== 'object' || value === null) return null

  const namespace = value as { Workbook?: unknown; default?: unknown }

  if (typeof namespace.Workbook === 'function') {
    return { Workbook: namespace.Workbook as ExcelJsModule['Workbook'] }
  }

  // Interop sometimes puts the whole module under `default`.
  const fallback = asExcelJsModule(namespace.default)

  return fallback
}

export type ExportScope = 'all' | 'selection'

export interface ExportResult {
  fileName: string
  contactCount: number
  /**
   * How the file reached the user. `shared` means the share sheet was used.
   * Building a workbook is slow enough that the click's user activation may
   * have lapsed, in which case the anchor fallback runs instead and this is
   * `downloaded`.
   */
  delivery: ExportDelivery
  sheetCount: number
  plan: SheetPlan
  byteLength: number
}

export class ExportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExportError'
  }
}

export interface ExportOptions {
  /** The contacts to export. Read only; never mutated. */
  contacts: Contact[]
  scope: ExportScope
  fileName?: string
  /** Injectable so the download path can be asserted without a real browser. */
  triggerDownload?: (
    fileName: string,
    blob: Blob,
  ) => ExportDelivery | void | Promise<ExportDelivery | void>
  now?: Date
  loadModule?: () => Promise<ExcelJsModule>
}

/**
 * Builds the workbook and hands it to the browser as a download.
 */
export async function exportContactsToExcel({
  contacts,
  scope,
  fileName,
  triggerDownload = downloadBlob,
  now = new Date(),
  loadModule = loadExcelJs,
}: ExportOptions): Promise<ExportResult> {
  // Exporting nothing is a no-op rather than a workbook of empty sheets.
  if (contacts.length === 0) {
    throw new ExportError('There are no contacts to export.')
  }

  const isSelection = scope === 'selection'

  // Pre-flight: if a Contact field was added without a matching column, the
  // spreadsheet would silently omit it. Fail loudly instead.
  const drift = assertColumnsMatchModel()

  if (drift !== null) {
    throw new ExportError(`Export is out of date: ${drift}`)
  }

  try {
    const ExcelJS = await loadModule()

    const workbook = buildWorkbook(ExcelJS, { contacts, isSelection, createdAt: now })

    // ExcelJS writes a real OOXML package, so this is a genuine .xlsx rather
    // than a renamed CSV.
    const buffer = await serialiseWorkbook(workbook)
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const finalName =
      fileName ?? buildFileName(now, isSelection ? 'selection' : 'contacts')

    // Awaited so a caller-supplied synchronous mock still works and a real
    // share sheet is allowed to finish before the outcome is reported.
    const delivery = (await triggerDownload(finalName, blob)) ?? 'downloaded'

    return {
      fileName: finalName,
      contactCount: contacts.length,
      delivery,
      sheetCount: workbook.worksheets.length,
      plan: planSheetNames({ contacts, isSelection }),
      byteLength: blob.size,
    }
  } catch (error) {
    if (error instanceof ExportError) throw error

    // Keep the underlying reason, since it is usually the only useful clue.
    throw new ExportError(
      error instanceof Error && error.message !== ''
        ? `The workbook could not be built: ${error.message}`
        : 'The workbook could not be built. Please try again.',
      { cause: error },
    )
  }
}

/**
 * Serialises the workbook to an ArrayBuffer.
 *
 * ExcelJS exposes different writers depending on the host build, so try each in
 * turn and report the first failure if none work.
 */
async function serialiseWorkbook(workbook: {
  writeBuffer?: (options?: unknown) => Promise<ArrayBuffer>
  xlsx?: {
    writeBuffer?: (options?: unknown) => Promise<ArrayBuffer>
    write?: (options?: unknown) => Promise<ArrayBuffer>
  }
}): Promise<ArrayBuffer> {
  const errors: unknown[] = []
  const attempts: (() => Promise<ArrayBuffer>)[] = []

  // ExcelJS 4.x exposes the writer on `workbook.xlsx`; the top-level
  // `writeBuffer` only exists on some versions. Both are probed before use
  // rather than called through a non-null assertion, because on 4.x the
  // top-level method does not exist at all and calling it unconditionally threw
  // a TypeError on every export before a later attempt quietly succeeded --
  // which also meant the options below were being thrown away.
  if (typeof workbook.xlsx?.writeBuffer === 'function') {
    attempts.push(() =>
      workbook.xlsx!.writeBuffer!({ useStyles: true, useSharedStrings: true }),
    )
  }

  if (typeof workbook.writeBuffer === 'function') {
    attempts.push(() => workbook.writeBuffer!({ useStyles: true, useSharedStrings: true }))
  }

  if (typeof workbook.xlsx?.write === 'function') {
    attempts.push(() => workbook.xlsx!.write!())
  }

  for (const attempt of attempts) {
    try {
      const buffer = await attempt()
      if (buffer) return buffer
    } catch (error) {
      errors.push(error)
    }
  }

  throw new ExportError('The workbook could not be saved.', {
    cause: errors[0],
  })
}

export { planSheetNames } from './workbook'
export { downloadBlob } from '../download'