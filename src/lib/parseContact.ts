import type { ContactFields, ContactTextField } from '../types/contact'
import { emptyContactFields } from '../types/contact'
import { asText, truncateToCodePoints } from './text'

/**
 * Deterministic OCR text parser.
 *
 * Given the same OCR text it always produces the same fields. It never guesses:
 * a field is only filled when a rule matches with reasonable confidence, and
 * anything it cannot place confidently is left blank or passed to `notes` so the
 * user can correct it on the review screen.
 *
 * Extraction order matters. Labelled lines are consumed first, then structured
 * values (email / link / phone) are lifted out of the remaining text, then
 * name, company, role and location are resolved from what is left.
 */

export interface ParsedContact {
  fields: ContactFields
  /** Short statements about what was *not* found, shown on the review screen. */
  diagnostics: string[]
}

const EMAIL_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}/gi

const LINKEDIN_PATTERN =
  /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:in|pub|company|profile)\/[A-Za-z0-9_%.-]+/i

const BARE_DOMAIN_PATTERN =
  '(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:com|net|org|io|co|dev|ai|biz|info|me|uk|de|fr|au|ca|jp|sg|za|us|in|nl|se|no|es|it)'

const URL_PATTERN = new RegExp(
  `(?:https?:\\/\\/|www\\.)[^\\s]+|${BARE_DOMAIN_PATTERN}(?:[/?#][^\\s]*)?`,
  'gi',
)

/**
 * Phone candidates must contain at least two digit groups, which keeps bare
 * postcodes and version numbers out of the running.
 */
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,5}){1,5}(?:\s?(?:ext|extn|x)\.?\s?\d{1,6})?/g

const DATE_LIKE_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/

/** Longest run of leftover card text kept as notes. */
const MAX_NOTES_LENGTH = 600

const LABEL_LINE_PATTERN = /^([A-Za-z][A-Za-z\s&/.-]{0,24}?)\s*:\s*(.+)$/

const SPACED_LABEL_PATTERN = /^([A-Za-z][A-Za-z\s&/.-]{0,24}?)\s{1,4}(\S.*)$/

const SHORT_PHONE_LABEL_PATTERN = /^([MTODFWmtodfw])\s*[:.]\s*(.+)$/

const FIELD_LABELS: Record<string, ContactTextField> = {
  name: 'fullName',
  fullname: 'fullName',
  contactname: 'fullName',
  firstname: 'firstName',
  'first name': 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  'last name': 'lastName',
  surname: 'lastName',
  company: 'company',
  organisation: 'company',
  organization: 'company',
  employer: 'company',
  firm: 'company',
  title: 'designation',
  designation: 'designation',
  role: 'designation',
  position: 'designation',
  jobtitle: 'designation',
  department: 'department',
  dept: 'department',
  division: 'department',
  team: 'department',
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  cellphone: 'phone',
  'altphone': 'alternatePhone',
  'alt phone': 'alternatePhone',
  alternatephone: 'alternatePhone',
  'alternate phone': 'alternatePhone',
  office: 'alternatePhone',
  fax: 'alternatePhone',
  direct: 'alternatePhone',
  email: 'email',
  'e-mail': 'email',
  emailaddress: 'email',
  mail: 'email',
  website: 'website',
  web: 'website',
  url: 'website',
  site: 'website',
  homepage: 'website',
  linkedin: 'linkedin',
  address: 'address',
  addr: 'address',
  street: 'address',
  city: 'city',
  town: 'city',
  state: 'state',
  province: 'state',
  region: 'state',
  country: 'country',
  notes: 'notes',
  note: 'notes',
}

const SHORT_PHONE_LABELS: Record<string, ContactTextField> = {
  m: 'phone',
  t: 'phone',
  w: 'phone',
  o: 'alternatePhone',
  f: 'alternatePhone',
  d: 'alternatePhone',
}

const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'sir',
  'madam',
])

