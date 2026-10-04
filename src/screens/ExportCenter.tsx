import { useCallback, useId, useMemo, useState } from 'react'
import { useScreenFocus } from '../hooks/useScreenFocus'
import { Callout } from '../components/Callout'
import {
  BuildingIcon,
  CheckIcon,
  ChevronLeftIcon,
  ContactsIcon,
  DownloadIcon,
  RefreshIcon,
} from '../components/Icon'
import type { Contact } from '../types/contact'
import { exportContactsToExcel, planSheetNames } from '../lib/export/exportContacts'
import { describeVcfExport, exportContactsToVcf } from '../lib/export/exportVcf'
import { groupContactsByCompany, NO_COMPANY_LABEL } from '../lib/db'
import './screens.css'
import './ExportCenter.css'

/**
 * Describes a finished Excel export.
 *
 * The wording depends on how the file was handed over. On iOS the share sheet
 * is what produces a file, so claiming a "download" there would be untrue and
 * would leave the user hunting for a file that is not in Downloads.
 */
function describeExcelExport(result: {
  fileName: string
  contactCount: number
  sheetCount: number
  delivery: 'downloaded' | 'shared' | 'cancelled'
}): string {
  const contacts = `${result.contactCount} ${
    result.contactCount === 1 ? 'contact' : 'contacts'
  }`
  const detail = `${contacts} across ${result.sheetCount} sheets`

  if (result.delivery === 'cancelled') {
    // Nothing was written, so do not imply the workbook exists anywhere.
    return `Export cancelled, so no workbook was written. Nothing was saved — select export again to try once more.`
  }

  return result.delivery === 'shared'
    ? `Shared ${detail} as ${result.fileName}. Save it to Files or another app to keep it.`
    : `${result.fileName} downloaded — ${detail}.`
}
import { asText } from '../lib/text'

type SelectionMode = 'contacts' | 'companies'

type ExportCenterProps = {
  /**
   * Whether this screen is the one currently on show. Screens stay mounted so
   * an in-progress scan survives a tab change, so the heading has to be
   * re-focused every time the panel becomes visible again.
   */
  active?: boolean

  /** Every saved contact, used for the pickers and the sheet preview. */
  contacts: Contact[]
  /**
   * Resolves the records to export. `null` means the whole vault; otherwise the
   * given ids are read back through the storage service.
   */
  onFetchForExport: (ids: string[] | null) => Promise<Contact[]>
  onBack: () => void
  onStartScan: () => void
}

type Outcome =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  // A dismissed share sheet is neither: no file was written, but nothing failed.
  | { kind: 'cancelled'; message: string }

type OutcomeKind = Outcome['kind']

const OUTCOME_TONE: Record<OutcomeKind, 'success' | 'error' | 'info'> = {
  success: 'success',
  error: 'error',
  cancelled: 'info',
}

const OUTCOME_TITLE: Record<OutcomeKind, string> = {
  // Success titles name the artefact ("Workbook exported", "Contact file
  // exported"), so they are supplied at the call site instead of here.
  success: 'Exported',
  error: 'Export failed',
  cancelled: 'Export cancelled',
}

