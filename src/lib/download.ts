/**
 * Browser download helper.
 *
 * Shared by every export format so the temporary-object-URL lifecycle is defined
 * exactly once, in one place, instead of being copied per format.
 */

import { truncateToCodePoints } from './text'

/**
 * Hands a blob to the browser and reports what actually happened.
 *
 * The result is awaited rather than assumed. `navigator.canShare` answers "is
 * this payload shareable", not "will the share succeed": desktop Chrome reports
 * true and then rejects with NotAllowedError, because building the workbook is
 * asynchronous and the user gesture has already gone by the time the bytes
 * exist. Assuming success up front made every desktop export claim "Shared ...
 * save it to Files" while a plain download had actually happened, and made a
 * dismissed share sheet report success while saving nothing at all.
 *
 * The URL is always revoked, including if the click throws, so a failed export
 * cannot leak blobs for the lifetime of the page. Revocation is deferred rather
 * than immediate: revoking in the same task as the click cancels the download
 * outright in some browsers, and a short zero-delay timeout has bitten older
 * Safari with large blobs, so the URL is kept alive afterwards.
 */
export async function downloadBlob(
  fileName: string,
  blob: Blob,
): Promise<ExportDelivery> {
  const file = shareableFile(fileName, blob)

  if (file === null) {
    anchorDownload(fileName, blob)
    return 'downloaded'
  }

  /*
   * iOS Safari ignores `download` on a blob URL for these MIME types -- the tab
   * navigates to the blob and the user gets raw vCard text or a preview instead
   * of a file -- while the app still reported success. The share sheet is the
   * only reliable way to get a file into Files or another app on iOS, so it is
   * preferred wherever it is available. It is called before the first await in
   * this function, so it still runs in the same task as the caller's click.
   */
  try {
    await navigator.share({ files: [file], title: fileName })
    return 'shared'
  } catch (error) {
    // The user closing the share sheet is a choice, not a failure. It is also
    // not a delivery: nothing was saved, so it is reported as its own outcome
    // rather than quietly downloading a file they did not ask for.
    if (isAbortError(error)) return 'cancelled'

    // Anything else -- most often "no user activation" once an async export has
    // taken too long -- still deserves a file, and the anchor path needs no
    // permission.
    anchorDownload(fileName, blob)
    return 'downloaded'
  }
}

/**
 * How the file was actually handed over.
 *
 * The UI has to say which one happened: "downloaded" is wrong on iOS, where the
 * share sheet is what put the file anywhere. "cancelled" is separate from both
 * because a dismissed share sheet produces no file, and telling the user it was
 * saved would be the exact lie this type exists to prevent.
 */
export type ExportDelivery = 'downloaded' | 'shared' | 'cancelled'

/**
 * Builds a file for the share sheet, or returns null when sharing files is not
 * supported.
 *
 * The type is deliberately `application/octet-stream`. That is the documented
 * workaround for the WebKit behaviour where the share sheet declines a `.vcf`
 * or an `.xlsx` served with its real MIME type; the file name still carries the
 * extension, so the receiving app identifies it correctly.
 */
function shareableFile(fileName: string, blob: Blob): File | null {
  if (typeof navigator === 'undefined') return null
  if (typeof navigator.share !== 'function') return null
  if (typeof navigator.canShare !== 'function') return null
  if (typeof File !== 'function') return null

  const file = new File([blob], fileName, { type: 'application/octet-stream' })

  try {
    return navigator.canShare({ files: [file] }) === true ? file : null
  } catch {
    // Some engines throw rather than returning false for an unsupported payload.
    return null
  }
}

/** True when a rejection is the user closing the share sheet. */
function isAbortError(error: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  )
}

/** The ordinary anchor-with-blob-URL download. */
function anchorDownload(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'

  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()

    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, REVOKE_DELAY_MS)
  }
}

/**
 * How long a temporary download URL is kept before being revoked.
 *
 * The download is started synchronously by the click, so the only requirement is
 * that revocation happens in a *later* task -- doing it in the same task cancels
 * the download outright in some browsers. Half a second is comfortably past that
 * point while keeping the blob alive for no longer than necessary, which matters
 * because a large workbook can be tens of megabytes.
 */
const REVOKE_DELAY_MS = 500

/** Blob type for vCard files. */
export const VCF_MIME_TYPE = 'text/vcard;charset=utf-8'

/** Blob type for OOXML workbooks. */
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Builds a descriptive, filesystem-safe download filename.
 *
 * `CardVault-Contacts-2026-10-03.vcf` for the shape the app uses; the label is
 * sanitised and truncated so odd input can never produce a bad path.
 */
export function buildDownloadFileName(
  label: string,
  extension: string,
  stamp: Date,
): string {
  const safeLabel = truncateToCodePoints(
    label
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
    60,
  )

  const name = safeLabel === '' ? 'CardVault' : safeLabel

  return `${name}-${formatStamp(stamp)}.${extension}`
}

/** yyyy-mm-dd in local time, for stable, sortable filenames. */
export function formatStamp(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}