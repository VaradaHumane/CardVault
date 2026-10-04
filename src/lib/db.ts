import type { Contact } from '../types/contact'
import { asText } from './text'

/**
 * IndexedDB service for contacts.
 *
 * This is the only module that talks to IndexedDB. Everything above it deals in
 * plain `Contact` objects, so swapping the storage engine later does not touch
 * the screens. The API is deliberately a little wider than the current UI needs
 * (`getContactsByIds`, `groupContactsByCompany`) so that VCF and Excel export
 * can be built on top without reshaping storage again.
 */

const DB_NAME = 'cardvault'
const DB_VERSION = 1

const CONTACT_STORE = 'contacts'

/** Bucket label for contacts that have no company, so an export never drops them. */
/**
 * Label shown for contacts that have no company.
 *
 * This is a display string, never an identity marker. An earlier version used
 * this same text as the catch-all bucket's key and detected it with `===`, so a
 * contact whose real company was literally "No company" was silently merged
 * into the catch-all: it lost its own worksheet and its own summary row. The
 * bucket is now identified by {@link ContactCompanyGroup.catchAll}, which cannot
 * collide with any company name.
 */
export const NO_COMPANY_LABEL = 'No company'

/** Which operation failed. Used for logging and for tailored recovery copy. */
export type StorageOperation =
  | 'open'
  | 'add'
  | 'list'
  | 'get'
  | 'update'
  | 'delete'
  | 'count'

/**
 * Storage failures the UI has to be able to explain.
 *
 * IndexedDB's own messages are cryptic ("An internal error occurred"), so every
 * failure carries a sentence a user can act on.
 */
export class StorageError extends Error {
  readonly operation: StorageOperation
  readonly userMessage: string

  constructor(operation: StorageOperation, userMessage: string, cause?: unknown) {
    super(`${operation}: ${userMessage}`, { cause })
    this.name = 'StorageError'
    this.operation = operation
    this.userMessage = userMessage
  }
}

export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError
}

/**
 * True when the browser exposes a usable IndexedDB.
 *
 * Some private browsing modes expose the API but reject writes, so callers must
 * still handle errors. This only catches "not supported at all".
 */
export function isIndexedDbAvailable(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    indexedDB !== null &&
    typeof indexedDB.open === 'function'
  )
}

function storageFailure(
  operation: StorageOperation,
  userMessage: string,
  cause?: unknown,
): StorageError {
  return new StorageError(operation, userMessage, cause)
}

/**
 * Cached connection. Opening is expensive and IndexedDB is per-origin, so one
 * connection is shared for the life of the tab.
 */
let dbPromise: Promise<IDBDatabase> | null = null

/**
 * `onversionchange` fires when another tab upgrades the schema. The connection
 * must be closed there or the other tab's upgrade blocks forever.
 */
function watchForVersionChange(db: IDBDatabase): void {
  db.onversionchange = () => {
    db.close()
    dbPromise = null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise

  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(
        storageFailure(
          'open',
          'This browser cannot store contacts on the device, so nothing will be saved.',
        ),
      )
      return
    }

    let request: IDBOpenDBRequest

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (cause) {
      reject(
        storageFailure(
          'open',
          'This browser is blocking device storage, so contacts cannot be saved.',
          cause,
        ),
      )
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result

      if (db.objectStoreNames.contains(CONTACT_STORE)) return

      const store = db.createObjectStore(CONTACT_STORE, { keyPath: 'id' })

      // Ordering and grouping indexes. Search runs in memory because
      // IndexedDB cannot do substring matching on a useful index.
      store.createIndex('createdAt', 'createdAt', { unique: false })
      store.createIndex('updatedAt', 'updatedAt', { unique: false })
      store.createIndex('company', 'fields.company', { unique: false })
    }

    request.onsuccess = () => {
      watchForVersionChange(request.result)
      resolve(request.result)
    }

    request.onerror = () => {
      reject(
        storageFailure(
          'open',
          'The contact database could not be opened. Check that this browser is not blocking site data.',
          request.error,
        ),
      )
    }

    // Another tab is holding an older connection open.
    request.onblocked = () => {
      reject(
        storageFailure(
          'open',
          'Another CardVault tab is open with an older version. Close it and reload this page.',
          request.error,
        ),
      )
    }
  })

  /*
   * Any failure clears the cache. Without this the rejected promise would be
   * reused for the rest of the tab's life and the dashboard's "Try again" button
   * could never recover, even once storage started working.
   */
  dbPromise = pending.catch((error: unknown) => {
    dbPromise = null
    throw error
  })

  return dbPromise
}

