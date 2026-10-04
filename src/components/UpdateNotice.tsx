import { Callout } from './Callout'
import './UpdateNotice.css'

/**
 * Update and offline notices for the service worker.
 *
 * Both messages are informational and neither changes the app on its own. The
 * update is only applied when the button is pressed, so a scan in progress is
 * never interrupted by a background download.
 */

type UpdateNoticeProps = {
  updateReady: boolean
  offlineReady: boolean
  onApplyUpdate: () => void
  onDismissUpdate: () => void
  onDismissOfflineReady: () => void
}

export function UpdateNotice({
  updateReady,
  offlineReady,
  onApplyUpdate,
  onDismissUpdate,
  onDismissOfflineReady,
}: UpdateNoticeProps) {
  if (!updateReady && !offlineReady) return null

  return (
    <div className="app__notices">
      {updateReady && (
        <Callout tone="info" title="A new version of CardVault is ready">
          <p>
            It was downloaded in the background. Your contacts are already saved,
            so it is safe to update now, or later if you are part-way through a
            scan.
          </p>
          <div className="export-actions">
            <button
              type="button"
              className="button-primary"
              onClick={onApplyUpdate}
            >
              Update now
            </button>
            <button type="button" className="button-secondary" onClick={onDismissUpdate}>
              Not now
            </button>
          </div>
        </Callout>
      )}

      {offlineReady && (
        <Callout tone="success" title="CardVault now works offline">
          <p>
            The app is stored on this device, so you can open it, search and edit
            contacts with no connection.
          </p>
          <div className="export-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={onDismissOfflineReady}
            >
              Got it
            </button>
          </div>
        </Callout>
      )}
    </div>
  )
}