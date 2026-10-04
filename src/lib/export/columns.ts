import type { Contact, ContactTextField } from '../../types/contact'
import { CONTACT_FIELD_DEFS } from '../../types/contact'

/**
 * The Excel column layout.
 *
 * Headings and column order are written out explicitly rather than derived from
 * the model, because they are part of the exported contract: a heading such as
 * "LinkedIn" must not be re-cased into "Linked In", and Address has to precede
 * LinkedIn regardless of how the model happens to order its fields.
 *
 * Drift is still caught. `EXPORT_HEADINGS` is typed as a total record over
 * `ContactTextField`, so adding a field to the Contact model without adding a
 * heading here fails to compile, and `assertColumnsMatchModel` re-checks the
 * same thing at runtime.
 */

/** Column order for the exported workbook. */
const EXPORT_FIELD_ORDER = [
  'firstName',
  'lastName',
  'fullName',
  'company',
  'designation',
  'department',
  'phone',
  'alternatePhone',
  'email',
  'website',
  'address',
  'city',
  'state',
  'country',
  'linkedin',
  'notes',
] as const satisfies readonly ContactTextField[]

/**
 * Human-readable heading for every Contact field.
 *
 * The total `Record` type is what guarantees a new model field cannot be added
 * without deciding how it appears in the spreadsheet.
 */
const EXPORT_HEADINGS = {
  firstName: 'First Name',
  lastName: 'Last Name',
  fullName: 'Full Name',
  company: 'Company',
  designation: 'Designation',
  department: 'Department',
  phone: 'Phone',
  alternatePhone: 'Alternate Phone',
  email: 'Email',
  website: 'Website',
  address: 'Address',
  city: 'City',
  state: 'State',
  country: 'Country',
  linkedin: 'LinkedIn',
  notes: 'Notes',
} as const satisfies Record<ContactTextField, string>

export type ExcelColumnKind = 'text' | 'id' | 'datetime'

export interface ExcelColumn {
  /** Heading shown in the header row. */
  heading: string
  kind: ExcelColumnKind
  /** Present for columns backed by a Contact field. */
  field?: ContactTextField
  /** Fixed width in Excel character units. */
  width: number
}

/** Widths chosen per column so nothing important is truncated or over-wide. */
const FIELD_WIDTHS: Record<ContactTextField, number> = {
  firstName: 14,
  lastName: 16,
  fullName: 24,
  company: 28,
  designation: 22,
  department: 20,
  phone: 20,
  alternatePhone: 20,
  email: 32,
  website: 30,
  address: 34,
  city: 16,
  state: 18,
  country: 18,
  linkedin: 34,
  notes: 34,
}

export const EXCEL_COLUMNS: readonly ExcelColumn[] = [
  { heading: 'Contact ID', kind: 'id', width: 38 },
  ...EXPORT_FIELD_ORDER.map<ExcelColumn>((field) => ({
    heading: EXPORT_HEADINGS[field],
    kind: 'text',
    field,
    width: FIELD_WIDTHS[field],
  })),
  { heading: 'Date Scanned', kind: 'datetime', width: 20 },
  { heading: 'Last Updated', kind: 'datetime', width: 20 },
]

/**
 * Verifies the export layout still matches the Contact model.
 *
 * Returns the reason on failure so a mismatch is reported clearly instead of
 * silently dropping a column.
 */
export function assertColumnsMatchModel(): string | null {
  const modelFields = CONTACT_FIELD_DEFS.map((def) => def.key).sort()
  const exported = EXPORT_FIELD_ORDER.slice().sort()

  const missing = modelFields.filter((field) => !exported.includes(field))
  const extra = exported.filter((field) => !modelFields.includes(field as ContactTextField))

  if (missing.length > 0) return `Contact field(s) missing from the export: ${missing.join(', ')}`
  if (extra.length > 0) return `Export column(s) with no Contact field: ${extra.join(', ')}`

  const duplicated = EXPORT_FIELD_ORDER.filter(
    (field, index) => EXPORT_FIELD_ORDER.indexOf(field) !== index,
  )
  if (duplicated.length > 0) return `Duplicate export columns: ${duplicated.join(', ')}`

  return null
}

/**
 * Reads a text field defensively.
 *
 * Records written by an older build could be missing a key entirely, so every
 * read goes through here and never assumes the field is present or a string.
 */
export function fieldValue(contact: Contact, field: ContactTextField): string {
  const value = contact.fields[field]

  return typeof value === 'string' ? value : ''
}

/** One Excel cell value. `null` means "leave the cell empty". */
export type ExcelCellValue = string | number | Date | null

/**
 * Builds the row for a contact.
 *
 * Missing values become `null`, which ExcelJS writes as a genuinely empty cell
 * rather than an empty string. Nothing is invented: if the OCR never read a
 * field, the cell stays blank.
 *
 * Values are written through verbatim, including any that begin with `=`, `+`,
 * `-` or `@`. Prefixing those with an apostrophe is the usual CSV-injection
 * defence, but it is wrong here and visibly corrupts real data: international
 * phone numbers begin with `+`, so `+91 98765 43210` would be stored as
 * `'+91 98765 43210`. It is also unnecessary. ExcelJS writes a plain string as
 * a string cell rather than a formula, so Excel does not re-interpret the
 * content on open -- verified by round-tripping `=1+1` through ExcelJS and
 * reading back a string. That risk is specific to CSV, which this app does not
 * export. If a CSV export is ever added, the guard belongs there and nowhere
 * else.
 */
export function toExcelRow(contact: Contact): ExcelCellValue[] {
  return EXCEL_COLUMNS.map((column) => {
    if (column.kind === 'id') return contact.id

    if (column.kind === 'datetime') {
      return parseTimestamp(
        column.heading === 'Date Scanned' ? contact.createdAt : contact.updatedAt,
      )
    }

    const value = fieldValue(contact, column.field as ContactTextField)

    return value === '' ? null : value
  })
}

/**
 * Parses an ISO timestamp into a real Excel date so Excel can sort and filter
 * it as a date. Returns null when the stored value is unusable, which leaves
 * the cell blank instead of writing `Invalid Date`.
 */
function parseTimestamp(iso: string): Date | null {
  if (typeof iso !== 'string' || iso === '') return null

  const parsed = new Date(iso)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const HEADER_ROW_HEIGHT = 22

/** Single date format used for every generated date cell. */
export const DATE_FORMAT = 'yyyy-mm-dd hh:mm'

/**
 * Columns that must never be interpreted as numbers.
 *
 * Long numeric ids and phone numbers would otherwise be reformatted by Excel
 * into scientific notation or lose their leading zeros. The text number format
 * (`@`) is applied to these columns so the exact string survives a round trip.
 */
export const TEXT_ONLY_COLUMNS: ReadonlySet<number> = new Set(
  EXCEL_COLUMNS.map((column, index) =>
    column.kind === 'id' ||
    column.field === 'phone' ||
    column.field === 'alternatePhone'
      ? index
      : -1,
  ).filter((index) => index !== -1),
)