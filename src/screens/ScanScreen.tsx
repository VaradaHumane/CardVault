import { useCallback, useEffect, useRef, useState } from 'react'
import { useScreenFocus } from '../hooks/useScreenFocus'
import { Callout } from '../components/Callout'
import { ImageSourcePicker } from '../components/ImageSourcePicker'
import { ProgressBar } from '../components/ProgressBar'
import { CameraIcon, CheckIcon, ImageIcon, ScanIcon } from '../components/Icon'
import { useOcr } from '../hooks/useOcr'
import {
  buildOcrMeta,
  buildSourceImageMeta,
  createContact,
  isUnreadableImage,
} from '../lib/contact'
import {
  describePrepareFailure,
  formatBytes,
  getImageFileError,
  inferImageOrigin,
  prepareImageForOcr,
} from '../lib/image'
import { parseContactText } from '../lib/parseContact'
import type { ParsedContact } from '../lib/parseContact'
import { ReviewScreen } from './ReviewScreen'
import type { Contact, ContactFields, ImageOrigin } from '../types/contact'
import './screens.css'
import './ScanScreen.css'
import { asText } from '../lib/text'

type Stage = 'idle' | 'preview' | 'processing' | 'review' | 'saved'

/**
 * One heading per stage, so the screen never shows two competing h1s and the
 * page title always matches what the user is actually doing.
 */
const STAGE_COPY: Record<Stage, { heading: string; lede: string }> = {
  idle: {
    heading: 'Scan',
    lede: 'Photograph or upload a business card. Text is recognised on this device.',
  },
  preview: {
    heading: 'Scan',
    lede: 'Check the image looks sharp and readable, then read the text.',
  },
  processing: {
    heading: 'Reading card',
    lede: 'Recognising the text on this device. This usually takes a few seconds.',
  },
  review: {
    heading: 'Review',
    lede: 'Check the details and correct anything the text recognition got wrong. Fields it could not read are left blank.',
  },
  saved: {
    heading: 'Saved',
    lede: 'The contact has been added to your vault on this device.',
  },
}

interface SelectedImage {
  file: File
  origin: ImageOrigin
  previewUrl: string
  meta: ReturnType<typeof buildSourceImageMeta>
}

type ScanScreenProps = {
  /**
   * Whether this screen is the one currently on show. Screens stay mounted so
   * an in-progress scan survives a tab change, so the heading has to be
   * re-focused every time the panel becomes visible again.
   */
  active?: boolean

  /**
   * Writes the contact to storage. Resolves with null on success, or with a
   * message to show the user when the write failed.
   */
  onSaveContact: (contact: Contact) => Promise<string | null>
  onViewContacts: () => void
}

/**
 * Capture flow: pick an image, confirm it, run OCR, then review the fields.
 * The stage is the single source of truth for what the user sees.
 */
