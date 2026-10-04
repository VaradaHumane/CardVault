import { useId, useMemo, useState } from 'react'
import { useScreenFocus } from '../hooks/useScreenFocus'
import { Callout } from '../components/Callout'
import {
  CardIcon,
  ContactsIcon,
  RefreshIcon,
  ScanIcon,
  SearchIcon,
} from '../components/Icon'
import { searchContacts } from '../lib/search'
import {
  contactDisplayDetail,
  contactDisplayName,
  contactDisplayRole,
} from '../types/contact'
import type { Contact } from '../types/contact'
import type { ContactsStatus } from '../hooks/useContacts'
import './screens.css'
import './Dashboard.css'

type DashboardProps = {
  /** Name of the contact just deleted, so the list can confirm it. */
  deletedName?: string | null

  /** Clears the delete confirmation. */
  onDismissDeleted?: () => void

  /**
   * Whether this screen is the one currently on show. Screens stay mounted so
   * an in-progress scan survives a tab change, so the heading has to be
   * re-focused every time the panel becomes visible again.
   */
  active?: boolean

  contacts: Contact[]
  status: ContactsStatus
  error: string | null
  storageAvailable: boolean
  onRetry: () => void
  onOpenContact: (id: string) => void
  onStartScan: () => void
}

export function Dashboard({
  active = true,
  deletedName = null,
  onDismissDeleted,
  contacts,
  status,
  error,
  storageAvailable,
  onRetry,
  onOpenContact,
  onStartScan,
}: DashboardProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>(active)
  const searchId = useId()
  const [query, setQuery] = useState('')

  const isLoading = status === 'loading'

  const results = useMemo(
    () => searchContacts(contacts, query),
    [contacts, query],
  )

  const isFiltered = query.trim() !== ''
  const hasStoredContacts = contacts.length > 0

  return (
    <div className="screen">
      <header className="dashboard__header">
        <span className="dashboard__mark" aria-hidden="true">
          <CardIcon />
        </span>
        <div>
          <h1 className="screen__heading" ref={headingRef} tabIndex={-1}>
            CardVault
          </h1>
          <p className="screen__lede">
            Scan business cards and keep every contact on this device.
          </p>
        </div>
      </header>

      {/*
        Deleting a contact returns to this list with no element focused, so this
        is the only feedback the user gets. It is a `status` rather than an
        `alert` because a successful delete does not need to interrupt.
      */}
      {deletedName !== null && deletedName !== '' && (
        <Callout tone="success" title="Contact deleted" politeness="polite">
          <p>
            {deletedName} was removed from this device. This cannot be undone.
          </p>
          <button type="button" className="button-secondary" onClick={onDismissDeleted}>
            Dismiss
          </button>
        </Callout>
      )}

      {!storageAvailable && (
        <Callout tone="error" title="This browser cannot save contacts" live>
          <p>
            Device storage is unavailable, so anything you scan will be lost when
            you close the tab. Try a normal browsing window instead of private
            browsing.
          </p>
        </Callout>
      )}

      {status === 'error' && error !== null && (
        <Callout tone="error" title="Your contacts could not be opened" live>
          <p>{error}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={onRetry}
          >
            <RefreshIcon />
            Try again
          </button>
        </Callout>
      )}

      <div className="dashboard__grid">
        <section className="dashboard__action" aria-labelledby="scan-heading">
          <h2 className="section-title" id="scan-heading">
            Add a card
          </h2>

          <button
            type="button"
            className="scan-cta"
            onClick={onStartScan}
            aria-label="Scan business card"
          >
            <span className="scan-cta__icon" aria-hidden="true">
              <ScanIcon />
            </span>
            <span className="scan-cta__text">
              <span className="scan-cta__title">Scan Business Card</span>
              <span className="scan-cta__hint">
                Photograph or upload a card image
              </span>
            </span>
          </button>
        </section>

        <section className="panel" aria-labelledby="contacts-heading">
          <h2 className="section-title" id="contacts-heading">
            Contacts
            <span className="section-title__meta">
              {isLoading
                ? 'Loading…'
                : isFiltered
                  ? `${results.length} of ${contacts.length}`
                  : `${contacts.length} saved`}
            </span>
          </h2>

          {isLoading ? (
            <ul className="contact-list" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li className="contact-list__item" key={row}>
                  <span className="contact-list__badge contact-list__badge--muted">
                    <ContactsIcon />
                  </span>
                  <div className="contact-list__body">
                    <span className="skeleton skeleton--title" />
                    <span className="skeleton skeleton--line" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <>
              {hasStoredContacts && (
                <div className="search-field">
                  <label className="search-field__label" htmlFor={searchId}>
                    Search contacts
                  </label>
                  <div className="search-field__control">
                    <span className="search-field__icon" aria-hidden="true">
                      <SearchIcon />
                    </span>
                    <input
                      id={searchId}
                      className="search-field__input"
                      type="search"
                      value={query}
                      placeholder="Name, company, email or phone"
                      autoComplete="off"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <p className="search-field__hint">
                    Matches name, company, email address and phone number.
                  </p>
                </div>
              )}

              {!hasStoredContacts ? (
                <div className="empty-state">
                  <span className="empty-state__badge" aria-hidden="true">
                    <ContactsIcon />
                  </span>
                  <p className="empty-state__title">No contacts yet</p>
                  <p className="empty-state__body">
                    Cards you scan are saved to this device and will still be here
                    after you close the app.
                  </p>
                </div>
              ) : results.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <p className="empty-state__title">No matches</p>
                  <p className="empty-state__body">
                    Nothing matches “{query.trim()}”. Try a different name,
                    company, email address or phone number.
                  </p>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setQuery('')}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <ul className="contact-list">
                  {results.map((contact) => {
                    const name = contactDisplayName(contact.fields)
                    const role = contactDisplayRole(contact.fields)
                    const detail = contactDisplayDetail(contact.fields)

                    return (
                      <li className="contact-list__item" key={contact.id}>
                        <button
                          type="button"
                          className="contact-list__button"
                          onClick={() => onOpenContact(contact.id)}
                          aria-label={`Open ${name === '' ? 'unnamed contact' : name}`}
                        >
                          <span
                            className="contact-list__badge"
                            aria-hidden="true"
                          >
                            <ContactsIcon />
                          </span>
                          <span className="contact-list__body">
                            <span className="contact-list__name">
                              {name === '' ? 'Unnamed contact' : name}
                            </span>
                            {role !== '' && (
                              <span className="contact-list__role">{role}</span>
                            )}
                            {detail !== '' && (
                              <span className="contact-list__detail">
                                {detail}
                              </span>
                            )}
                          </span>
                          <span className="contact-list__chevron" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {hasStoredContacts && (
                <p className="dashboard__footnote">
                  Saved in this browser on this device. Contacts stay until you
                  delete them.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