/**
 * Runs one request in a transaction and resolves once the transaction commits.
 *
 * The result is read in `oncomplete` rather than on the request's own success
 * event: for writes that is the only point where the value is guaranteed final.
 */
async function runTransaction<T>(
  operation: StorageOperation,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()

  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction
    let request: IDBRequest<T>

    try {
      tx = db.transaction(CONTACT_STORE, mode)
      request = work(tx.objectStore(CONTACT_STORE))
    } catch (cause) {
      reject(
        storageFailure(
          operation,
          'The contact database rejected the request. The device may be out of space.',
          cause,
        ),
      )
      return
    }

    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () =>
      reject(
        storageFailure(
          operation,
          'That change could not be saved and was rolled back.',
          tx.error,
        ),
      )
    tx.onerror = () =>
      reject(
        storageFailure(
          operation,
          'The contact database could not complete the request.',
          tx.error,
        ),
      )
  })
}

/**
 * Guards against rows written by an older build, a manual edit or a partial
 * migration. `fields` is the only part the UI cannot work without, so a row
 * without it is ignored rather than crashing a screen.
 */
function isUsableContact(value: unknown): value is Contact {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<Contact>

  return (
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.fields === 'object' &&
    candidate.fields !== null
  )
}

function newestFirst(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const byDate = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

    return byDate !== 0 ? byDate : b.id.localeCompare(a.id)
  })
}

/**
 * Inserts a new contact and returns the stored record.
 *
 * Uses `add` rather than `put`, so a repeated save can never quietly overwrite
 * an existing row. Callers also guard against double submits; if one slips
 * through it surfaces here instead of silently duplicating a person.
 */
export async function addContact(contact: Contact): Promise<Contact> {
  await runTransaction('add', 'readwrite', (store) => store.add(contact))

  return contact
}

/** Every stored contact, newest first. */
export async function getAllContacts(): Promise<Contact[]> {
  const records = await runTransaction<unknown[]>('list', 'readonly', (store) =>
    store.getAll(),
  )

  return newestFirst(records.filter(isUsableContact))
}

/** One contact, or null when the id is unknown. */
export async function getContactById(id: string): Promise<Contact | null> {
  const record = await runTransaction<unknown>('get', 'readonly', (store) =>
    store.get(id),
  )

  return isUsableContact(record) ? record : null
}

/**
 * Saves edited fields and stamps `updatedAt`.
 *
 * The id, `createdAt`, `ocr` and `sourceImage` are taken from the *stored* row
 * rather than trusted from the caller: OCR text and image metadata are the
 * record of what the card said and must survive an edit untouched. If the id no
 * longer exists the transaction aborts, so a stale edit screen cannot
 * resurrect a deleted contact.
 */
export async function updateContact(contact: Contact): Promise<Contact> {
  const now = new Date().toISOString()
  const db = await openDatabase()

  return new Promise<Contact>((resolve, reject) => {
    let tx: IDBTransaction

    try {
      tx = db.transaction(CONTACT_STORE, 'readwrite')
    } catch (cause) {
      reject(
        storageFailure(
          'update',
          'The change could not be saved. The device may be out of space.',
          cause,
        ),
      )
      return
    }

    const store = tx.objectStore(CONTACT_STORE)
    const read = store.get(contact.id)

    let merged: Contact | null = null

    read.onsuccess = () => {
      const existing = read.result

      if (!isUsableContact(existing)) {
        // Aborting stops a stale edit screen from resurrecting a deleted contact.
        tx.abort()
        return
      }

      merged = { ...existing, fields: contact.fields, updatedAt: now }
      store.put(merged)
    }

    tx.oncomplete = () => {
      if (merged === null) {
        reject(storageFailure('update', 'The change could not be saved.'))
        return
      }

      resolve(merged)
    }

    tx.onabort = () =>
      reject(
        storageFailure(
          'update',
          'This contact no longer exists, so the change was not saved.',
          tx.error,
        ),
      )

    tx.onerror = () =>
      reject(
        storageFailure(
          'update',
          'The change could not be saved.',
          tx.error,
        ),
      )
  })
}

