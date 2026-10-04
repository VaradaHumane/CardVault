import type { Contact, ContactFields } from '../../types/contact'
import { contactDisplayName, emptyContactFields } from '../../types/contact'

/**
 * vCard 3.0 generation.
 *
 * Pure string building with no DOM or storage access, so the escaping, folding
 * and structure rules can be tested directly.
 *
 * Format decisions, all aimed at iOS / Android / desktop importers:
 * - vCard 3.0 rather than 4.0: 4.0 requires a `KIND` property and drops the
 *   bare `URL` that many desktop tools still expect.
 * - CRLF line endings, as the spec requires.
 * - Lines folded at 75 octets (not characters) so multi-byte characters are
 *   never split, which is the most common way hand-rolled exporters corrupt
 *   Unicode names.
 * - Newlines inside a value become the two-character escape `\n`, never a real
 *   line break, which would otherwise truncate the property.
 */

/** RFC 2426 caps content lines at 75 octets, excluding the line break. */
export const MAX_LINE_OCTETS = 75

export const CRLF = '\r\n'

/** vCard property that begins each record. */
const BEGIN_VCARD = 'BEGIN:VCARD'
const END_VCARD = 'END:VCARD'
const VERSION_3_0 = '3.0'

/**
 * Escapes a value for a *text* property (FN, TITLE, NOTE, EMAIL, TEL, URL...).
 *
 * A bare comma or semicolon would be read as a delimiter and a bare newline
 * would end the property, so all four are escaped.
 */