const COMPANY_TOKENS = new Set([
  'inc',
  'llc',
  'llp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'pvt',
  'plc',
  'pte',
  'srl',
  'oy',
  'ab',
  'as',
  'kk',
  'holdings',
  'group',
  'technologies',
  'technology',
  'tech',
  'solutions',
  'systems',
  'services',
  'enterprises',
  'industries',
  'labs',
  'laboratories',
  'studio',
  'studios',
  'agency',
  'associates',
  'consulting',
  'consultants',
  'consultancy',
  'partners',
  'capital',
  'ventures',
  'media',
  'digital',
  'networks',
  'software',
  'international',
  'global',
  'bank',
  'university',
  'institute',
  'hospital',
  'clinic',
  'foundation',
  'trust',
  'resorts',
  'hotels',
  'logistics',
])

const DESIGNATION_TOKENS = new Set([
  'ceo',
  'cto',
  'cfo',
  'coo',
  'cio',
  'cmo',
  'ciso',
  'president',
  'vice',
  'chairman',
  'chairwoman',
  'founder',
  'cofounder',
  'owner',
  'principal',
  'partner',
  'director',
  'manager',
  'head',
  'chief',
  'officer',
  'executive',
  'lead',
  'engineer',
  'developer',
  'designer',
  'architect',
  'consultant',
  'analyst',
  'specialist',
  'coordinator',
  'administrator',
  'supervisor',
  'advisor',
  'associate',
  'scientist',
  'researcher',
  'professor',
  'senior',
  'junior',
  'trainee',
  'intern',
  'md',
  'gm',
  'pm',
])

const DEPARTMENT_TOKENS = new Set([
  'sales',
  'marketing',
  'engineering',
  'finance',
  'accounts',
  'accounting',
  'hr',
  'human',
  'resources',
  'operations',
  'it',
  'legal',
  'compliance',
  'design',
  'product',
  'customer',
  'success',
  'business',
  'development',
  'procurement',
  'supply',
  'chain',
  'quality',
  'assurance',
  'research',
  'training',
  'administration',
  'relations',
  'communications',
  'tax',
  'audit',
  'risk',
  'security',
  'and',
  'of',
  'the',
  'department',
  'dept',
  'division',
  'team',
  'group',
])

const COUNTRY_NAMES = [
  'united states of america',
  'united states',
  'united kingdom',
  'new zealand',
  'south africa',
  'saudi arabia',
  'united arab emirates',
  'czech republic',
  'sri lanka',
  'costa rica',
  'south korea',
  'hong kong',
  'india',
  'usa',
  'canada',
  'australia',
  'ireland',
  'england',
  'scotland',
  'wales',
  'france',
  'germany',
  'italy',
  'spain',
  'portugal',
  'belgium',
  'switzerland',
  'austria',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'poland',
  'greece',
  'turkey',
  'russia',
  'ukraine',
  'israel',
  'egypt',
  'morocco',
  'nigeria',
  'kenya',
  'ghana',
  'brazil',
  'mexico',
  'argentina',
  'chile',
  'colombia',
  'peru',
  'singapore',
  'malaysia',
  'indonesia',
  'thailand',
  'vietnam',
  'philippines',
  'china',
  'japan',
  'taiwan',
  'pakistan',
  'bangladesh',
  'nepal',
  'qatar',
  'kuwait',
  'oman',
  'bahrain',
  'jordan',
  'lebanon',
  'iran',
  'iraq',
]

/**
 * Two-letter codes are only matched when they appear fully upper-cased, so a
 * lowercase "in" or "or" in a sentence is never mistaken for a country.
 */
const COUNTRY_CODES = new Set([
  'US',
  'UK',
  'UAE',
  'IN',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'SE',
  'NO',
  'CA',
  'AU',
  'NZ',
  'JP',
  'CN',
  'SG',
  'ZA',
  'BR',
  'MX',
  'IE',
  'CH',
  'AT',
  'BE',
  'DK',
  'FI',
  'PL',
  'PT',
  'GR',
  'TR',
  'AE',
  'IL',
])

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
])

const REGION_NAMES = [
  'andhra pradesh',
  'himachal pradesh',
  'uttar pradesh',
  'madhya pradesh',
  'tamil nadu',
  'west bengal',
  'new south wales',
  'western australia',
  'south australia',
  'british columbia',
  'newfoundland',
  'nova scotia',
  'ontario',
  'quebec',
  'alberta',
  'assam',
  'bihar',
  'chhattisgarh',
  'gujarat',
  'haryana',
  'jharkhand',
  'karnataka',
  'kerala',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'orissa',
  'punjab',
  'rajasthan',
  'sikkim',
  'telangana',
  'tripura',
  'uttarakhand',
  'arunachal',
  'andaman',
  'lakshadweep',
  'puducherry',
  'pondicherry',
  'chandigarh',
  'alabama',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'wisconsin',
  'wyoming',
]