/** Removes a contact. Resolves to false when the id was already gone. */
export async function deleteContact(id: string): Promise<boolean> {
  const db = await openDatabase()

  return new Promise<boolean>((resolve, reject) => {
    let tx: IDBTransaction

    try {
      tx = db.transaction(CONTACT_STORE, 'readwrite')
    } catch (cause) {
      reject(
        storageFailure(
          'delete',
          'The contact could not be deleted. The device may be out of space.',
          cause,
        ),
      )
      return
    }

    const store = tx.objectStore(CONTACT_STORE)
    const read = store.get(id)
    let existed = false

    read.onsuccess = () => {
      existed = isUsableContact(read.result)
      store.delete(id)
    }

    tx.oncomplete = () => resolve(existed)
    tx.onabort = () =>
      reject(
        storageFailure('delete', 'The deletion was rolled back.', tx.error),
      )
    tx.onerror = () =>
      reject(
        storageFailure(
          'delete',
          'The contact could not be deleted.',
          tx.error,
        ),
      )
  })
}

/**
 * Contacts for an explicit id list, in the order the ids were given.
 *
 * Entry point for "export selected". Unknown ids are skipped rather than
 * throwing, so a selection made before a delete cannot fail an export.
 */
export async function getContactsByIds(ids: string[]): Promise<Contact[]> {
  if (ids.length === 0) return []

  const all = await getAllContacts()
  const byId = new Map(all.map((contact) => [contact.id, contact]))
  const seen = new Set<string>()
  const selected: Contact[] = []

  for (const id of ids) {
    if (seen.has(id)) continue

    const contact = byId.get(id)

    if (contact === undefined) continue

    seen.add(id)
    selected.push(contact)
  }

  return selected
}

/** Stored contact count, without hydrating every record into the UI. */
export async function getContactCount(): Promise<number> {
  return runTransaction('count', 'readonly', (store) => store.count())
}

export interface ContactCompanyGroup {
  /**
   * Trimmed company name, or `''` for contacts without one.
   *
   * An empty string is the key for the catch-all bucket because it is
   * unambiguous: unlike a label such as "No company", it can never also be a
   * real company name.
   */
  key: string
  /** True when this is the catch-all bucket of contacts with no company. */
  catchAll: boolean
  contacts: Contact[]
}

/**
 * Contacts grouped by company, for spreadsheet export and company filters.
 *
 * Pure and synchronous so it can also run over an already-loaded list. Contacts
 * without a company land in one labelled bucket instead of being dropped.
 */
export function groupContactsByCompany(
  contacts: Contact[],
): ContactCompanyGroup[] {
  const groups = new Map<string, Contact[]>()

  for (const contact of contacts) {
    // `asText` because a stored record can hold a non-string company.
    const key = asText(contact.fields?.company).trim()
    const existing = groups.get(key)

    if (existing === undefined) groups.set(key, [contact])
    else existing.push(contact)
  }

  return [...groups.entries()]
    .map(([key, groupContacts]) => ({
      key,
      catchAll: key === '',
      contacts: groupContacts,
    }))
    .sort((a, b) => {
      // The catch-all bucket always sorts last.
      if (a.catchAll) return 1
      if (b.catchAll) return -1

      return a.key.localeCompare(b.key)
    })
}

/**
 * Drops the cached connection.
 *
 * Only needed by tests and by a future "clear local data" action; normal use
 * keeps one connection for the life of the tab.
 */
export async function closeDatabase(): Promise<void> {
  const pending = dbPromise
  dbPromise = null

  if (pending === null) return

  try {
    const db = await pending
    db.close()
  } catch {
    // Nothing to close when the connection never opened.
  }
}