export function escapeText(value: string): string {
  return value
    // Backslash first, so the escapes added below are not double-escaped.
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Escapes one component of a *structured* property (N, ORG, ADR).
 *
 * Components are joined with semicolons, so a semicolon inside a component must
 * be escaped while the separators must not. Commas are left alone: they are not
 * delimiters in these properties, and escaping them makes several importers
 * show the backslash.
 */
export function escapeComponent(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
}

/** Joins structured components into a property value. */
export function joinComponents(components: readonly string[]): string {
  return components.map(escapeComponent).join(';')
}

/**
 * Collapses a multi-line field into a single logical value.
 *
 * The vCard escape turns embedded newlines into `\n`, so the value stays on one
 * line; this just tidies the surrounding whitespace and any stray CR.
 *
 * Values are also coerced to a string. Contacts written by an older build, or
 * hand-edited in a browser, can hold `null`, a number, or be missing the key
 * entirely -- the Excel path already tolerates that, and the vCard path must not
 * fail an export over it.
 */
function clean(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

/**
 * Declares the character set on properties that carry free text.
 *
 * The bytes are always UTF-8, but importers that default to the system
 * code page -- older Outlook on Windows, some Android contacts apps -- will
 * mangle non-Latin names and companies without this. The parameter is harmless
 * for importers that already assume UTF-8.
 */
const UTF8 = { params: { CHARSET: 'UTF-8' } }

/**
 * Splits a single free-text name into family and given parts.
 *
 * Used only as a fallback when the structured name fields are empty. The last
 * word is treated as the family name, which matches how the parser splits names
 * elsewhere in the app. Returns `null` for a single word, since there is no way
 * to tell whether it is a given or a family name.
 */
function splitFullName(fullName: string): { family: string; given: string } | null {
  const parts = fullName.split(/\s+/).filter((part) => part !== '')

  if (parts.length < 2) return null

  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') }
}

/** One logical (unfolded) property line. */
export interface VCardLine {
  name: string
  /**
   * Fully escaped, ready-to-emit value.
   *
   * Text values go through `escapeText`, structured ones through
   * `joinComponents`. An empty value still renders as an empty property.
   */
  value: string
  /** Property group, e.g. `item1`. */
  group?: string
  /** Comma-separated TYPE parameters, e.g. `WORK,VOICE`. */
  types?: string
  /** Extra parameters that are not TYPE. */
  params?: Record<string, string>
}

/**
 * Renders one line as `NAME;TYPE=WORK:value`, without folding.
 *
 * The value is inserted verbatim: escaping is the caller's job, because the
 * correct rules differ between text values (`escapeText`) and structured values
 * (`joinComponents`), and doing it here would double-escape the latter.
 */
export function renderLine(line: VCardLine): string {
  const params: string[] = []

  if (line.types !== undefined && line.types !== '') params.push(`TYPE=${line.types}`)

  for (const [key, value] of Object.entries(line.params ?? {})) {
    params.push(`${key.toUpperCase()}=${value}`)
  }

  const name = line.group === undefined ? line.name : `${line.group}.${line.name}`
  const prefix = params.length === 0 ? name : `${name};${params.join(';')}`

  return `${prefix}:${line.value}`
}

/**
 * Folds a logical line to at most 75 octets per physical line.
 *
 * Folding inserts CRLF followed by a single space. The split happens on code
 * point boundaries, so a multi-byte character is never cut in half, and the
 * leading space counts toward the continuation line's budget.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)

  if (bytes.length <= MAX_LINE_OCTETS) return line

  const chunks: string[] = []

  // Continuation lines spend one octet on the folding space.
  let budget = MAX_LINE_OCTETS
  let start = 0

  while (start < bytes.length) {
    const end = advanceToCodePointBoundary(bytes, start, budget)
    chunks.push(decoder.decode(bytes.subarray(start, end)))
    start = end
    budget = MAX_LINE_OCTETS - 1
  }

  return chunks.join(`${CRLF} `)
}

/**
 * Largest index <= `limit` that lands on a UTF-8 code point boundary.
 *
 * Continuation bytes match `10xxxxxx`; stepping back over them keeps a
 * character whole. Falls back to at least one character so a pathological
 * input cannot loop forever.
 */
function advanceToCodePointBoundary(bytes: Uint8Array, start: number, limit: number): number {
  let end = Math.min(start + limit, bytes.length)

  while (end > start + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
    end -= 1
  }

  return Math.max(end, start + 1)
}

const decoder = new TextDecoder('utf-8')

/** Builds the vCard property lines for one contact. */
export function contactToVCardLines(contact: Contact): VCardLine[] {
  // A record written by an older build, or one corrupted in the database, can be
  // missing the whole `fields` object or individual keys inside it. Falling back
  // to a complete set of empty fields means one bad record degrades to blank
  // cells instead of throwing and losing the entire export.
  const fields: ContactFields =
    contact?.fields !== null && typeof contact?.fields === 'object'
      ? { ...emptyContactFields(), ...contact.fields }
      : emptyContactFields()

  const lines: VCardLine[] = []

  const first = clean(fields.firstName)
  const last = clean(fields.lastName)
  const company = clean(fields.company)
  const designation = clean(fields.designation)
  const department = clean(fields.department)
  const phone = clean(fields.phone)
  const alternatePhone = clean(fields.alternatePhone)
  const email = clean(fields.email)
  const website = clean(fields.website)
  const linkedin = clean(fields.linkedin)
  const address = clean(fields.address)
  const city = clean(fields.city)
  const state = clean(fields.state)
  const country = clean(fields.country)
  const notes = clean(fields.notes)

  lines.push({ name: 'VERSION', value: VERSION_3_0 })

  // The stored id is a UUID, which is already globally unique, so it doubles as
  // the vCard UID and lets importers recognise a re-exported contact.
  lines.push({ name: 'UID', value: escapeText(clean(contact.id)) })

  // FN is mandatory in 3.0. Fall back through the same chain the UI uses.
  const displayName = clean(contactDisplayName(fields))

  lines.push({
    name: 'FN',
    value: escapeText(displayName === '' ? 'Unnamed contact' : displayName),
    ...UTF8,
  })

  // Structured name: Family;Given;Additional;Prefix;Suffix
  //
  // N is required by RFC 2426, so it is always emitted. When the contact only
  // has a single free-text name -- which is the common case, because `fullName`
  // is a first-class field -- it is split so importers that rebuild the contact
  // from N still show a name rather than an empty entry.
  const fullName = clean(fields.fullName)
  const splitName = fullName === '' ? null : splitFullName(fullName)

  lines.push({
    name: 'N',
    value: joinComponents([
      last !== '' ? last : (splitName?.family ?? ''),
      first !== '' ? first : (splitName?.given ?? ''),
      '',
      '',
      '',
    ]),
    ...UTF8,
  })

  if (company !== '') {
    // Only add the department component when there is one; a bare trailing
    // semicolon just looks like a bug to anything reading the file.
    lines.push({
      name: 'ORG',
      value: department === '' ? joinComponents([company]) : joinComponents([company, department]),
      ...UTF8,
    })
  }

  if (designation !== '') {
    lines.push({ name: 'TITLE', value: escapeText(designation), ...UTF8 })
  }

  if (phone !== '') {
    lines.push({ name: 'TEL', types: 'WORK,VOICE,PREF', value: escapeText(phone) })
  }

  // The alternate number has no type field on the model, so a keyword check
  // picks the most useful label. It only affects how the phone app groups it.
  if (alternatePhone !== '') {
    lines.push({
      name: 'TEL',
      types: alternatePhoneTypes(alternatePhone),
      value: escapeText(alternatePhone),
      ...UTF8,
    })
  }

  if (email !== '') {
    lines.push({ name: 'EMAIL', types: 'INTERNET,WORK,PREF', value: escapeText(email) })
  }

  if (website !== '') lines.push({ name: 'URL', value: escapeText(normaliseUrl(website)) })

  if (linkedin !== '') {
    lines.push({ name: 'URL', types: 'PROFILE', value: escapeText(normaliseUrl(linkedin)) })
  }

  // ADR components: PostOfficeBox;Extended;Street;Locality;Region;PostalCode;Country
  // The model has no separate postal code, so that slot stays empty.
  if ([address, city, state, country].some((part) => part !== '')) {
    lines.push({
      name: 'ADR',
      types: 'WORK',
      value: joinComponents(['', '', address, city, state, '', country]),
      ...UTF8,
    })
  }

  if (notes !== '') lines.push({ name: 'NOTE', value: escapeText(notes), ...UTF8 })

  // REV lets an importer decide which copy is newer.
  lines.push({ name: 'REV', value: toVCardTimestamp(contact.updatedAt) })

  return lines
}

/**
 * Picks a TYPE for the alternate number.
 *
 * Only keyword-driven, never numeric guessing: a wrong `TYPE=CELL` would put a
 * landline in the wrong group on the user's phone.
 */
export function alternatePhoneTypes(value: string): string {
  const lowered = value.toLowerCase()

  if (/\bfax\b/.test(lowered)) return 'WORK,FAX'
  if (/\b(mob|mobile|cell)\b/.test(lowered)) return 'CELL'
  if (/\b(home|priv|personal)\b/.test(lowered)) return 'HOME'

  return 'WORK,VOICE'
}

/** Adds a scheme to a bare host so importers treat it as a link. */
export function normaliseUrl(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value

  return `https://${value}`
}

/** ISO 8601 basic timestamp, as vCard 3.0's REV expects. */
export function toVCardTimestamp(iso: string): string {
  const parsed = new Date(iso)

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  }

  return parsed.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

/** Renders one contact as a complete, folded VCARD block (no trailing CRLF). */
export function contactToVCard(contact: Contact): string {
  const body = contactToVCardLines(contact).map((line) => foldLine(renderLine(line)))

  return [BEGIN_VCARD, ...body, END_VCARD].join(CRLF)
}

/** Renders every contact as one vCard document. */
export function contactsToVcf(contacts: readonly Contact[]): string {
  // A document with no cards is not useful and confuses importers.
  if (contacts.length === 0) {
    throw new VCardError('There are no contacts to export.')
  }

  return `${contacts.map(contactToVCard).join(CRLF)}${CRLF}`
}

export class VCardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VCardError'
  }
}