const STREET_TOKENS = [
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'lane',
  'ln',
  'drive',
  'dr',
  'boulevard',
  'blvd',
  'suite',
  'ste',
  'floor',
  'fl',
  'block',
  'plot',
  'tower',
  'building',
  'bldg',
  'apartment',
  'apt',
  'marg',
  'highway',
  'hwy',
  'park',
  'plaza',
  'square',
  'court',
  'ct',
  'place',
  'pl',
  'via',
  'viale',
  'corso',
  'rue',
  'avenida',
  'calle',
  'platz',
  'gasse',
  'weg',
  'straat',
]

const STREET_TOKEN_SET: ReadonlySet<string> = new Set(STREET_TOKENS)

interface WorkLine {
  /** Line text with already-extracted values blanked out. */
  text: string
  /** The line exactly as OCR produced it, used where blanking would hide context. */
  original: string
  /** Set once a field has claimed this line, so it cannot feed `notes`. */
  consumed: boolean
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00b7\u2022\u25aa\u25cf]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalizeWhitespace(value)
    .split(' ')
    .filter((token) => token !== '')
}

/**
 * Dictionaries hold bare words, but OCR keeps the punctuation that was printed
 * on the card ("Pvt." / "Ltd."), so tokens are stripped before comparison.
 */
function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function containsToken(value: string, dictionary: ReadonlySet<string>): boolean {
  return tokens(value).some((token) => dictionary.has(normalizeToken(token)))
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/^[\s,;|]+|[\s,;|]+$/g, '')
}

function collapse(value: string): string {
  return stripTrailingPunctuation(normalizeWhitespace(value))
}

function countDigits(value: string): number {
  return value.replace(/\D/g, '').length
}

function setField(
  fields: ContactFields,
  key: ContactTextField,
  value: string,
): boolean {
  const cleaned = collapse(value)

  if (cleaned === '') return false
  if (fields[key] !== '') return false

  fields[key] = cleaned
  return true
}

/** Adds a value to a single-line notes field, separated by newlines. */
function appendNote(fields: ContactFields, value: string): void {
  const cleaned = collapse(value)

  if (cleaned === '') return

  // `asText` because `fields` comes off a stored record during a merge, and a
  // record written before a field existed has nothing here.
  const existing = asText(fields.notes).trim()
  fields.notes = existing === '' ? cleaned : `${existing}\n${cleaned}`
}

function normalizeWebsite(value: string): string {
  const cleaned = collapse(value).replace(/[.,;:)\]]+$/, '')

  if (cleaned === '') return ''
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  if (/^linkedin\.com/i.test(cleaned)) return `https://${cleaned}`

  return `https://${cleaned}`
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

function isPhoneLike(value: string): boolean {
  const digits = countDigits(value)
  return digits >= 7 && digits <= 15 && !DATE_LIKE_PATTERN.test(value.trim())
}

