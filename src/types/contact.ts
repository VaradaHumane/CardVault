/**
 * Contact domain model.
 *
 * The model is intentionally flat and string-only so that it maps directly onto
 * the storage and export targets:
 * - IndexedDB (`src/lib/db.ts`): one object store per concern.
 * - vCard export (`src/lib/export/vcard.ts`): every saved or selected contact
 *   is exported, with no filtering on which fields happen to be filled in.
 * - Excel export: `CONTACT_FIELD_DEFS` defines the column order.
 *
 * Contacts persist in IndexedDB for the life of the install; the strings stay
 * human-readable so they never depend on a serialisation format.
 */

import { asText } from '../lib/text'

export type ContactTextField =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'company'
  | 'designation'
  | 'department'
  | 'phone'
  | 'alternatePhone'
  | 'email'
  | 'website'
  | 'address'
  | 'city'
  | 'state'
  | 'country'
  | 'linkedin'
  | 'notes'

export type ContactFields = Record<ContactTextField, string>

export type ContactFieldGroup =
  | 'name'
  | 'work'
  | 'contact'
  | 'location'
  | 'other'

/** Where the card image came from. */
export type ImageOrigin = 'camera' | 'upload'

/**
 * Metadata about the image a contact was created from.
 *
 * Only metadata is kept. The image bytes are intentionally *not* stored on the
 * contact: keeping large blobs inline would make IndexedDB writes and Excel
 * exports heavy. Storing the blob separately (keyed by `contactId`) is a later
 * decision.
 */
export interface SourceImageMeta {
  fileName: string
  mimeType: string
  sizeBytes: number
  /** Intrinsic pixel size of the original file, when known. */
  width: number | null
  height: number | null
  /** Pixel size actually handed to the OCR engine after downscaling. */
  ocrWidth: number | null
  ocrHeight: number | null
  origin: ImageOrigin
  capturedAt: string
}

/** Verbatim OCR output, kept so the user can re-check what the card actually said. */
export interface OcrMeta {
  rawText: string
  /** Tesseract confidence 0-100, or null when unavailable. */
  confidence: number | null
  processedAt: string
}

export interface Contact {
  id: string
  fields: ContactFields
  ocr: OcrMeta
  sourceImage: SourceImageMeta | null
  /** ISO 8601 timestamps. */
  createdAt: string
  updatedAt: string
}

export interface ContactFieldDef {
  key: ContactTextField
  label: string
  group: ContactFieldGroup
  type: 'text' | 'email' | 'tel' | 'url'
  autoComplete: string
  placeholder: string
  /**
   * Virtual-keyboard hint. Needed separately from `type`, because `type="url"`
   * alone does not reliably produce the URL keyboard row on iOS.
   */
  inputMode?: 'text' | 'email' | 'tel' | 'url'
  /** Label for the keyboard's return key. */
  enterKeyHint?: 'next' | 'done' | 'go' | 'search' | 'send'
  /** Long fields get a textarea in the review form. */
  multiline?: boolean
}

/**
 * Single source of truth for field order, labels and input hints.
 * Adding a field here automatically adds it to the review form and to any
 * future spreadsheet export.
 */
export const CONTACT_FIELD_DEFS: readonly ContactFieldDef[] = [
  {
    key: 'firstName',
    label: 'First name',
    group: 'name',
    type: 'text',
    autoComplete: 'given-name',
    placeholder: 'First name',
  },
  {
    key: 'lastName',
    label: 'Last name',
    group: 'name',
    type: 'text',
    autoComplete: 'family-name',
    placeholder: 'Last name',
  },
  {
    key: 'fullName',
    label: 'Full name',
    group: 'name',
    type: 'text',
    autoComplete: 'name',
    placeholder: 'Full name',
  },
  {
    key: 'company',
    label: 'Company',
    group: 'work',
    type: 'text',
    autoComplete: 'organization',
    placeholder: 'Company',
  },
  {
    key: 'designation',
    label: 'Designation',
    group: 'work',
    type: 'text',
    autoComplete: 'organization-title',
    placeholder: 'Job title',
  },
  {
    key: 'department',
    label: 'Department',
    group: 'work',
    type: 'text',
    autoComplete: 'organization-title',
    placeholder: 'Department',
  },
  {
    key: 'phone',
    label: 'Phone',
    group: 'contact',
    type: 'tel',
    autoComplete: 'tel',
    placeholder: 'Primary phone',
  },
  {
    key: 'alternatePhone',
    label: 'Alternate phone',
    group: 'contact',
    type: 'tel',
    autoComplete: 'tel',
    placeholder: 'Mobile, office or fax',
  },
  {
    key: 'email',
    label: 'Email',
    group: 'contact',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'name@example.com',
  },
  {
    key: 'website',
    label: 'Website',
    group: 'contact',
    type: 'url',
    // `inputMode="url"` is the only reliable way to get the `/` and `.com`
    // shortcut row on iOS; `type="url"` alone is inconsistent across versions.
    inputMode: 'url',
    autoComplete: 'url',
    enterKeyHint: 'next',
    placeholder: 'www.example.com',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    group: 'contact',
    type: 'url',
    inputMode: 'url',
    autoComplete: 'off',
    enterKeyHint: 'next',
    placeholder: 'linkedin.com/in/name',
  },
  {
    key: 'address',
    label: 'Address',
    group: 'location',
    type: 'text',
    autoComplete: 'street-address',
    placeholder: 'Street address',
    multiline: true,
  },
  {
    key: 'city',
    label: 'City',
    group: 'location',
    type: 'text',
    autoComplete: 'address-level2',
    placeholder: 'City',
  },
  {
    key: 'state',
    label: 'State',
    group: 'location',
    type: 'text',
    autoComplete: 'address-level1',
    placeholder: 'State or region',
  },
  {
    key: 'country',
    label: 'Country',
    group: 'location',
    type: 'text',
    autoComplete: 'address-country',
    placeholder: 'Country',
  },
  {
    key: 'notes',
    label: 'Notes',
    group: 'other',
    type: 'text',
    autoComplete: 'off',
    placeholder: 'Anything else from the card',
    multiline: true,
  },
] as const

