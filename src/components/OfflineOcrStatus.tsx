import { useCallback, useEffect, useState } from 'react'
import {
  OCR_PREPARE_SIZE_LABEL,
  getOcrAssetStatus,
  prepareOcrAssets,
} from '../lib/ocrAssets'
import type { OcrAssetStatus } from '../lib/ocrAssets'

/**
 * Reports whether text recognition will work without a connection, and offers
 * a way to make that true deliberately.
 *
 * The status is read from the service worker's cache rather than guessed, so
 * the label is only "Ready" when the files really are on the device. The
 * prepare button is real: it downloads the files and the worker stores them.
 */

const STATUS_TEXT: Record<OcrAssetStatus['state'], string> = {
  ready: 'Ready — works offline',
  partial: 'Partly stored',
  missing: 'Not stored yet',
  unsupported: 'Not available in this browser',
}

export function OfflineOcrStatus() {
  const [status, setStatus] = useState<OcrAssetStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Files downloaded so far, so a ~15MB wait is not silent. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // Re-checked on mount because a scan in another tab may have stored them.
  useEffect(() => {
    let cancelled = false

    void getOcrAssetStatus().then((next) => {
      if (!cancelled) setStatus(next)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const handlePrepare = useCallback(async () => {
    setBusy(true)
    setError(null)
    setProgress(null)

    try {
      // The progress callback was never passed, so this download announced
      // nothing at all while it ran.
      setStatus(await prepareOcrAssets((done, total) => setProgress({ done, total })))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The text recognition files could not be downloaded.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <>
      <dl className="detail-list">
        <div className="detail-list__row">
          <dt className="detail-list__term">Offline text recognition</dt>
          <dd className="detail-list__value" role="status">
            {status === null ? 'Checking…' : STATUS_TEXT[status.state]}
          </dd>
        </div>
      </dl>

      {busy && progress !== null && (
        <p className="note" role="status">
          Downloaded {progress.done} of {progress.total} recognition files…
        </p>
      )}

      {status === null ? (
        <p className="note">Checking what is stored on this device…</p>
      ) : status.state === 'ready' ? (
        <p className="note">
          The recognition files are stored on this device, so scanning works with
          no connection.
        </p>
      ) : (
        <>
          <p className="note">
            Scanning a card needs a recognition engine and an English language
            model, about {OCR_PREPARE_SIZE_LABEL} together. They are downloaded the
            first time you scan, so that the app itself opens instantly.
          </p>
          <div className="export-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void handlePrepare()}
              disabled={busy || status?.state === 'unsupported'}
            >
              {busy ? 'Preparing…' : 'Prepare for offline use'}
            </button>
          </div>
          {status?.state === 'unsupported' && (
            <p className="note">
              This browser does not store files for offline use. Scans will still
              work, but only while connected.
            </p>
          )}
        </>
      )}

      {error !== null && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}