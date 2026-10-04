import { Callout } from '../components/Callout'
import { useScreenFocus } from '../hooks/useScreenFocus'
import { InstallGuide } from '../components/InstallGuide'
import { OfflineOcrStatus } from '../components/OfflineOcrStatus'
import './screens.css'

type SettingsScreenProps = {
  /**
   * Whether this screen is the one currently on show. Screens stay mounted so
   * an in-progress scan survives a tab change, so the heading has to be
   * re-focused every time the panel becomes visible again.
   */
  active?: boolean

  contactCount: number
  /** Count reported straight from IndexedDB by `getContactCount`. */
  storedCount: number
  storageAvailable: boolean
  /** Opens the Export Centre, which lives inside the settings panel. */
  onOpenExport: () => void
}

export function SettingsScreen({
  active = true,
  contactCount,
  storedCount,
  storageAvailable,
  onOpenExport,
}: SettingsScreenProps) {
  const headingRef = useScreenFocus<HTMLHeadingElement>(active)

  const storageLabel = storageAvailable
    ? 'On this device (browser storage)'
    : 'Unavailable in this browser'

  return (
    <div className="screen">
      <header>
        <h1 className="screen__heading" ref={headingRef} tabIndex={-1}>
          Settings
        </h1>
        <p className="screen__lede">
          Preferences for this device. Nothing here syncs to an account.
        </p>
      </header>

      <section className="panel" aria-labelledby="app-settings-heading">
        <h2 className="section-title" id="app-settings-heading">
          App
        </h2>

        <dl className="detail-list">
          <div className="detail-list__row">
            <dt className="detail-list__term">Theme</dt>
            <dd className="detail-list__value">Warm beige (light)</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__term">Storage</dt>
            <dd className="detail-list__value">{storageLabel}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__term">Contacts saved</dt>
            <dd className="detail-list__value">{contactCount}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__term">Records in database</dt>
            <dd className="detail-list__value">{storedCount}</dd>
          </div>
          <div className="detail-list__row">
            <dt className="detail-list__term">Text recognition</dt>
            <dd className="detail-list__value">
              On-device (Tesseract.js), not always accurate
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="install-heading">
        <h2 className="section-title" id="install-heading">
          Add CardVault to your Home Screen
        </h2>
        <p className="note">
          Installed, CardVault opens like a normal app with no browser bars, and
          opens straight from your Home Screen with no connection.
        </p>
        <InstallGuide />
      </section>

      <section className="panel" aria-labelledby="offline-heading">
        <h2 className="section-title" id="offline-heading">
          Working offline
        </h2>
        <p className="note">
          Once CardVault has opened once, the app itself is stored on this device
          and works with no connection. Browsing, searching, editing, deleting and
          saving contacts all keep working, and exports are still generated
          locally.
        </p>
        <OfflineOcrStatus />
      </section>

      <section className="panel" aria-labelledby="export-heading">
        <h2 className="section-title" id="export-heading">
          Export
        </h2>
        <p className="note">
          Save every card as a real Excel workbook or as a vCard file, or pick just
          the contacts or companies you need. The file is built in your browser.
        </p>
        <div className="export-actions">
          <button
            type="button"
            className="button-primary"
            onClick={onOpenExport}
            disabled={contactCount === 0}
          >
            Open export centre
          </button>
        </div>
        {contactCount === 0 && (
          <p className="note">
            Scan a business card first — then you will have something to export.
          </p>
        )}
      </section>

      <Callout tone="info" title="How your contacts are kept">
        <p>
          Contacts are stored in this browser on this device using IndexedDB. They
          survive a refresh, a closed tab and a restart. Nothing is uploaded, and
          there is no account or sync.
        </p>
        <p>
          Installing CardVault does not create a backup. If you clear browsing
          data, remove the app, or switch device, the contacts go with it, and
          exports are not stored by CardVault either.
        </p>
        <p>
          If you only ever use CardVault in a Safari tab, iOS may clear unused
          site data after about a week. Adding it to your Home Screen makes that
          much less likely, and exporting regularly is the real safeguard.
        </p>
      </Callout>

      <Callout tone="warning" title="Keep an export you control">
        <p>
          A browser can be asked to free up space, and private browsing clears
          everything when the window closes. If that happens, the contacts cannot
          be recovered from CardVault.
        </p>
        <p>
          Export a copy to a file you keep somewhere safe, now and then, and always
          before clearing site data, updating your browser, or changing device. A
          vCard file (.vcf) is best for moving contacts into another address book;
          the Excel workbook is best for looking at and sorting the list.
        </p>
        <div className="export-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={onOpenExport}
            disabled={contactCount === 0}
          >
            Open export centre
          </button>
        </div>
      </Callout>
    </div>
  )
}