function isUrlLike(value: string): boolean {
  return /^(?:https?:\/\/|www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.test(
    value.trim(),
  )
}

/**
 * Pulls the first dictionary match out of a line, longest phrase first so
 * "united kingdom" wins over "kingdom"-style false positives.
 */
function extractPhrase(
  value: string,
  phrases: readonly string[],
): { match: string; index: number; length: number } | null {
  let best: { match: string; index: number; length: number } | null = null

  for (const phrase of phrases) {
    const pattern = new RegExp(
      `(^|[^A-Za-z])(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z])`,
      'i',
    )
    const match = pattern.exec(value)

    if (match === null) continue
    if (best !== null && match[2].length <= best.length) continue

    best = {
      match: match[2],
      index: match.index + match[1].length,
      length: match[2].length,
    }
  }

  return best
}

function extractUppercaseToken(
  value: string,
  codes: Set<string>,
): { match: string; index: number; length: number } | null {
  const pattern = /(^|[^A-Za-z0-9])([A-Za-z]{2,3})(?![A-Za-z0-9])/g
  let match: RegExpExecArray | null
  let best: { match: string; index: number; length: number } | null = null

  while ((match = pattern.exec(value)) !== null) {
    const token = match[2]

    if (!codes.has(token)) continue

    best = {
      match: token,
      index: match.index + match[1].length,
      length: token.length,
    }
    break
  }

  return best
}

/** Replaces the matched slice with blanks so offsets of later matches hold. */
function blankOut(value: string, index: number, length: number): string {
  return (
    value.slice(0, index) + ' '.repeat(length) + value.slice(index + length)
  )
}

function removeMatch(line: WorkLine, index: number, length: number): void {
  line.text = blankOut(line.text, index, length)
}

/** Collects phone candidates that are not embedded in words or other values. */
function findPhoneCandidates(line: WorkLine): string[] {
  const found: string[] = []
  const pattern = new RegExp(PHONE_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line.text)) !== null) {
    const raw = match[0]
    const before = line.text[match.index - 1] ?? ''
    const after = line.text[match.index + raw.length] ?? ''

    if (/[A-Za-z@]/.test(before) || /[A-Za-z@]/.test(after)) continue
    if (!isPhoneLike(raw)) continue

    found.push(collapse(raw))
    removeMatch(line, match.index, raw.length)
  }

  return found
}

function assignPhone(fields: ContactFields, value: string): void {
  if (fields.phone === '') {
    fields.phone = collapse(value)
    return
  }

  if (fields.alternatePhone === '' && fields.phone !== collapse(value)) {
    fields.alternatePhone = collapse(value)
  }
}

function looksLikeNameCandidate(text: string): boolean {
  if (/\d/.test(text)) return false
  if (/[@]/.test(text)) return false

  URL_PATTERN.lastIndex = 0
  if (URL_PATTERN.test(text)) return false
  URL_PATTERN.lastIndex = 0

  const parts = tokens(text)

  if (parts.length < 2 || parts.length > 5) return false

  // Honorifics are dropped first: "Dr." would otherwise collide with the
  // street abbreviation "dr" and "Mr." reads like a title keyword.
  const meaningful = parts.filter(
    (part) => !HONORIFICS.has(normalizeToken(part)),
  )

  if (meaningful.length < 2) return false
  if (meaningful.length > 5) return false

  const remaining = meaningful.join(' ')

  if (containsToken(remaining, COMPANY_TOKENS)) return false
  if (containsToken(remaining, DESIGNATION_TOKENS)) return false
  if (containsToken(remaining, DEPARTMENT_TOKENS)) return false
  if (containsToken(remaining, STREET_TOKEN_SET)) return false

  return meaningful.every((part) => /^[A-Z][A-Za-z'’-]*\.?$/.test(part))
}

function splitFullName(fullName: string): {
  firstName: string
  lastName: string
} {
  const parts = tokens(fullName).filter(
    (part) => !HONORIFICS.has(part.toLowerCase().replace(/\./g, '')),
  )

  if (parts.length < 2) return { firstName: '', lastName: '' }

  return {
    firstName: parts[0].replace(/\.$/, ''),
    lastName: parts[parts.length - 1].replace(/\.$/, ''),
  }
}

function findName(lines: WorkLine[], startIndex: number): number {
  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.consumed) continue

    const text = collapse(line.text)

    if (!looksLikeNameCandidate(text)) continue

    const parts = tokens(text)
    let score = 10

    if (parts.length === 2) score += 4
    if (index < lines.length / 2) score += 3
    if (/\s/.test(text)) score += 1
    // Card layouts usually put the person in the top half; a small nudge for
    // earlier lines keeps ties resolved the same way on every run.
    score += Math.max(0, (lines.length - index) / lines.length)

    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  return bestIndex
}

function findByTokens(
  lines: WorkLine[],
  dictionary: ReadonlySet<string>,
): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.consumed) continue
    if (containsToken(line.text, dictionary)) return index
  }

  return -1
}

/**
 * Business cards put a postcode either on its own after a comma
 * ("Bengaluru, 560001") or glued to the city ("Bengaluru 560001").
 */
const POSTCODE_PATTERN = /\b\d{4,6}\b/

function matchPostcode(value: string): string | null {
  const match = POSTCODE_PATTERN.exec(value)
  return match === null ? null : match[0]
}

