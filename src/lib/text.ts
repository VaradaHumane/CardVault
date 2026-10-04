/**
 * String helpers that are shared across parsing, export and download code.
 */

/**
 * Coerces a stored value to a string.
 *
 * A record written by an older build, or one corrupted in the database, can hold
 * `null`, a number, or be missing the key entirely. Calling `.trim()` on those
 * throws, which takes down an entire screen or export over one bad record, so
 * every read of persisted contact data goes through here first.
 */
export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Truncates to a maximum number of characters without splitting a surrogate
 * pair.
 *
 * `String.prototype.slice` counts UTF-16 code units, so cutting a string in the
 * middle of an emoji or any other character outside the Basic Multilingual
 * Plane leaves a lone surrogate behind. That is not a cosmetic problem: a lone
 * surrogate encodes to U+FFFD in UTF-8, which would silently corrupt the user's
 * text in a vCard or an Excel file.
 *
 * Spreading into an array iterates by code point, so the result never contains
 * half a character.
 *
 * `maxLength` counts code points. Excel's own sheet-name limit is also counted
 * in code points, so this matches how Excel measures it.
 */
export function truncateToCodePoints(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''

  const characters = [...value]

  return characters.length <= maxLength ? value : characters.slice(0, maxLength).join('')
}

/**
 * Truncates by UTF-8 byte length, which is what the vCard format's 75-octet
 * line-folding rule is measured in.
 *
 * Cutting on a byte boundary rather than a character boundary would split a
 * multi-byte sequence, so the limit is applied by whole characters and only
 * then checked against the byte budget.
 */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''

  let total = 0
  let result = ''

  for (const character of value) {
    const size = new TextEncoder().encode(character).length

    if (total + size > maxBytes) break

    total += size
    result += character
  }

  return result
}