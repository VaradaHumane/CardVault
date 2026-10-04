import { useMemo, useRef, useState } from 'react'
import { Callout } from '../components/Callout'
import { FormField } from '../components/FormField'
import { CheckIcon, RefreshIcon } from '../components/Icon'
import { CONTACT_FIELD_DEFS, CONTACT_FIELD_GROUPS } from '../types/contact'
import type {
  ContactFieldDef,
  ContactFields,
  ContactIssue,
} from '../types/contact'
import { hasBlockingIssue, validateContactFields } from '../types/contact'
import './screens.css'
import './ReviewScreen.css'
import { asText } from '../lib/text'

type ReviewScreenProps = {
  imageUrl: string | null
  ocrText: string
  ocrConfidence: number | null
  /** True when the engine read almost nothing, so the form starts empty. */
  unreadable: boolean
  diagnostics: string[]
  initialFields: ContactFields
  /** Disables the submit button while the contact is being written to storage. */
  isSaving: boolean
  onRetake: () => void
  onSave: (fields: ContactFields) => void
}

export function ReviewScreen({
  imageUrl,
  ocrText,
  ocrConfidence,
  unreadable,
  diagnostics,
  initialFields,
  isSaving,
  onRetake,
  onSave,
}: ReviewScreenProps) {
  const [fields, setFields] = useState<ContactFields>(initialFields)
  const [submitted, setSubmitted] = useState(false)

  const issues = useMemo(() => validateContactFields(fields), [fields])
  const blocked = hasBlockingIssue(issues)

  const issuesByField = useMemo(() => {
    const grouped = new Map<string, ContactIssue[]>()

    for (const issue of issues) {
      if (issue.field === 'general') continue

      const existing = grouped.get(issue.field)

      if (existing === undefined) grouped.set(issue.field, [issue])
      else existing.push(issue)
    }

    return grouped
  }, [issues])

  const generalIssues = issues.filter((issue) => issue.field === 'general')

  const handleChange = (def: ContactFieldDef, value: string) => {
    setFields((current) => ({ ...current, [def.key]: value }))
  }

  const summaryRef = useRef<HTMLDivElement>(null)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)

    if (blocked) {
      // The summary is not in the DOM until this render commits, so the focus
      // has to wait for it.
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }

    onSave(fields)
  }

  const fillCount = CONTACT_FIELD_DEFS.filter(
    (def) => asText(fields[def.key]).trim() !== '',
  ).length

  return (
    <div className="screen">
      {unreadable && (
        <Callout tone="warning" title="Very little text was recognised">
          <p>
            Try another photo: fill the frame with the card, hold the camera
            steady, use even light and avoid shadows. You can also fill the form
            in by hand.
          </p>
        </Callout>
      )}

      {!unreadable && ocrConfidence !== null && (
        <Callout
          tone={ocrConfidence < 70 ? 'warning' : 'info'}
          title={`Text recognition confidence: ${Math.round(ocrConfidence)}%`}
        >
          <p>
            Recognition is never exact. Treat every value as a suggestion and
            check it against the card.
          </p>
        </Callout>
      )}

      {!unreadable && diagnostics.length > 0 && (
        <Callout tone="info" title="Nothing was detected for these">
          <ul>
            {diagnostics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Callout>
      )}

      {imageUrl !== null && (
        <figure className="card-preview card-preview--compact">
          <img
            className="card-preview__image"
            src={imageUrl}
            alt="The business card these details were read from"
          />
          <figcaption className="card-preview__caption">
            Source image · {fillCount} of {CONTACT_FIELD_DEFS.length} fields
            filled
          </figcaption>
        </figure>
      )}

      <form
        className="panel review-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSaving}
      >
        {CONTACT_FIELD_GROUPS.map((group) => {
          const defs = CONTACT_FIELD_DEFS.filter(
            (def) => def.group === group.id,
          )

          if (defs.length === 0) return null

          return (
            <fieldset className="review-group" key={group.id}>
              <legend className="review-group__legend">{group.title}</legend>

              <div className="review-group__fields">
                {defs.map((def) => (
                  <FormField
                    key={def.key}
                    def={def}
                    value={fields[def.key]}
                    onChange={(value) => handleChange(def, value)}
                    issues={issuesByField.get(def.key) ?? []}
                    submitted={submitted}
                  />
                ))}
              </div>
            </fieldset>
          )
        })}

        {/*
          `noValidate` turns off the browser's own "jump to the first invalid
          field" behaviour, so the summary has to take that job: it is focused
          on a failed submit, which puts the user at the top of the form with
          the reasons read out, rather than leaving focus on the submit button
          they just pressed.
        */}
        {submitted && blocked && (
          <div ref={summaryRef} tabIndex={-1}>
            <Callout tone="error" title="Fix these before saving" live>
              <ul>
                {generalIssues.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}

        <div className="review-actions">
          <button type="submit" className="button-primary" disabled={isSaving}>
            <CheckIcon />
            {isSaving ? 'Saving…' : 'Save contact'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onRetake}
            disabled={isSaving}
          >
            <RefreshIcon />
            Retake / another image
          </button>
        </div>
      </form>

      {ocrText.trim() !== '' && (
        <details className="raw-text">
          <summary className="raw-text__summary">Raw recognised text</summary>
          <pre className="raw-text__body">{ocrText}</pre>
        </details>
      )}

      <p className="note">
        <span>
          Saved in this browser on this device. Clearing site data, or opening
          CardVault in a different browser, will not show these contacts.
        </span>
      </p>
    </div>
  )
}
