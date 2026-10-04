import { useInstallPrompt } from '../hooks/useInstallPrompt'

/**
 * Installation instructions for the device CardVault is running on.
 *
 * There is no fake install button. A real one appears only when the browser
 * reports that it can install the app, via the `beforeinstallprompt` event.
 * Everything else is written-out steps, because iOS has no such event and the
 * Share menu is the only route to the Home Screen there.
 */

export function InstallGuide() {
  const { canPrompt, isInstalled, isIos, install } = useInstallPrompt()

  if (isInstalled) {
    return (
      <p className="note">
        CardVault is installed and running from your Home Screen. It opens like a
        normal app and keeps working with no connection.
      </p>
    )
  }

  return (
    <>
      {canPrompt && (
        <div className="export-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => void install()}
          >
            Install CardVault
          </button>
        </div>
      )}

      {isIos ? (
        <>
          <p className="note">On iPhone or iPad, using Safari:</p>
          <ol className="guide-steps">
            <li>Tap the Share button in the Safari toolbar.</li>
            <li>
              Choose <strong>Add to Home Screen</strong> in the share sheet. On
              iOS 16 and later it is at the top; on earlier versions you may need
              to scroll down the list of actions.
            </li>
            <li>
              Confirm the name <strong>CardVault</strong>, then tap{' '}
              <strong>Add</strong>.
            </li>
            <li>Open CardVault from your Home Screen.</li>
          </ol>
        </>
      ) : (
        <>
          <p className="note">On Android, Chrome or Edge:</p>
          <ol className="guide-steps">
            <li>
              Open the browser menu, the three dots in the top right.
            </li>
            <li>
              Choose <strong>Install app</strong> or{' '}
              <strong>Add to Home screen</strong>.
            </li>
            <li>Confirm, then open CardVault from your Home Screen or app list.</li>
          </ol>
          <p className="note">
            On a desktop browser the same option appears in the address bar, next
            to the bookmark star.
          </p>
        </>
      )}
    </>
  )
}