export const CONTACT_FIELD_GROUPS: readonly {
  id: ContactFieldGroup
  title: string
}[] = [
  { id: 'name', title: 'Name' },
  { id: 'work', title: 'Work' },
  { id: 'contact', title: 'Contact details' },
  { id: 'location', title: 'Location' },
  { id: 'other', title: 'Other' },
] as const

export function emptyContactFields(): ContactFields {
  const fields = {} as ContactFields

  for (const def of CONTACT_FIELD_DEFS) {
    fields[def.key] = ''
  }

  return fields
}

export type ContactIssueSeverity = 'error' | 'warning'

export interface ContactIssue {
  field: ContactTextField | 'general'
  severity: ContactIssueSeverity
  message: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MIN_PHONE_DIGITS = 7
const MIN_PHONE_DIGITS_ALT = 10

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length
}

/**
 * Validates user-edited fields. Only blocks saving on problems that would make
 * the contact unusable; everything else is surfaced as a warning so the user
 * keeps control of their own corrections.
 */
export function validateContactFields(fields: ContactFields): ContactIssue[] {
  const issues: ContactIssue[] = []

  const email = asText(fields?.email)

  if (email !== '' && !EMAIL_PATTERN.test(email.trim())) {
    issues.push({
      field: 'email',
      severity: 'error',
      message: 'This does not look like a valid email address.',
    })
  }

  for (const key of ['phone', 'alternatePhone'] as const) {
    const digits = digitCount(fields[key])

    if (fields[key] !== '' && digits > 0 && digits < MIN_PHONE_DIGITS) {
      issues.push({
        field: key,
        severity: 'error',
        message: 'This looks too short to be a phone number.',
      })
    } else if (
      key === 'alternatePhone' &&
      fields[key] !== '' &&
      digits < MIN_PHONE_DIGITS_ALT
    ) {
      issues.push({
        field: key,
        severity: 'warning',
        message: 'Some digits may be missing from this number.',
      })
    }
  }

  for (const key of ['website', 'linkedin'] as const) {
    if (/\s/.test(fields[key])) {
      issues.push({
        field: key,
        severity: 'error',
        message: 'Remove the spaces from this link.',
      })
    }
  }

  const hasSomethingUseful =
    fields.fullName !== '' ||
    fields.company !== '' ||
    fields.email !== '' ||
    fields.phone !== ''

  if (!hasSomethingUseful) {
    issues.push({
      field: 'general',
      severity: 'error',
      message:
        'Add at least a name, company, email address or phone number before saving.',
    })
  }

  return issues
}

export function hasBlockingIssue(issues: ContactIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

/** Best available label for a contact, used in lists. */
export function contactDisplayName(fields: ContactFields): string {
  // `asText` because a corrupted or older record can hold a non-string here, and
  // this label is read on every list row, so a throw would blank the whole list.
  const explicit = asText(fields?.fullName).trim()

  if (explicit !== '') return explicit

  const joined = [fields?.firstName, fields?.lastName]
    .map((part) => asText(part).trim())
    .filter((part) => part !== '')
    .join(' ')

  return joined !== '' ? joined : asText(fields?.company).trim()
}

/*
 * `asText` is not optional here. These two read fields directly, and every other
 * accessor in the app was hardened against a stored value that is missing or the
 * wrong type -- but these two were missed. A record written before a field
 * existed therefore threw `Cannot read properties of undefined (reading 'trim')`
 * while rendering the contact list, which took down the whole Dashboard rather
 * than just this row.
 */
export function contactDisplayRole(fields: ContactFields): string {
  return [asText(fields.designation), asText(fields.department)]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ')
}

export function contactDisplayDetail(fields: ContactFields): string {
  return [asText(fields.email), asText(fields.phone)]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ')
}
