import type { Contact } from '../../types/contact'
import {
  buildDownloadFileName,
  downloadBlob,
  VCF_MIME_TYPE,
} from '../download'
import type { ExportDelivery } from '../download'
import { contactsToVcf, VCardError } from './vcard'

/**
 * vCard download orchestration.
 *
 * Deliberately kept apart from `exportContacts.ts` so the two formats share no
 * state, no lazy ExcelJS chunk and no error handling. The only code in common is
 * the generic `downloadBlob` helper.
 */

export type VcfExportScope = 'all' | 'selection'

export interface VcfExportResult {
  fileName: string
  /** Number of contacts written to the file. */
  count: number
  byteLength: number
  /**
   * How the file reached the user. `shared` means the share sheet was used,
   * which on iOS is the only thing that produces a real file; the UI has to say
   * so rather than claiming a download.
   */
  delivery: ExportDelivery
}

export interface VcfExportOptions {
  contacts: readonly Contact[]
  scope: VcfExportScope
  /**
   * Filename label. Defaults to the bulk-export name; the detail screen passes a
   * single contact's name so the file is recognisable in a downloads list.
   */
  label?: string
  now?: Date
  triggerDownload?: (
    fileName: string,
    blob: Blob,
  ) => ExportDelivery | void | Promise<ExportDelivery | void>
}

export type { VCardError }

const DEFAULT_LABEL = 'CardVault-Contacts'

/**
 * Builds the `.vcf` file for a set of contacts and hands it to the browser.
 *
 * The document is generated entirely in memory. Nothing is uploaded, and the
 * contacts passed in are never mutated.
 */
/*
 * Async because the delivery outcome is now awaited rather than assumed: the
 * share sheet has to finish before the caller can honestly say whether the file
 * was saved. Building the document itself is still synchronous.
 */
export async function exportContactsToVcf({
  contacts,
  scope,
  label = DEFAULT_LABEL,
  now = new Date(),
  triggerDownload = downloadBlob,
}: VcfExportOptions): Promise<VcfExportResult> {
  if (contacts.length === 0) {
    throw new VCardError(
      scope === 'selection'
        ? 'Select at least one contact to export.'
        : 'There are no contacts to export.',
    )
  }

  const document = contactsToVcf(contacts)
  const fileName = buildDownloadFileName(label, 'vcf', now)
  const blob = new Blob([document], { type: VCF_MIME_TYPE })

  // A test double may return nothing, which means the ordinary download path.
  // Awaited so a caller-supplied synchronous mock still works and a real share
  // sheet is allowed to finish before the outcome is reported.
  const delivery = (await triggerDownload(fileName, blob)) ?? 'downloaded'

  return { fileName, count: contacts.length, byteLength: blob.size, delivery }
}

/** Human-readable summary for the success message. */
export function describeVcfExport(result: VcfExportResult, scope: VcfExportScope): string {
  const contacts = `${result.count} ${result.count === 1 ? 'contact' : 'contacts'}`

  if (result.delivery === 'cancelled') {
    return 'Export cancelled, so nothing was saved. Select export again to try once more.'
  }

  if (result.delivery === 'shared') {
    const picked = scope === 'selection' ? contacts : `all ${contacts}`

    return `Shared ${picked} as ${result.fileName}. Save it to Files or another app to keep it.`
  }

  // Say the file was downloaded, not merely exported: "Exported ..." reads the
  // same whether the share sheet took it or the browser saved it, which is
  // exactly the ambiguity ExportDelivery exists to remove.
  return scope === 'selection'
    ? `Exported ${contacts} as ${result.fileName}, downloaded.`
    : `Exported all ${contacts} as ${result.fileName}, downloaded.`
}