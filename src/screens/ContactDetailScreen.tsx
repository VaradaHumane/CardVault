import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Callout } from '../components/Callout'
import { FormField } from '../components/FormField'
import {
  BuildingIcon,
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  PencilIcon,
  PinIcon,
  TrashIcon,
} from '../components/Icon'
import { formatDateTime, formatRelativeSave, toSingleLine } from '../lib/format'
import { exportContactsToVcf } from '../lib/export/exportVcf'
import { formatBytes } from '../lib/image'
import {
  CONTACT_FIELD_DEFS,
  CONTACT_FIELD_GROUPS,
  contactDisplayName,
  hasBlockingIssue,
  validateContactFields,
} from '../types/contact'
import type {
  Contact,
  ContactFieldDef,
  ContactFields,
  ContactIssue,
} from '../types/contact'
import './screens.css'
import './ContactDetailScreen.css'
import { asText } from '../lib/text'

type ContactDetailScreenProps = {
  /**
   * Whether this screen is the one currently on show. Screens stay mounted so
   * an in-progress scan survives a tab change, so the heading has to be
   * re-focused every time the panel becomes visible again.
   */
  active?: boolean

  contact: Contact
  onBack: () => void
  onSave: (fields: ContactFields) => Promise<string | null>
  onDelete: () => Promise<string | null>
}

