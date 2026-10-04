/**
 * Small display formatters.
 *
 * Kept out of the components so every screen formats dates the same way.
 */

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function toDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === '') return null

  const parsed = new Date(iso)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** e.g. "3 Oct 2026, 14:05". Falls back to the raw value if unparseable. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = toDate(iso)

  if (date === null) return iso ?? ''

  return dateTimeFormatter.format(date)
}

/** e.g. "3 Oct 2026". */
export function formatDate(iso: string | null | undefined): string {
  const date = toDate(iso)

  if (date === null) return iso ?? ''

  return dateFormatter.format(date)
}

/**
 * "Saved 3 Oct 2026" or "Updated today, 14:05" style labels.
 *
 * The stored timestamps are the source of truth; this only makes them read
 * better, so an unparseable value is passed through untouched.
 */
export function formatRelativeSave(
  createdAt: string,
  updatedAt: string,
): string {
  const created = toDate(createdAt)
  const updated = toDate(updatedAt)

  if (created === null) return ''

  if (updated === null || updated.getTime() <= created.getTime()) {
    return `Saved ${dateFormatter.format(created)}`
  }

  return `Saved ${dateFormatter.format(created)} · updated ${dateTimeFormatter.format(updated)}`
}

/** Trims and collapses whitespace for single-line display. */
export function toSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