function stripPostcode(value: string): string {
  return collapse(value.replace(POSTCODE_PATTERN, ' '))
}

function looksLikeAllCapsLine(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '')

  if (letters.length < 3) return false

  return letters === letters.toUpperCase() && /[A-Z]{3}/.test(letters)
}

/**
 * Parses OCR output into editable contact fields.
 */
export function parseContactText(rawText: string): ParsedContact {
  const fields = emptyContactFields()

  const lines: WorkLine[] = normalizeWhitespace(rawText)
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => ({ text: line, original: line, consumed: false }))

  /**
   * Stores a value and, by default, marks any line containing it as claimed so
   * it cannot also feed `notes`. Country and state opt out: they are usually a
   * fragment of the same line the city and address come from.
   */
  const assign = (
    key: ContactTextField,
    value: string,
    autoConsume = true,
  ): boolean => {
    const didSet = setField(fields, key, value)

    if (didSet && autoConsume) {
      const cleaned = collapse(value)

      // Only claim the whole line for longer values, so a short match such as
      // the state "IN" cannot swallow an unrelated line containing "MINI".
      if (cleaned.length >= 4) {
        for (const line of lines) {
          if (collapse(line.text).includes(cleaned)) line.consumed = true
        }
      }
    }

    return didSet
  }

  // 1. Explicit "Label: value" lines.
  for (const line of lines) {
    if (line.consumed) continue

    const labelMatch = LABEL_LINE_PATTERN.exec(line.text)

    if (labelMatch === null) continue

    const label = labelMatch[1].toLowerCase().replace(/[.\s]+$/, '').trim()
    const value = labelMatch[2]
    const target = FIELD_LABELS[label]

    if (target === undefined) continue

    if (target === 'linkedin') {
      assign('linkedin', normalizeWebsite(value))
    } else if (target === 'website') {
      assign('website', normalizeWebsite(value))
    } else if (target === 'email') {
      const emailMatch = EMAIL_PATTERN.exec(value)
      EMAIL_PATTERN.lastIndex = 0
      assign('email', emailMatch === null ? value : emailMatch[0])
    } else if (target === 'phone' || target === 'alternatePhone') {
      if (isPhoneLike(value)) assignPhone(fields, value)
      else appendNote(fields, `${labelMatch[1]}: ${value}`)
    } else {
      assign(target, value)
    }

    line.consumed = true
  }

  // 2. "Label value" without a colon, only when the value is unmistakable.
  for (const line of lines) {
    if (line.consumed) continue

    const spacedMatch = SPACED_LABEL_PATTERN.exec(line.text)

    if (spacedMatch === null) continue

    const label = spacedMatch[1].toLowerCase().replace(/[.\s]+$/, '').trim()
    const target = FIELD_LABELS[label]

    if (target === undefined) continue

    const value = spacedMatch[2]

    if (target === 'email' && isEmailLike(value)) {
      assign('email', value)
    } else if (target === 'website' && isUrlLike(value)) {
      assign('website', normalizeWebsite(value))
    } else if (target === 'linkedin' && /linkedin\.com/i.test(value)) {
      assign('linkedin', normalizeWebsite(value))
    } else if (
      (target === 'phone' || target === 'alternatePhone') &&
      isPhoneLike(value)
    ) {
      assignPhone(fields, value)
    } else {
      continue
    }

    line.consumed = true
  }

  // 3. Short phone labels such as "M:", "T:", "F:".
  for (const line of lines) {
    if (line.consumed) continue

    const shortMatch = SHORT_PHONE_LABEL_PATTERN.exec(line.text)

    if (shortMatch === null) continue

    const target = SHORT_PHONE_LABELS[shortMatch[1].toLowerCase()]

    if (target === undefined) continue

    const value = shortMatch[2]
    const phoneCandidates = isPhoneLike(value)
      ? [collapse(value)]
      : findPhoneCandidates({ text: value, original: value, consumed: false })

    if (phoneCandidates.length === 0) continue

    for (const candidate of phoneCandidates) assignPhone(fields, candidate)
    line.consumed = true
  }

  // 4. Email addresses, then links, lifted out of the remaining text.
  for (const line of lines) {
    if (fields.email !== '') break

    const emailMatch = EMAIL_PATTERN.exec(line.text)

    if (emailMatch === null) continue

    assign('email', emailMatch[0])
    removeMatch(line, emailMatch.index, emailMatch[0].length)
  }
  EMAIL_PATTERN.lastIndex = 0

  for (const line of lines) {
    const linkedinMatch = LINKEDIN_PATTERN.exec(line.text)

    if (linkedinMatch === null) continue

    assign('linkedin', normalizeWebsite(linkedinMatch[0]))
    removeMatch(line, linkedinMatch.index, linkedinMatch[0].length)
  }

  for (const line of lines) {
    if (fields.website !== '') break

    const urlMatch = URL_PATTERN.exec(line.text)

    if (urlMatch === null) continue
    if (LINKEDIN_PATTERN.test(urlMatch[0])) {
      URL_PATTERN.lastIndex = 0
      LINKEDIN_PATTERN.lastIndex = 0
      continue
    }
    LINKEDIN_PATTERN.lastIndex = 0

    assign('website', normalizeWebsite(urlMatch[0]))
    removeMatch(line, urlMatch.index, urlMatch[0].length)
  }
  URL_PATTERN.lastIndex = 0

  // 5. Phone numbers, in reading order.
  for (const line of lines) {
    if (fields.phone !== '' && fields.alternatePhone !== '') break

    for (const candidate of findPhoneCandidates(line)) {
      assignPhone(fields, candidate)
    }
  }

  // 6. Name: prefer a labelled value, otherwise the strongest name-shaped line.
  if (fields.fullName === '') {
    const nameIndex = findName(lines, 0)

    if (nameIndex !== -1) {
      const text = collapse(lines[nameIndex].text)
      const parts = tokens(text).filter(
        (part) => !HONORIFICS.has(part.toLowerCase().replace(/\./g, '')),
      )

      assign('fullName', parts.join(' '))
      lines[nameIndex].consumed = true

      if (parts.length >= 2) {
        fields.firstName = parts[0].replace(/\.$/, '')
        fields.lastName = parts[parts.length - 1].replace(/\.$/, '')
      }
    }
  }

  if (fields.firstName === '' || fields.lastName === '') {
    const derived = splitFullName(fields.fullName)

    if (fields.firstName === '') fields.firstName = derived.firstName
    if (fields.lastName === '') fields.lastName = derived.lastName
  }

  // 7. Company: legal suffixes first, then an upper-case line as a fallback.
  if (fields.company === '') {
    const companyIndex = findByTokens(lines, COMPANY_TOKENS)

    if (companyIndex !== -1) {
      assign('company', lines[companyIndex].text)
      lines[companyIndex].consumed = true
    } else {
      const upperIndex = lines.findIndex(
        (line) => !line.consumed && looksLikeAllCapsLine(line.text),
      )

      if (upperIndex !== -1) {
        assign('company', lines[upperIndex].text)
        lines[upperIndex].consumed = true
      }
    }
  }

  // 8. Designation and department.
  if (fields.designation === '') {
    const roleIndex = findByTokens(lines, DESIGNATION_TOKENS)

    if (roleIndex !== -1) {
      const line = lines[roleIndex]
      const text = collapse(line.text)
      const deptMatch = /(?:department|dept\.?)\s*[:-]?\s*(.+)$/i.exec(text)

      if (deptMatch !== null) {
        assign('designation', text.slice(0, deptMatch.index))
        assign('department', deptMatch[1])
      } else {
        assign('designation', text)
      }

      line.consumed = true
    }
  }

  if (fields.department === '') {
    const deptIndex = lines.findIndex((line) => {
      if (line.consumed) return false

      const parts = tokens(line.text)

      if (parts.length === 0 || parts.length > 4) return false
      if (/\d/.test(line.text)) return false

      return parts.every((part) => DEPARTMENT_TOKENS.has(normalizeToken(part)))
    })

    if (deptIndex !== -1) {
      assign('department', lines[deptIndex].text)
      lines[deptIndex].consumed = true
    }
  }

  // 9. Location: country, then state, then address and city.
  if (fields.country === '') {
    for (const line of lines) {
      if (line.consumed) continue

      const phrase = extractPhrase(line.text, COUNTRY_NAMES)

      if (phrase !== null) {
        assign('country', phrase.match, false)
        removeMatch(line, phrase.index, phrase.length)
        break
      }

      const code = extractUppercaseToken(line.text, COUNTRY_CODES)

      if (code !== null) {
        assign('country', code.match, false)
        removeMatch(line, code.index, code.length)
        break
      }
    }
  }

  if (fields.state === '') {
    for (const line of lines) {
      if (line.consumed) continue

      const code = extractUppercaseToken(line.text, US_STATE_CODES)

      if (code !== null) {
        assign('state', code.match, false)
        removeMatch(line, code.index, code.length)
        break
      }

      const phrase = extractPhrase(line.text, REGION_NAMES)

      if (phrase !== null) {
        assign('state', phrase.match, false)
        removeMatch(line, phrase.index, phrase.length)
        break
      }
    }
  }

  let postcode = ''

  if (fields.city === '') {
    // Address lines are read from the original text: blanking the state and
    // country out first would hide which comma-separated segment held them.
    for (const line of lines) {
      if (line.consumed) continue

      // A street line is address detail, never a city.
      if (containsToken(line.original, STREET_TOKEN_SET)) continue

      const segments = line.original
        .split(',')
        .map((segment) => collapse(segment))
        .filter((segment) => segment !== '')

      if (segments.length < 2) continue

      const regionIndex = segments.findIndex(
        (segment) =>
          (fields.state !== '' &&
            normalizeToken(segment).includes(normalizeToken(fields.state))) ||
          (fields.country !== '' &&
            normalizeToken(segment).includes(normalizeToken(fields.country))),
      )

      let cityIndex = -1

      if (regionIndex > 0) {
        cityIndex = regionIndex - 1
      } else if (regionIndex === -1) {
        // No region on this line. Only trust a trailing postcode, as in
        // "221B Baker Street, London, SW1A 1AA".
        const last = segments[segments.length - 1]

        if (/^\d{4,6}[A-Za-z]?$/.test(last)) cityIndex = segments.length - 2
      }

      if (cityIndex < 0) continue

      const cityCandidate = stripPostcode(segments[cityIndex])

      if (!/[A-Za-z]{2}/.test(cityCandidate)) continue

      assign('city', cityCandidate)

      if (postcode === '') {
        postcode =
          segments
            .slice(cityIndex)
            .map((segment) => matchPostcode(segment))
            .find((value): value is string => value !== null) ?? ''
      }

      if (fields.address === '') {
        assign('address', segments.slice(0, cityIndex).join(', '))
      }

      line.consumed = true
      break
    }
  }

  if (fields.address === '') {
    const streetIndex = findByTokens(lines, STREET_TOKEN_SET)

    if (streetIndex !== -1) {
      assign('address', lines[streetIndex].text)
      lines[streetIndex].consumed = true
    }
  }

  // Keep the postcode with the address rather than dropping it on the floor.
  if (postcode !== '') {
    if (fields.address !== '') {
      fields.address = `${fields.address}, ${postcode}`
    } else if (fields.city !== '') {
      fields.city = `${fields.city}, ${postcode}`
    } else {
      appendNote(fields, postcode)
    }
  }

  // 10. Anything left over is extra card text, surfaced as notes.
  const leftover = lines
    .filter((line) => !line.consumed)
    .map((line) => collapse(line.text))
    .filter((line) => /[A-Za-z]{2}/.test(line))

  for (const line of leftover) {
    appendNote(fields, line)
  }

  // Truncated by code point, not by UTF-16 code unit: a plain `slice` can cut
  // an emoji in half, and the orphaned surrogate then becomes U+FFFD in every
  // export format.
  fields.notes = truncateToCodePoints(fields.notes, MAX_NOTES_LENGTH)

  return { fields, diagnostics: buildDiagnostics(fields) }
}

function buildDiagnostics(fields: ContactFields): string[] {
  const diagnostics: string[] = []

  if (fields.fullName === '') diagnostics.push('No name was detected on the card.')
  if (fields.company === '') diagnostics.push('No company name was detected.')
  if (fields.email === '') diagnostics.push('No email address was detected.')

  if (fields.phone === '') {
    diagnostics.push('No phone number was detected.')
  } else if (fields.alternatePhone === '') {
    diagnostics.push('Only one phone number was detected.')
  }

  return diagnostics
}
