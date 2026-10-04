/**
 * Excel worksheet name rules.
 *
 * Excel is strict about sheet names and fails the whole save with a vague
 * message when a name breaks its rules. Every name that reaches the workbook
 * therefore goes through `uniqueSheetName`, which enforces the documented
 * limits and guarantees uniqueness.
 *
 * Kept free of any ExcelJS import so the rules can be tested on their own.
 */

import { truncateToCodePoints } from '../text'

/** Excel refuses these characters in a sheet name. */
const INVALID_CHARACTERS = /[:\\/?*[\]]/g

/** Control characters are also rejected. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point here
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g

/** Excel's hard limit on worksheet name length. */
export const MAX_SHEET_NAME_LENGTH = 31

/** Excel reserves this name for its own change-tracking feature. */
const RESERVED_NAMES = new Set(['history'])

export const OTHER_CONTACTS_SHEET = 'Other Contacts'
export const COMPANY_SUMMARY_SHEET = 'Company Summary'

/** Sheet holding every exported contact when the whole vault is exported. */
export const ALL_CONTACTS_SHEET_DEFAULT = 'All Contacts'

/** Used when a company name is empty or sanitises away to nothing. */
export const FALLBACK_SHEET_NAME = 'Unnamed'

/**
 * Truncates a candidate name so it satisfies the sheet-name limit twice over.
 *
 * Two different limits are in play. Excel documents 31 *characters*, while
 * ExcelJS enforces it with `String.length`, which counts UTF-16 *code units*. A
 * 31-character name containing an emoji is 32 code units, so ExcelJS decides it
 * is too long, silently re-truncates it with `substring`, and cuts the surrogate
 * pair in half -- writing exactly the U+FFFD corruption this function exists to
 * prevent. Staying inside both limits stops ExcelJS from touching the name.
 *
 * `limit` defaults to the full sheet-name budget; a smaller one is used when
 * room has to be reserved for a numeric suffix.
 */
function truncateForExcel(value: string, limit: number = MAX_SHEET_NAME_LENGTH): string {
  let result = truncateToCodePoints(value, limit)

  // Dropping whole characters is what keeps surrogate pairs intact.
  while (result.length > limit && result !== '') {
    result = [...result].slice(0, -1).join('')
  }

  return result
}

/**
 * Makes one company name safe to use as a worksheet name.
 *
 * Replaces invalid and control characters with a space, collapses runs of
 * whitespace, strips leading/trailing apostrophes (Excel rejects those at the
 * edges), and trims to 31 characters.
 *
 * The order of the last two steps matters. Truncating first and stripping
 * apostrophes afterwards would be wrong in the other direction, because the
 * truncation can leave an apostrophe as the final character -- ExcelJS then
 * refuses the whole workbook. So the name is truncated, and only then are edge
 * apostrophes stripped again.
 */
export function sanitizeSheetName(raw: string): string {
  const cleaned = raw
    .replace(CONTROL_CHARACTERS, '')
    .replace(INVALID_CHARACTERS, ' ')
    // A literal apostrophe is legal except at the start or end.
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned === '') return FALLBACK_SHEET_NAME

  // Truncated by code point so a character outside the Basic Multilingual Plane
  // is never cut in half. A lone surrogate would be written into the workbook as
  // U+FFFD, corrupting the file.
  const truncated = truncateForExcel(cleaned)

  // Truncation can expose a new trailing apostrophe or space, both of which
  // Excel rejects, so the edge rules are applied once more. Removing characters
  // can shorten the name further, which stays within the limit.
  const final = truncated.replace(/^'+|'+$/g, '').replace(/\s+$/, '').trim()

  return final === '' ? FALLBACK_SHEET_NAME : final
}

/**
 * Returns a name that is legal, within the length limit, and not already in
 * `used`. Numeric suffixes are added when needed and the base name is shortened
 * to make room, so the result is always exactly within the limit.
 *
 * `used` is mutated with the returned name so callers can keep handing it to
 * this function for each sheet they add.
 */
export function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = sanitizeSheetName(raw)

  // Case-insensitive, matching how Excel treats sheet names.
  const taken = new Set([...used].map((name) => name.toLowerCase()))

  const isFree = (candidate: string) =>
    candidate !== '' && !taken.has(candidate.toLowerCase())

  if (isFree(base) && !RESERVED_NAMES.has(base.toLowerCase())) {
    used.add(base)
    return base
  }

  // The base name is taken, or it collides with a reserved word. Suffix it.
  for (let suffix = 2; suffix < 10000; suffix++) {
    const label = `(${suffix})`
    // Leave room for " (9999)".
    const room = MAX_SHEET_NAME_LENGTH - label.length
    // Truncating can leave a trailing apostrophe or space, which would make
    // ExcelJS reject the entire workbook.
    const fitted = truncateForExcel(base, Math.max(1, room))
      .replace(/^'+|'+$/g, '')
      .replace(/\s+$/, '')
      .trim()
    const candidate = fitted === '' ? label.trim() : `${fitted} ${label}`

    if (isFree(candidate) && !RESERVED_NAMES.has(candidate.toLowerCase())) {
      used.add(candidate)
      return candidate
    }
  }

  // Unreachable in practice; keeps the function total.
  const fallback = `Sheet ${used.size + 1}`
  used.add(fallback)
  return fallback
}

/**
 * Reserves the sheet names the workbook always uses, so a company called
 * "Company Summary" cannot collide with the summary sheet.
 */
export function reserveFixedSheetNames(): Set<string> {
  return new Set<string>([COMPANY_SUMMARY_SHEET, OTHER_CONTACTS_SHEET])
}

/**
 * Builds a safe download filename.
 *
 * Strips path separators and characters that break filesystems or browsers,
 * then trims to a comfortable length.
 */
export function buildFileName(stamp: Date, label: string): string {
  const safeLabel = truncateToCodePoints(
    label
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
    60,
  )

  const name = safeLabel === '' ? 'cardvault-contacts' : `cardvault-${safeLabel}`

  return `${name}-${formatStamp(stamp)}.xlsx`
}

/** yyyy-mm-dd in local time, for stable, sortable filenames. */
export function formatStamp(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}