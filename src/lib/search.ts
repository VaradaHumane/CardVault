import type { Contact, ContactFields } from '../types/contact'

/**
 * Dashboard search.
 *
 * Pure functions over already-loaded contacts: IndexedDB indexes cannot do
 * substring matching on a useful field, and the dashboard holds every contact
 * anyway, so filtering in memory is both simpler and fast enough at vault
 * sizes.
 */

/** Fields the search box looks in, in the order they are matched. */
export const SEARCHABLE_KEYS = [
  'fullName',
  'firstName',
  'lastName',
  'company',
  'email',
  'phone',
  'alternatePhone',
] as const satisfies readonly (keyof ContactFields)[]

/** Normalises a query for comparison: trimmed and lower-cased. */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase()
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

/**
 * True when every whitespace-separated term appears somewhere in the contact.
 *
 * Splitting on spaces means "north jane" finds Jane Doe at Northwind, which
 * reads far better than requiring the terms to be adjacent.
 */
export function matchesContactSearch(contact: Contact, query: string): boolean {
  const needle = normaliseQuery(query)

  if (needle === '') return true

  const terms = needle.split(/\s+/).filter((term) => term !== '')

  if (terms.length === 0) return true

  return terms.every((term) =>
    SEARCHABLE_KEYS.some((key) => matches(contact.fields[key], term)),
  )
}

/**
 * Phone-aware search.
 *
 * Phone numbers are written with spaces, dashes, dots and brackets. Stripping
 * everything but digits from both sides means "98765" and "+91 98765 43210"
 * find each other.
 */
function matchesPhone(fields: ContactFields, needle: string): boolean {
  const digitsOnly = needle.replace(/\D/g, '')

  if (digitsOnly === '') return false

  const candidates = [fields.phone, fields.alternatePhone]

  return candidates.some((value) => {
    const digits = value.replace(/\D/g, '')

    return digits !== '' && digits.includes(digitsOnly)
  })
}

export function searchContacts(
  contacts: Contact[],
  query: string,
): Contact[] {
  const needle = normaliseQuery(query)

  if (needle === '') return contacts

  const hasDigits = /\d/.test(needle)

  return contacts.filter((contact) => {
    if (matchesContactSearch(contact, needle)) return true

    return hasDigits && matchesPhone(contact.fields, needle)
  })
}
