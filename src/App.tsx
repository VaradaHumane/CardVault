import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import type { TabId } from './components/BottomNav'
import { UpdateNotice } from './components/UpdateNotice'
import { useContacts } from './hooks/useContacts'
import { usePwaUpdate } from './hooks/usePwaUpdate'
import { ContactDetailScreen } from './screens/ContactDetailScreen'
import { Dashboard } from './screens/Dashboard'
import { ExportCenter } from './screens/ExportCenter'
import { ScanScreen } from './screens/ScanScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import type { Contact, ContactFields } from './types/contact'
import { contactDisplayName } from './types/contact'

/** Human-readable tab names, used for the live-region announcements. */
const TAB_NAMES: Record<TabId, string> = {
  contacts: 'Contacts',
  scan: 'Scan',
  settings: 'Settings',
}
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('contacts')

  /** Contacts live in IndexedDB and are loaded once on startup. */
  const vault = useContacts()

  /**
   * Registers the service worker and holds back any waiting update until it is
   * asked for, so a background download cannot swap the app mid-scan.
   */
  const pwa = usePwaUpdate()

  /** Which contact the details screen is showing, if any. */
  const [openContactId, setOpenContactId] = useState<string | null>(null)

  /**
   * The Export Centre is a sub-screen of Settings rather than a fourth tab, so
   * the three-tab layout is left exactly as it was.
   */
  const [showExport, setShowExport] = useState(false)

  /** Set once a contact is deleted, so the list can confirm it. */
  const [deletedName, setDeletedName] = useState<string | null>(null)

  /**
   * The last thing that happened, for the polite live region below.
   *
   * Two outcomes are otherwise completely silent to a screen reader: switching
   * tabs (`aria-current` changing on a focused button is not announced) and
   * deleting a contact (the button that was activated is unmounted, and the app
   * returns to the list with no message at all).
   */
  const [announcement, setAnnouncement] = useState('')

  /**
   * Screen-reader announcements are only read when the text actually changes,
   * so repeating the same message twice would be silent. A zero-width space is
   * appended to force a change without being spoken.
   */
  const announce = useCallback((message: string) => {
    setAnnouncement((previous) => (previous === message ? `${message}\u200b` : message))
  }, [])

  const openContact = vault.getContact(openContactId)

  const handleSelectTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab)

      // Leaving the contacts tab closes the detail view, so coming back to
      // Contacts always lands on the list.
      if (tab !== 'contacts') setOpenContactId(null)

      // Moving between tabs also leaves the Export Centre.
      setShowExport(false)

      announce(`${TAB_NAMES[tab]} screen`)
    },
    [announce],
  )

  /**
   * Moves focus to the main region after a delete.
   *
   * Deleting returns to the contact list with no element focused, so the next
   * Tab press would restart from the top of the document.
   */
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (deletedName !== null) mainRef.current?.focus()
  }, [deletedName])

  const handleSaveContact = useCallback(
    async (contact: Contact) => {
      const result = await vault.addContact(contact)

      return result.ok ? null : result.error
    },
    [vault],
  )

  const handleUpdateContact = useCallback(
    async (fields: ContactFields) => {
      if (openContactId === null) return 'This contact is no longer open.'

      const existing = vault.getContact(openContactId)

      if (existing === null) return 'This contact no longer exists.'

      const result = await vault.updateContact({ ...existing, fields })

      return result.ok ? null : result.error
    },
    [openContactId, vault],
  )

  const handleDeleteContact = useCallback(async () => {
    if (openContactId === null) return 'This contact is no longer open.'

    const result = await vault.deleteContact(openContactId)

    if (result.ok) {
      // Read the name before the id is cleared, so the list can confirm which
      // contact went rather than just that something did.
      const removedName = openContact === null ? '' : contactDisplayName(openContact.fields)

      setOpenContactId(null)
      setDeletedName(removedName === '' ? 'Unnamed contact' : removedName)
      return null
    }

    return result.error
  }, [openContact, openContactId, vault])

  /**
   * Resolves the records an export should contain.
   *
   * `null` means the whole vault, which is already in memory from the startup
   * load. A selection is re-read through the storage service so the workbook
   * reflects what is stored right now.
   */
  const handleFetchForExport = useCallback(
    async (ids: string[] | null) =>
      ids === null ? vault.contacts : vault.getSelectedContacts(ids),
    [vault],
  )

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="app__frame">
        <UpdateNotice
          updateReady={pwa.updateReady}
          offlineReady={pwa.offlineReady}
          onApplyUpdate={pwa.applyUpdate}
          onDismissUpdate={pwa.dismissUpdate}
          onDismissOfflineReady={pwa.dismissOfflineReady}
        />

        {/*
          One polite live region for the whole app. It is always in the DOM and
          only its text changes, which is the reliable pattern: a live region
          that is inserted together with its content is announced less
          consistently across screen readers.
        */}
        <p aria-live="polite" role="status" className="visually-hidden">
          {announcement}
        </p>

        <main className="app__main" id="main-content" ref={mainRef} tabIndex={-1}>
          {/* Screens stay mounted so an in-progress scan survives tab changes. */}
          <div className="app__panel" hidden={activeTab !== 'contacts'}>
            {openContact !== null ? (
              <ContactDetailScreen
                key={openContact.id}
                active={activeTab === 'contacts'}
                contact={openContact}
                onBack={() => setOpenContactId(null)}
                onSave={handleUpdateContact}
                onDelete={handleDeleteContact}
              />
            ) : (
              <Dashboard
                active={activeTab === 'contacts'}
                deletedName={deletedName}
                onDismissDeleted={() => setDeletedName(null)}
                contacts={vault.contacts}
                status={vault.status}
                error={vault.error}
                storageAvailable={vault.storageAvailable}
                onRetry={() => void vault.reload()}
                onOpenContact={setOpenContactId}
                onStartScan={() => handleSelectTab('scan')}
              />
            )}
          </div>

          <div className="app__panel" hidden={activeTab !== 'scan'}>
            <ScanScreen
              active={activeTab === 'scan'}
              onSaveContact={handleSaveContact}
              onViewContacts={() => handleSelectTab('contacts')}
            />
          </div>

          <div className="app__panel" hidden={activeTab !== 'settings'}>
            {showExport ? (
              <ExportCenter
                active={activeTab === 'settings'}
                contacts={vault.contacts}
                onFetchForExport={handleFetchForExport}
                onBack={() => setShowExport(false)}
                onStartScan={() => handleSelectTab('scan')}
              />
            ) : (
              <SettingsScreen
                active={activeTab === 'settings'}
                contactCount={vault.count}
                storedCount={vault.storedCount}
                storageAvailable={vault.storageAvailable}
                onOpenExport={() => setShowExport(true)}
              />
            )}
          </div>
        </main>

        <BottomNav activeTab={activeTab} onSelect={handleSelectTab} />
      </div>
    </div>
  )
}

export default App
