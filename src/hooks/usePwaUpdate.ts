import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker registration and update flow.
 *
 * The worker is registered by hand rather than by an injected script so that a
 * waiting update can be surfaced as an explicit prompt.
 *
 * That is deliberate: the worker is built with `skipWaiting: false` and
 * `clientsClaim: false`, so a new version is downloaded in the background and
 * then simply waits. Nothing changes in the running app until the user accepts
 * the update, which is what stops a half-finished scan from being replaced
 * mid-edit. Contacts are unaffected either way, because they live in IndexedDB
 * rather than in the cached shell.
 */

export interface PwaUpdateState {
  /** A new version is downloaded and waiting to be applied. */
  updateReady: boolean
  /** The shell is cached and the app will now open with no connection. */
  offlineReady: boolean
  /** Applies the waiting update, then reloads to run it. */
  applyUpdate: () => void
  /** Dismisses the update prompt without applying it. */
  dismissUpdate: () => void
  dismissOfflineReady: () => void
}

export function usePwaUpdate(): PwaUpdateState {
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)

  /**
   * The `updateSW` callback is only available once registration has happened,
   * so it is held in a ref to keep `applyUpdate` stable.
   */
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    /*
     * Ask the browser to make this origin's storage persistent.
     *
     * Every contact lives in IndexedDB with no server copy. Without this, a
     * browser is free to evict the database under storage pressure -- and iOS
     * removes script-writable storage from Safari sites the user has not
     * interacted with for about seven days. An installed app, or a site the
     * browser considers engaged, is far less likely to be cleared. Failing to
     * get persistence is not an error: the app still works, so it is silent.
     */
    void navigator.storage?.persist?.().catch(() => undefined)

    const updateSW = registerSW({
      // The shell is small enough to check straight away on load.
      immediate: true,
      onNeedRefresh() {
        setUpdateReady(true)
      },
      onOfflineReady() {
        setOfflineReady(true)
      },
      onRegisterError(error) {
        // Without a worker the app still works; it just will not open offline.
        console.warn('Service worker registration failed.', error)
      },
    })

    updateSWRef.current = updateSW

    // Ask the browser to check for a new worker when the tab comes back.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void updateSW(false)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      updateSWRef.current = null
    }
  }, [])

  const applyUpdate = useCallback(() => {
    // Tells the waiting worker to take over, then reloads onto the new version.
    void updateSWRef.current?.(true)
  }, [])

  const dismissUpdate = useCallback(() => setUpdateReady(false), [])

  const dismissOfflineReady = useCallback(() => setOfflineReady(false), [])

  return {
    updateReady,
    offlineReady,
    applyUpdate,
    dismissUpdate,
    dismissOfflineReady,
  }
}