export function ContactDetailScreen({
  active = true,
  contact,
  onBack,
  onSave,
  onDelete,
}: ContactDetailScreenProps) {
  /**
   * Modal-ish screen state. Remounting the component on `contact.id` is what
   * resets it, which App already guarantees via `key`, so no reset effect is
   * needed here.
   */
  const [isEditing, setIsEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  /**
   * vCard export status.
   *
   * Kept apart from `notice` and `actionError` so a download confirmation can
   * never be mistaken for an unsaved edit, and so an edit failure does not
   * read as an export failure.
   */
  const [vcfStatus, setVcfStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  )

  const headingRef = useRef<HTMLHeadingElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)

  /**
   * Keeps focus in a sensible place across every state change on this screen.
   *
   * Each of these transitions unmounts the control that was activated, so focus
   * would otherwise land back on `<body>` and the next Tab press would restart
   * from the top of the document. When the editor closes -- by saving or by
   * cancelling -- focus returns to the Edit button that opened it.
   */
  useEffect(() => {
    if (isEditing) {
      headingRef.current?.focus()
    } else if (wasEditing.current) {
      editButtonRef.current?.focus()
    }

    wasEditing.current = isEditing
  }, [isEditing])

  useEffect(() => {
    if (active) headingRef.current?.focus()
  }, [active])

  /**
   * Opens the delete confirmation.
   *
   * The Delete button is replaced by the confirmation rather than hidden, so
   * focusing Cancel on the next frame is what stops focus falling to `<body>`
   * and sending the next Tab press back to the top of the page. The effect is
   * used rather than focusing inline because the confirmation is not in the DOM
   * yet at the point of the click.
   */
  const openDeleteConfirm = useCallback(() => {
    setActionError(null)
    setConfirmingDelete(true)
  }, [])

  const cancelDelete = useCallback(() => {
    setConfirmingDelete(false)
    setActionError(null)
    deleteButtonRef.current?.focus()
  }, [])

  // Escape must always be able to back out of a destructive confirmation.
  useEffect(() => {
    if (!confirmingDelete) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setConfirmingDelete(false)
      setActionError(null)
      deleteButtonRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmingDelete])

  useEffect(() => {
    if (confirmingDelete) cancelDeleteRef.current?.focus()
  }, [confirmingDelete])

  const name = contactDisplayName(contact.fields)
  const title = name === '' ? 'Unnamed contact' : name

  const groupedFields = useMemo(
    () =>
      CONTACT_FIELD_GROUPS.map((group) => ({
        group,
        defs: CONTACT_FIELD_DEFS.filter(
          (def) =>
            def.group === group.id && asText(contact.fields[def.key]).trim() !== '',
        ),
      })).filter((entry) => entry.defs.length > 0),
    [contact.fields],
  )

  const rawText = contact.ocr.rawText.trim()

  const handleSave = async (fields: ContactFields) => {
    setIsBusy(true)
    setActionError(null)

    const error = await onSave(fields)

    setIsBusy(false)

    if (error !== null) {
      setActionError(error)
      return
    }

    setIsEditing(false)
    setNotice('Changes saved.')
  }

  const handleDelete = async () => {
    setIsBusy(true)
    setActionError(null)

    const error = await onDelete()

    setIsBusy(false)

    if (error !== null) {
      setActionError(error)
      return
    }

    // A successful delete navigates away, so there is nothing left to reset.
  }

  /**
   * Downloads this contact as a vCard file.
   *
   * Generation is local and synchronous, so this cannot leave the screen
   * half-finished; it still routes through the same error handling as the other
   * actions in case a future change makes it fail.
   */
  // Async because the delivery outcome is awaited: the share sheet has to settle
  // before the message can say whether a file was actually saved.
  const handleVcfExport = async () => {
    setVcfStatus(null)

    try {
      const result = await exportContactsToVcf({ contacts: [contact], scope: 'all', label: name })

      setVcfStatus({
        kind: 'success',
        message:
          result.delivery === 'cancelled'
            ? 'Export cancelled, so nothing was saved. Select export again to try once more.'
            : result.delivery === 'shared'
              ? `Shared as ${result.fileName}. Save it to Files or another app to keep it.`
              : `${result.fileName} downloaded.`,
      })
    } catch (error) {
      setVcfStatus({
        kind: 'error',
        message:
          error instanceof Error && error.message !== ''
            ? error.message
            : 'The contact file could not be created. Please try again.',
      })
    }
  }

  return (
    <div className="screen">
      <button
        type="button"
        className="back-link"
        onClick={onBack}
        disabled={isBusy}
      >
        <ChevronLeftIcon />
        All contacts
      </button>

      <header>
        <h1 className="screen__heading" ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p className="screen__lede">{formatRelativeSave(contact.createdAt, contact.updatedAt)}</p>
      </header>

      {actionError !== null && (
        <Callout tone="error" title="That change was not saved" live>
          {actionError}
        </Callout>
      )}

      {notice !== null && !isEditing && (
        <Callout tone="success" title={notice} live>
          <p>The contact list and this page both show the stored version.</p>
        </Callout>
      )}

      {vcfStatus !== null && (
        <Callout
          tone={vcfStatus.kind === 'success' ? 'success' : 'error'}
          title={
            vcfStatus.kind === 'success' ? 'Contact file exported' : 'Export failed'
          }
          live
        >
          <p>{vcfStatus.message}</p>
          {vcfStatus.kind === 'success' && (
            <p>
              Open the file to add this contact to your address book. On iOS, open
              the file from <em>Files</em>.
            </p>
          )}
        </Callout>
      )}

      {isEditing ? (
        <ContactEditor
          key={`${contact.id}:${contact.updatedAt}`}
          contact={contact}
          isBusy={isBusy}
          onCancel={() => {
            setIsEditing(false)
            setActionError(null)
          }}
          onSave={handleSave}
        />
      ) : (
        <>
          {groupedFields.length === 0 ? (
            <Callout tone="warning" title="This contact has no details">
              <p>
                The card could not be read and nothing was typed in. You can add
                the details now.
              </p>
            </Callout>
          ) : (
            groupedFields.map(({ group, defs }) => (
              <section className="panel" key={group.id} aria-labelledby={`detail-${group.id}`}>
                <h2
                  className="section-title"
                  id={`detail-${group.id}`}
                >
                  {group.title}
                </h2>

                <dl className="detail-fields">
                  {defs.map((def) => {
                    const icon = fieldIcon(def)

                    return (
                      <div className="detail-fields__row" key={def.key}>
                        <dt className="detail-fields__term">
                          {icon !== null && (
                            <span className="detail-fields__icon" aria-hidden="true">
                              {icon}
                            </span>
                          )}
                          {def.label}
                        </dt>
                        <dd className="detail-fields__value">
                          <FieldValue def={def} value={contact.fields[def.key]} />
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </section>
            ))
          )}

          {rawText !== '' && (
            <details className="raw-text">
              <summary className="raw-text__summary">
                Text recognised from the card
                {contact.ocr.confidence !== null &&
                  ` · ${Math.round(contact.ocr.confidence)}% confidence`}
              </summary>
              <pre className="raw-text__body">{contact.ocr.rawText}</pre>
              {contact.ocr.processedAt !== '' && (
                <p className="raw-text__meta">
                  Recognised {formatDateTime(contact.ocr.processedAt)}
                </p>
              )}
            </details>
          )}

          {contact.sourceImage !== null && (
            <details className="raw-text">
              <summary className="raw-text__summary">Source card image</summary>
              <dl className="detail-list detail-list--tight">
                <div className="detail-list__row">
                  <dt className="detail-list__term">File</dt>
                  <dd className="detail-list__value">
                    {contact.sourceImage.fileName}
                  </dd>
                </div>
                <div className="detail-list__row">
                  <dt className="detail-list__term">Size</dt>
                  <dd className="detail-list__value">
                    {formatBytes(contact.sourceImage.sizeBytes)}
                  </dd>
                </div>
                {contact.sourceImage.width !== null &&
                  contact.sourceImage.height !== null && (
                    <div className="detail-list__row">
                      <dt className="detail-list__term">Dimensions</dt>
                      <dd className="detail-list__value">
                        {contact.sourceImage.width} × {contact.sourceImage.height}
                      </dd>
                    </div>
                  )}
                <div className="detail-list__row">
                  <dt className="detail-list__term">Captured</dt>
                  <dd className="detail-list__value">
                    {formatDateTime(contact.sourceImage.capturedAt)}
                  </dd>
                </div>
              </dl>
            </details>
          )}

          <div className="detail-actions">
            <button
              type="button"
              className="button-primary"
              ref={editButtonRef}
              onClick={() => {
                setActionError(null)
                setNotice(null)
                setIsEditing(true)
              }}
            >
              <PencilIcon />
              Edit contact
            </button>

            <button
              type="button"
              className="button-secondary"
              onClick={handleVcfExport}
              disabled={isBusy}
            >
              <DownloadIcon />
              Save as vCard
            </button>

            {confirmingDelete ? (
              /*
               * An inline confirmation, not a modal: nothing is obscured and the
               * rest of the page stays reachable. `role="group"` is deliberate
               * -- `alertdialog` promises modality, focus containment and an
               * inert background, none of which this provides.
               */
              <div
                className="confirm"
                role="group"
                aria-labelledby="confirm-delete-title"
              >
                <p className="confirm__title" id="confirm-delete-title">
                  Delete {title}?
                </p>
                <p className="confirm__body">
                  This removes the contact from this device. It cannot be undone.
                </p>
                <div className="confirm__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    ref={cancelDeleteRef}
                    onClick={cancelDelete}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => void handleDelete()}
                    disabled={isBusy}
                  >
                    <TrashIcon />
                    {isBusy ? 'Deleting…' : 'Delete contact'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button-secondary"
                ref={deleteButtonRef}
                onClick={openDeleteConfirm}
                disabled={isBusy}
              >
                <TrashIcon />
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function fieldIcon(def: ContactFieldDef) {
  if (def.group === 'work') return <BuildingIcon />
  if (def.group === 'location') return <PinIcon />

  return null
}

/**
 * Renders a field value with the right affordance: real `mailto:`/`tel:` links
 * and a readable web address, plain text otherwise.
 */
function FieldValue({ def, value }: { def: ContactFieldDef; value: string }) {
  const text = value.trim()

  if (text === '') return <span className="detail-fields__empty">Not set</span>

  if (def.type === 'email') {
    return (
      <a className="detail-fields__link" href={`mailto:${text}`}>
        {text}
      </a>
    )
  }

  if (def.type === 'tel') {
    return (
      <a className="detail-fields__link" href={`tel:${text.replace(/[^\d+]/g, '')}`}>
        {text}
      </a>
    )
  }

  if (def.type === 'url') {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`

    return (
      <a
        className="detail-fields__link"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {toSingleLine(text).replace(/^https?:\/\//, '')}
      </a>
    )
  }

  return <span className="detail-fields__text">{text}</span>
}

type ContactEditorProps = {
  contact: Contact
  isBusy: boolean
  onCancel: () => void
  onSave: (fields: ContactFields) => Promise<void>
}

/**
 * Editor for a saved contact.
 *
 * Remounted on `updatedAt` so a stored change re-seeds the form instead of
 * leaving stale input behind.
 */
function ContactEditor({ contact, isBusy, onCancel, onSave }: ContactEditorProps) {
  const [fields, setFields] = useState<ContactFields>(contact.fields)
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

    // `noValidate` removes the browser's own jump-to-first-error, so the summary
    // takes that job instead. It is focused rather than merely rendered.
    if (blocked) {
      queueMicrotask(() => summaryRef.current?.focus())
      return
    }

    void onSave(fields)
  }

  return (
    <form
      className="panel review-form"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isBusy}
    >
      <h2 className="section-title">Edit details</h2>
      <p className="section-note">
        The recognised text and the original card image details are kept as they
        were.
      </p>

      {CONTACT_FIELD_GROUPS.map((group) => {
        const defs = CONTACT_FIELD_DEFS.filter((def) => def.group === group.id)

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
        <button
          type="submit"
          className="button-primary"
          disabled={isBusy}
        >
          <CheckIcon />
          {isBusy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={onCancel}
          disabled={isBusy}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