export function ExportCenter({
  active = true,
  contacts,
  onFetchForExport,
  onBack,
  onStartScan,
}: ExportCenterProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>(active)
  const headingId = useId()
  const pickerId = useId()
  const previewId = useId()
  const vcfId = useId()

  /**
   * The single source of truth for what an export will contain. Selecting a
   * company writes its contact ids in here, so "Export selected" can never
   * disagree with what the sheet preview shows.
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [picker, setPicker] = useState<SelectionMode>('contacts')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  /**
   * Scope of the most recent attempt. Retry replays exactly this, so retrying a
   * failed "export all" never silently becomes an export of the selection (or
   * the other way round).
   */
  const [lastScope, setLastScope] = useState<'all' | 'selection' | null>(null)

  /**
   * vCard export keeps its own busy flag, outcome and retry scope.
   *
   * The two formats are independent downloads, so a finished or failed Excel
   * export must never clear the vCard status, and retrying one must never
   * replay the other. The selection itself is shared, because two competing
   * pickers for the same contacts would only confuse.
   */
  const [vcfBusy, setVcfBusy] = useState(false)
  const [vcfOutcome, setVcfOutcome] = useState<Outcome | null>(null)
  const [vcfLastScope, setVcfLastScope] = useState<'all' | 'selection' | null>(null)

  const hasContacts = contacts.length > 0

  /**
   * Company buckets, from the shared storage grouping so the labels here can
   * never drift from the sheets the workbook actually writes.
   */
  const companies = useMemo(
    () =>
      groupContactsByCompany(contacts).map((group) => ({
        name: group.catchAll ? NO_COMPANY_LABEL : group.key,
        members: group.contacts,
        catchAll: group.catchAll,
      })),
    [contacts],
  )

  const companyCount = companies.filter((group) => !group.catchAll).length

  /** The contacts the current selection actually resolves to. */
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id)),
    [contacts, selectedIds],
  )

  // Preview the exact workbook the selection produces, so the UI cannot claim
  // more (or less) than the file contains.
  const plan = useMemo(
    () =>
      selectedContacts.length === 0
        ? null
        : planSheetNames({ contacts: selectedContacts, isSelection: true }),
    [selectedContacts],
  )

  const setIds = useCallback((next: Set<string>) => {
    setSelectedIds(next)
    // A changed selection invalidates both formats' status messages, since
    // neither result describes the new selection.
    setOutcome(null)
    setVcfOutcome(null)
  }, [])

  const toggleContact = useCallback(
    (id: string) => {
      const next = new Set(selectedIds)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      setIds(next)
    },
    [selectedIds, setIds],
  )

  const toggleCompany = useCallback(
    (members: Contact[]) => {
      const next = new Set(selectedIds)
      const allSelected = members.every((contact) => next.has(contact.id))

      for (const contact of members) {
        if (allSelected) next.delete(contact.id)
        else next.add(contact.id)
      }

      setIds(next)
    },
    [selectedIds, setIds],
  )

  const selectAll = useCallback(() => {
    setIds(new Set(contacts.map((contact) => contact.id)))
  }, [contacts, setIds])

  const clearSelection = useCallback(() => {
    setIds(new Set())
  }, [setIds])

  const runExport = useCallback(
    async (scope: 'all' | 'selection') => {
      const ids = scope === 'selection' ? [...selectedIds] : null

      if (scope === 'selection' && ids !== null && ids.length === 0) {
        setOutcome({ kind: 'error', message: 'Choose at least one contact to export.' })

        return
      }

      setBusy(true)
      setLastScope(scope)
      setOutcome(null)

      try {
        // Re-read through the storage service so the file reflects what is
        // stored right now, not a stale list held in memory.
        const records = await onFetchForExport(ids)

        const result = await exportContactsToExcel({ contacts: records, scope })

        setOutcome({
          kind: result.delivery === 'cancelled' ? 'cancelled' : 'success',
          message: describeExcelExport(result),
        })
      } catch (error) {
        setOutcome({
          kind: 'error',
          message:
            error instanceof Error && error.message !== ''
              ? error.message
              : 'Something went wrong while building the workbook. Please try again.',
        })
      } finally {
        setBusy(false)
      }
    },
    [onFetchForExport, selectedIds],
  )

  /**
   * Runs a vCard export, reading the records back through the storage service
   * exactly like the Excel path so the file matches what is stored now.
   *
   * Generation is synchronous and local, so there is no lazy module to load and
   * no await beyond the fetch itself.
   */
  const runVcfExport = useCallback(
    async (scope: 'all' | 'selection') => {
      const ids = scope === 'selection' ? [...selectedIds] : null

      if (scope === 'selection' && ids !== null && ids.length === 0) {
        setVcfOutcome({
          kind: 'error',
          message: 'Choose at least one contact to export.',
        })

        return
      }

      setVcfBusy(true)
      setVcfLastScope(scope)
      setVcfOutcome(null)

      try {
        const records = await onFetchForExport(ids)
        const result = await exportContactsToVcf({ contacts: records, scope })

        setVcfOutcome({
          kind: result.delivery === 'cancelled' ? 'cancelled' : 'success',
          message: describeVcfExport(result, scope),
        })
      } catch (error) {
        setVcfOutcome({
          kind: 'error',
          message:
            error instanceof Error && error.message !== ''
              ? error.message
              : 'Something went wrong while building the contact file. Please try again.',
        })
      } finally {
        setVcfBusy(false)
      }
    },
    [onFetchForExport, selectedIds],
  )

  const selectionCount = selectedContacts.length

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={onBack}>
        <ChevronLeftIcon />
        Back to settings
      </button>

      <header>
        <h1 className="screen__heading" ref={headingRef} tabIndex={-1}>
          Export
        </h1>
        <p className="screen__lede">
          Build an Excel workbook or a vCard contact file from the cards saved on this
          device. Files are created in your browser; nothing is uploaded.
        </p>
      </header>

      {!hasContacts ? (
        <div className="empty-state">
          <span className="empty-state__badge" aria-hidden="true">
            <ContactsIcon />
          </span>
          <p className="empty-state__title">Nothing to export yet</p>
          <p className="empty-state__body">
            Scan a business card first. Saved contacts will show up here and can be
            exported as an Excel workbook or a vCard file.
          </p>
          <button type="button" className="button-primary" onClick={onStartScan}>
            Scan a card
          </button>
        </div>
      ) : (
        <>
          <section className="panel" aria-labelledby={headingId}>
            <h2 className="section-title" id={headingId}>
              Export centre
              <span className="section-title__meta">{contacts.length} saved</span>
            </h2>

            <dl className="detail-list">
              <div className="detail-list__row">
                <dt className="detail-list__term">Total saved contacts</dt>
                <dd className="detail-list__value">{contacts.length}</dd>
              </div>
              <div className="detail-list__row">
                <dt className="detail-list__term">Total companies</dt>
                <dd className="detail-list__value">{companyCount}</dd>
              </div>
            </dl>

            <div className="export-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => void runExport('all')}
                disabled={busy || vcfBusy}
              >
                {busy ? 'Preparing…' : 'Export all contacts as Excel'}
              </button>

              <div className="export-actions__row" role="group" aria-label="Choose what to select">
                <button
                  type="button"
                  className="button-secondary"
                  aria-pressed={picker === 'contacts'}
                  onClick={() => setPicker('contacts')}
                >
                  Select contacts
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  aria-pressed={picker === 'companies'}
                  onClick={() => setPicker('companies')}
                >
                  Select companies
                </button>
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby={pickerId}>
            <h2 className="section-title" id={pickerId}>
              {picker === 'contacts' ? 'Select contacts' : 'Select companies'}
              <span className="section-title__meta">
                {selectionCount} of {contacts.length} selected
              </span>
            </h2>

            <div className="export-actions__row">
              <button type="button" className="button-secondary" onClick={selectAll}>
                Select all
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={clearSelection}
                disabled={selectionCount === 0}
              >
                Deselect all
              </button>
            </div>

            {picker === 'contacts' ? (
              <ul className="selection-list" aria-labelledby={pickerId} tabIndex={0}>
                {contacts.map((contact) => {
                  const checked = selectedIds.has(contact.id)
                  const companyName = asText(contact.fields.company).trim()
                  const company =
                    companyName === '' ? NO_COMPANY_LABEL : companyName

                  return (
                    <li key={contact.id}>
                      <label className="picker__row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleContact(contact.id)}
                        />
                        <span className="picker__text">
                          <span className="picker__name">
                            {asText(contact.fields.fullName).trim() === ''
                              ? 'Unnamed contact'
                              : contact.fields.fullName}
                          </span>
                          <span className="picker__meta">{company}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <ul className="selection-list">
                {companies.map((group) => {
                  const allChecked = group.members.every((contact) =>
                    selectedIds.has(contact.id),
                  )
                  const someChecked = group.members.some((contact) =>
                    selectedIds.has(contact.id),
                  )

                  return (
                    <li key={group.name}>
                      <label className="picker__row">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(node) => {
                            if (node !== null) node.indeterminate = someChecked && !allChecked
                          }}
                          onChange={() => toggleCompany(group.members)}
                        />
                        <span className="picker__text">
                          <span className="picker__name">
                            <BuildingIcon />
                            {group.name}
                          </span>
                          <span className="picker__meta">
                            {group.members.length}{' '}
                            {group.members.length === 1 ? 'contact' : 'contacts'}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="export-actions__row">
              <button
                type="button"
                className="button-primary"
                onClick={() => void runExport('selection')}
                disabled={busy || vcfBusy || selectionCount === 0}
              >
                {busy ? 'Preparing…' : 'Export selected as Excel'}
              </button>
            </div>

            {selectionCount === 0 ? (
              <p className="note">
                Nothing selected yet. Use the buttons above, or export everything at
                once.
              </p>
            ) : (
              <div className="note">
                <p>
                  <strong>
                    {selectionCount} of {contacts.length}
                  </strong>{' '}
                  {selectionCount === 1 ? 'contact' : 'contacts'} will be exported. This
                  selection is shared with the vCard export below.
                </p>
              </div>
            )}
          </section>

          {plan !== null && (
            <section className="panel" aria-labelledby={previewId}>
              <h2 className="section-title" id={previewId}>
                Workbook contents
                <span className="section-title__meta">{plan.companies.length + 2} sheets</span>
              </h2>
              <p className="note">
                These are the sheets and rows the current selection will produce.
              </p>
              <ul className="sheet-preview">
                <li className="sheet-preview__row">
                  <span className="sheet-preview__name">{plan.detailSheet}</span>
                  <span className="sheet-preview__count">
                    {selectedContacts.length} rows
                  </span>
                </li>
                <li className="sheet-preview__row">
                  <span className="sheet-preview__name">{plan.summarySheet}</span>
                  <span className="sheet-preview__count">{plan.companies.length} rows</span>
                </li>
                {plan.companies.map((sheet) => (
                  <li key={sheet.groupKey} className="sheet-preview__row">
                    <span className="sheet-preview__name">
                      {sheet.sheetName}
                      {sheet.isCatchAll && (
                        <span className="sheet-preview__badge">no company</span>
                      )}
                    </span>
                    <span className="sheet-preview__count">{sheet.contactCount} rows</span>
                  </li>
                ))}
              </ul>
              {plan.renamed.length > 0 && (
                <Callout tone="info" title="Worksheet names adjusted for Excel">
                  <p>
                    Excel does not allow{' '}
                    <code>: \ / ? * [ ]</code> in sheet names and limits them to 31
                    characters, so {plan.renamed.length}{' '}
                    {plan.renamed.length === 1 ? 'name was' : 'names were'} shortened.
                  </p>
                  <ul className="sheet-preview__renames">
                    {plan.renamed.map((entry) => (
                      <li key={entry.sheetName}>
                        <code>{entry.source}</code> → <code>{entry.sheetName}</code>
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
            </section>
          )}

          {outcome !== null && (
            <Callout
              tone={OUTCOME_TONE[outcome.kind]}
              title={
                outcome.kind === 'success'
                  ? 'Workbook exported'
                  : OUTCOME_TITLE[outcome.kind]
              }
              live
            >
              <p>{outcome.message}</p>
              {outcome.kind === 'error' && lastScope !== null && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void runExport(lastScope)}
                  disabled={busy}
                >
                  <RefreshIcon />
                  Try again
                </button>
              )}
            </Callout>
          )}

          <section className="panel" aria-labelledby={vcfId}>
            <h2 className="section-title" id={vcfId}>
              Contact file (vCard)
              <span className="section-title__meta">.vcf</span>
            </h2>

            <p className="note">
              A vCard file is the standard contact format. Open it on your phone or
              computer to add the saved cards to your address book. On iOS, open the
              file from <em>Files</em> and choose the address book to add it to.
            </p>

            <div className="export-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => void runVcfExport('all')}
                disabled={vcfBusy || busy}
              >
                <DownloadIcon />
                {vcfBusy ? 'Preparing…' : 'Export all as VCF'}
              </button>

              <div className="export-actions__row">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void runVcfExport('selection')}
                  disabled={vcfBusy || busy || selectionCount === 0}
                >
                  <DownloadIcon />
                  {selectionCount === 0
                    ? 'Export selected as VCF'
                    : `Export ${selectionCount} selected as VCF`}
                </button>
              </div>
            </div>

            {selectionCount === 0 ? (
              <p className="note">
                Select contacts above to export only some of them as a contact file.
              </p>
            ) : (
              <p className="note">
                Exports the same <strong>{selectionCount}</strong>{' '}
                {selectionCount === 1 ? 'contact' : 'contacts'} currently selected above.
              </p>
            )}

            {vcfOutcome !== null && (
              <Callout
                tone={OUTCOME_TONE[vcfOutcome.kind]}
                title={
                  vcfOutcome.kind === 'success'
                    ? 'Contact file exported'
                    : OUTCOME_TITLE[vcfOutcome.kind]
                }
                live
              >
                <p>{vcfOutcome.message}</p>
                {vcfOutcome.kind === 'error' && vcfLastScope !== null && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void runVcfExport(vcfLastScope)}
                    disabled={vcfBusy}
                  >
                    <RefreshIcon />
                    Try again
                  </button>
                )}
              </Callout>
            )}
          </section>

          <Callout tone="info" title="Where your data goes">
            <p>
              Both the workbook and the contact file are generated on this device and
              saved straight to your downloads. Contacts are only read while
              exporting; nothing is changed or deleted.
            </p>
          </Callout>

          <p className="export-footnote">
            <CheckIcon /> Works offline once the app has loaded.
          </p>
        </>
      )}
    </div>
  )
}