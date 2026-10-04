import type { ChangeEvent } from 'react'
import { useId, useRef } from 'react'
import { CameraIcon, UploadIcon } from './Icon'
import { IMAGE_ACCEPT_ATTRIBUTE } from '../lib/image'
import './ImageSourcePicker.css'

type ImageSourcePickerProps = {
  onSelect: (file: File, origin: 'camera' | 'upload') => void
  disabled?: boolean
  /** Small hint under the buttons, e.g. the accepted formats. */
  hint?: string
}

/**
 * Two separate inputs rather than one.
 *
 * `capture="environment"` on iOS Safari opens the rear camera directly; the
 * plain input is the fallback for desktop and for the photo library. Keeping
 * them apart also means the metadata records which route the user took.
 */
export function ImageSourcePicker({
  onSelect,
  disabled = false,
  hint,
}: ImageSourcePickerProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()

  const handleChange = (
    event: ChangeEvent<HTMLInputElement>,
    origin: 'camera' | 'upload',
  ) => {
    const file = event.target.files?.[0]

    // Reset first so choosing the same file twice still fires a change event.
    event.target.value = ''

    if (file === undefined) return

    onSelect(file, origin)
  }

  return (
    <div className="picker">
      <div className="picker__actions">
        <button
          type="button"
          className="button-primary"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
          aria-describedby={hint !== undefined ? hintId : undefined}
        >
          <CameraIcon />
          Take a photo
        </button>

        <button
          type="button"
          className="button-secondary"
          onClick={() => uploadInputRef.current?.click()}
          disabled={disabled}
          aria-describedby={hint !== undefined ? hintId : undefined}
        >
          <UploadIcon />
          Choose an image
        </button>
      </div>

      {hint !== undefined && (
        <p className="picker__hint" id={hintId}>
          {hint}
        </p>
      )}

      <input
        ref={cameraInputRef}
        aria-label="Take a photo of a business card"
        className="picker__input"
        type="file"
        accept={IMAGE_ACCEPT_ATTRIBUTE}
        capture="environment"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleChange(event, 'camera')}
      />

      <input
        ref={uploadInputRef}
        className="picker__input"
        type="file"
        accept={IMAGE_ACCEPT_ATTRIBUTE}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleChange(event, 'upload')}
      />
    </div>
  )
}
