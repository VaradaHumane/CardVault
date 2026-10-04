import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addContact as addContactToDb,
  deleteContact as deleteContactFromDb,
  getAllContacts,
  getContactCount,
  getContactsByIds,
  groupContactsByCompany,
  isIndexedDbAvailable,
  isStorageError,
  updateContact as updateContactInDb,
} from '../lib/db'
import type { ContactCompanyGroup } from '../lib/db'
import type { Contact } from '../types/contact'

export type ContactsStatus = 'loading' | 'ready' | 'error'

/**
 * Result of a write. Screens handle storage problems by showing the message, so
 * failures travel as values instead of exceptions.
 */
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface UseContactsResult {
  contacts: Contact[]
  status: ContactsStatus
  /** Message to show when the vault could not be read at all. */
  error: string | null
  /** False when the browser cannot use IndexedDB at all. */
  storageAvailable: boolean
  /** Length of the loaded list. */
  count: number
  /** Count reported by `getContactCount`, i.e. straight from storage. */
  storedCount: number
  getContact: (id: string | null) => Contact | null
  addContact: (contact: Contact) => Promise<StorageResult<Contact>>
  updateContact: (contact: Contact) => Promise<StorageResult<Contact>>
  deleteContact: (id: string) => Promise<StorageResult<boolean>>
  /** Re-reads the whole vault. Used for retry and for storage errors. */
  reload: () => Promise<void>
  /** Id-ordered contacts for a future "export selected". */
  getSelectedContacts: (ids: string[]) => Promise<Contact[]>
  /** Company buckets for a future "export grouped by company". */
  getGroupedByCompany: () => Promise<ContactCompanyGroup[]>
}

function describe(error: unknown): string {
  if (isStorageError(error)) return error.userMessage

  if (error instanceof Error && error.message !== '') return error.message

  return 'The contact database could not be reached.'
}

function newestFirst(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const byDate = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

    return byDate !== 0 ? byDate : b.id.localeCompare(a.id)
  })
}

/**
 * Single owner of the contact list.
 *
 * Every screen reads from here, so IndexedDB is written in exactly one place and
 * the dashboard can never drift from what is stored. The list is loaded once on
 * startup and patched in place after each write, which is what keeps a save
 * from feeling like a reload.
 */
export function useContacts(): UseContactsResult {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [status, setStatus] = useState<ContactsStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [storedCount, setStoredCount] = useState(0)

  /**
   * Bumped by every write. A load that started before a write must not replace
   * the freshly patched list with the stale rows it read.
   */
  const writeVersionRef = useRef(0)

  /** Guards against a second write for the same contact while one is in flight. */
  const pendingRef = useRef<Set<string>>(new Set())

  const refreshStoredCount = useCallback(async () => {
    try {
      setStoredCount(await getContactCount())
    } catch {
      // The list itself is the source of truth for the UI; a failed count read
      // should not blank the screen.
    }
  }, [])

  const load = useCallback(async () => {
    const writeVersionAtStart = writeVersionRef.current

    try {
      const stored = await getAllContacts()

      // A save or delete landed while this read was in flight: that state is
      // newer, so it wins.
      if (writeVersionRef.current !== writeVersionAtStart) return

      setContacts(stored)
      setStatus('ready')
      setError(null)
      setStorageAvailable(true)
      void refreshStoredCount()
    } catch (cause) {
      if (writeVersionRef.current !== writeVersionAtStart) return

      setStorageAvailable(isIndexedDbAvailable())
      setStatus('error')
      setError(describe(cause))
    }
  }, [refreshStoredCount])



  /**
   * Runs one write at a time per contact id.
   *
   * The review form can be submitted twice before React re-renders, and iOS
   * double-taps are a real thing. Without this a single contact could be stored
   * twice; the second call returns the in-flight result instead.
   */
  const runExclusive = useCallback(
    async <T,>(id: string, write: () => Promise<T>): Promise<StorageResult<T>> => {
      if (pendingRef.current.has(id)) {
        return {
          ok: false,
          error: 'That contact is already being saved. Please wait a moment.',
        }
      }

      pendingRef.current.add(id)

      try {
        return { ok: true, value: await write() }
      } catch (cause) {
        return { ok: false, error: describe(cause) }
      } finally {
        pendingRef.current.delete(id)
      }
    },
    [],
  )

  const addContact = useCallback(
    (contact: Contact) =>
      runExclusive(contact.id, async () => {
        const saved = await addContactToDb(contact)

        writeVersionRef.current += 1

        setContacts((current) => {
          // Keyed insert: re-adding a known id replaces it instead of
          // duplicating the person in the list.
          const without = current.filter((item) => item.id !== saved.id)

          return newestFirst([saved, ...without])
        })

        void refreshStoredCount()

        return saved
      }),
    [refreshStoredCount, runExclusive],
  )

  const updateContact = useCallback(
    (contact: Contact) =>
      runExclusive(contact.id, async () => {
        const saved = await updateContactInDb(contact)

        writeVersionRef.current += 1

        setContacts((current) =>
          current.map((item) => (item.id === saved.id ? saved : item)),
        )

        void refreshStoredCount()

        return saved
      }),
    [refreshStoredCount, runExclusive],
  )

  const deleteContact = useCallback(
    (id: string) =>
      runExclusive(id, async () => {
        const removed = await deleteContactFromDb(id)

        writeVersionRef.current += 1

        setContacts((current) => current.filter((item) => item.id !== id))

        void refreshStoredCount()

        return removed
      }),
    [refreshStoredCount, runExclusive],
  )

  const getSelectedContacts = useCallback(
    (ids: string[]) => getContactsByIds(ids),
    [],
  )

  const getGroupedByCompany = useCallback(
    async () => groupContactsByCompany(await getAllContacts()),
    [],
  )

  // Initial load. `load` sets state only after the IndexedDB read resolves, so
  // this is a subscription-style effect rather than a render-time update.
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    if (hasLoadedRef.current) return

    hasLoadedRef.current = true
    void load()
  }, [load])

  const byId = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  )

  const getContact = useCallback(
    (id: string | null) => (id === null ? null : (byId.get(id) ?? null)),
    [byId],
  )

  return {
    contacts,
    status,
    error,
    storageAvailable,
    count: contacts.length,
    storedCount,
    getContact,
    addContact,
    updateContact,
    deleteContact,
    reload: load,
    getSelectedContacts,
    getGroupedByCompany,
  }
}