export function ScanScreen({
  active = true,
  onSaveContact,
  onViewContacts,
}: ScanScreenProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [parsed, setParsed] = useState<ParsedContact | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedName, setSavedName] = useState('')
  const [scanId, setScanId] = useState(0)

  const ocr = useOcr()
  const previewUrlRef = useRef<string | null>(null)

  /**
   * Synchronous counterpart to `isSaving`.
   *
   * React state is not updated until the next render, so three clicks in the
   * same tick would all see `isSaving === false` and all write. A ref flips
   * immediately, which is what actually stops the duplicate.
   */
  const savingRef = useRef(false)

  /**
   * Identity for this scan, allocated on the first save attempt and reused by
   * any retry. Combined with `store.add` this means a repeated save can only
   * fail, never insert a second copy.
   */
  const pendingIdRef = useRef<string | null>(null)

  const replacePreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current !== null) {
      URL.revokeObjectURL(previewUrlRef.current)
    }

    previewUrlRef.current = url
  }, [])

  // Object URLs are not garbage collected on their own.
  useEffect(() => replacePreviewUrl(null), [replacePreviewUrl])

  const reset = useCallback(() => {
    replacePreviewUrl(null)
    setImage(null)
    setParsed(null)
    setFileError(null)
    setSaveError(null)
    setIsSaving(false)
    setSavedName('')
    pendingIdRef.current = null
    ocr.reset()
    setStage('idle')
    setScanId((id) => id + 1)
  }, [ocr, replacePreviewUrl])

  const handleSelectImage = useCallback(
    (file: File, requestedOrigin: ImageOrigin) => {
      const error = getImageFileError(file)

      if (error !== null) {
        setFileError(error)
        return
      }

      setFileError(null)

      const previewUrl = URL.createObjectURL(file)
      replacePreviewUrl(previewUrl)

      setImage({
        file,
        origin: inferImageOrigin(file, requestedOrigin),
        previewUrl,
        meta: buildSourceImageMeta(file, requestedOrigin, null),
      })
      setParsed(null)
      setSaveError(null)
      pendingIdRef.current = null
      ocr.reset()
      setStage('preview')
    },
    [ocr, replacePreviewUrl],
  )

  const handleStartOcr = useCallback(async () => {
    if (image === null) return

    setStage('processing')

    let prepared

    try {
      prepared = await prepareImageForOcr(image.file)
    } catch (error) {
      setFileError(describePrepareFailure(error))
      setStage('preview')
      return
    }

    // Record the real pixel sizes now that the image has been decoded.
    setImage((current) =>
      current === null
        ? current
        : {
            ...current,
            meta: buildSourceImageMeta(current.file, current.origin, prepared),
          },
    )

    const result = await ocr.start(prepared.canvas)

    if (result === null) {
      setStage('preview')
      return
    }

    setParsed(parseContactText(result.text))
    setStage('review')
  }, [image, ocr])

  /**
   * Writes the reviewed fields.
   *
   * A failed write keeps the user on the review screen with their corrections
   * intact rather than pretending the contact was saved.
   */
  const handleSave = useCallback(
    async (fields: ContactFields) => {
      if (image === null || savingRef.current) return

      savingRef.current = true
      setIsSaving(true)
      setSaveError(null)

      const contact = createContact({
        id: pendingIdRef.current ?? undefined,
        fields,
        ocr: buildOcrMeta(
          ocr.output?.text ?? '',
          ocr.output?.confidence ?? null,
        ),
        sourceImage: image.meta,
      })

      pendingIdRef.current = contact.id

      const error = await onSaveContact(contact)

      savingRef.current = false
      setIsSaving(false)

      if (error !== null) {
        setSaveError(error)
        return
      }

      setSavedName(
        asText(fields.fullName).trim() !== ''
          ? asText(fields.fullName).trim()
          : asText(fields.company).trim() !== ''
            ? asText(fields.company).trim()
            : 'The contact',
      )
      setStage('saved')
    },
    [image, ocr.output, onSaveContact],
  )

  const unreadable = isUnreadableImage(
    ocr.output?.text ?? '',
    ocr.output?.confidence ?? null,
  )

  const copy = STAGE_COPY[stage]

  const headingRef = useScreenFocus<HTMLHeadingElement>(active)

  /**
   * Every stage change replaces the controls the user just activated, so focus
   * would otherwise drop to `<body>` mid-scan. This is what tells a screen
   * reader user that recognition has started and, later, that it finished --
   * the heading text carries the stage name.
   */
  useEffect(() => {
    headingRef.current?.focus()
  }, [stage, active, headingRef])


  return (
    <div className="screen">
      <header>
        <h1 className="screen__heading" ref={headingRef} tabIndex={-1}>
          {copy.heading}
        </h1>
        <p className="screen__lede">{copy.lede}</p>
      </header>

      {fileError !== null && (
        <Callout tone="error" title="That image cannot be used" live>
          {fileError}
        </Callout>
      )}

      {ocr.status === 'error' && ocr.error !== null && (
        <Callout tone="error" title="Text recognition failed" live>
          {ocr.error}
        </Callout>
      )}

      {saveError !== null && stage === 'review' && (
        <Callout tone="error" title="This contact was not saved" live>
          <p>{saveError}</p>
          <p>Your corrections are still here, so you can try saving again.</p>
        </Callout>
      )}

      {stage === 'idle' && (
        <section className="panel" aria-labelledby="scan-start-heading">
          <h2 className="section-title" id="scan-start-heading">
            Add a card
          </h2>

          <div className="empty-state">
            <span className="empty-state__badge" aria-hidden="true">
              <ImageIcon />
            </span>
            <p className="empty-state__title">Choose a business card image</p>
            <p className="empty-state__body">
              Fill the frame with the card, keep it flat and well lit, and avoid
              shadows and glare.
            </p>
          </div>

          <ImageSourcePicker
            onSelect={handleSelectImage}
            hint="JPG, PNG or WebP, up to 20 MB. Nothing is uploaded."
          />
        </section>
      )}

      {stage === 'preview' && image !== null && (
        <section className="panel" aria-labelledby="scan-preview-heading">
          <h2 className="section-title" id="scan-preview-heading">
            Card image
          </h2>

          <figure className="card-preview">
            <img
              className="card-preview__image"
              src={image.previewUrl}
              alt="The business card you selected, ready to be read"
            />
            <figcaption className="card-preview__caption">
              {image.file.name} · {formatBytes(image.file.size)}
            </figcaption>
          </figure>

          <div className="scan-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void handleStartOcr()}
            >
              <ScanIcon />
              Read text from card
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={reset}
            >
              Choose another image
            </button>
          </div>
        </section>
      )}

      {stage === 'processing' && (
        <section className="panel" aria-labelledby="scan-progress-heading">
          <h2 className="section-title" id="scan-progress-heading">
            Reading the card
          </h2>

          <div className="scan-progress">
            <ProgressBar
              value={ocr.progress?.progress ?? 0}
              label={ocr.progress?.label ?? 'Preparing the image'}
            />
            <p className="scan-progress__note">
              The first scan downloads the recognition engine. Later scans reuse
              it and can run offline.
            </p>
          </div>
        </section>
      )}

      {stage === 'review' && parsed !== null && (
        <ReviewScreen
          key={scanId}
          imageUrl={image?.previewUrl ?? null}
          ocrText={ocr.output?.text ?? ''}
          ocrConfidence={ocr.output?.confidence ?? null}
          unreadable={unreadable}
          diagnostics={parsed.diagnostics}
          initialFields={parsed.fields}
          isSaving={isSaving}
          onRetake={reset}
          onSave={(fields) => void handleSave(fields)}
        />
      )}

      {stage === 'saved' && (
        // `status` so the confirmation is spoken. Saving is the single most
        // important outcome of the whole flow and it was previously silent.
        <section
          className="panel"
          aria-labelledby="scan-saved-heading"
          role="status"
          aria-live="polite"
        >
          <h2 className="section-title" id="scan-saved-heading">
            Next steps
          </h2>

          <div className="empty-state">
            <span className="empty-state__badge" aria-hidden="true">
              <CheckIcon />
            </span>
            <p className="empty-state__title">Contact saved</p>
            <p className="empty-state__body">
              {savedName} is now stored on this device and will still be here
                after a refresh.
            </p>
          </div>

          <div className="scan-actions">
            <button type="button" className="button-primary" onClick={reset}>
              <CameraIcon />
              Scan another card
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={onViewContacts}
            >
              View contacts
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
