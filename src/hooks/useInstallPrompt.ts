import { useCallback, useEffect, useState } from 'react'

/**
 * Detects installability and exposes the browser's own install prompt.
 *
 * Android and desktop Chromium fire a `beforeinstallprompt` event that can be
 * held on to and re-triggered, which is the only way to show a genuine install
 * button. iOS Safari has no equivalent, so nothing is offered there and the
 * user is shown the Share menu steps instead.
 *
 * No install button is ever rendered without a real prompt behind it, so the
 * app cannot offer an action that silently does nothing.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallPromptState {
  /** The browser has offered a native install prompt that can be shown. */
  canPrompt: boolean
  /** The app is already running from the Home Screen. */
  isInstalled: boolean
  /** iPhone, iPad or iPod, where installation goes through the Share menu. */
  isIos: boolean
  /** Asks the browser to show its install prompt. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

/** True when the app is running as an installed Home Screen app. */
function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false

  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true

  // iOS Safari exposes this on the navigator instead.
  return (
    'standalone' in navigator &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false

  // iPadOS 13+ reports a desktop Safari user agent, so touch points are the
  // only reliable signal there.
  const touchMac = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)

  return /iPad|iPhone|iPod/.test(navigator.userAgent) || touchMac
}

/** Window slot used to hold the browser's prompt event until the user asks. */
type InstallWindow = Window & {
  __cardVaultInstallPrompt?: BeforeInstallPromptEvent
}

export function useInstallPrompt(): InstallPromptState {
  const [canPrompt, setCanPrompt] = useState(false)
  const [isInstalled, setIsInstalled] = useState(detectInstalled)
  // The platform cannot change while the app is open, so this is read once.
  const [isIos] = useState(detectIos)

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress the browser's own mini-infobar so the Settings screen can offer
      // the prompt in context, with the offline notes next to it.
      event.preventDefault()
      ;(window as InstallWindow).__cardVaultInstallPrompt =
        event as BeforeInstallPromptEvent
      setCanPrompt(true)
    }

    const onInstalled = () => {
      ;(window as InstallWindow).__cardVaultInstallPrompt = undefined
      setCanPrompt(false)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const query = window.matchMedia?.('(display-mode: standalone)')

    // Fires when the app is launched from the Home Screen in a browser tab.
    query?.addEventListener('change', (event) => setIsInstalled(event.matches))

    // `isInstalled` starts from `detectInstalled()` at first render, so there is
    // nothing to re-check here; the listener above covers later changes.

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      query?.removeEventListener('change', (event) => setIsInstalled(event.matches))
      ;(window as InstallWindow).__cardVaultInstallPrompt = undefined
    }
  }, [])

  const install = useCallback(async () => {
    const pending = (window as InstallWindow).__cardVaultInstallPrompt

    if (pending === undefined) return 'unavailable' as const

    await pending.prompt()
    const { outcome } = await pending.userChoice

    if (outcome === 'accepted') {
      ;(window as InstallWindow).__cardVaultInstallPrompt = undefined
      setCanPrompt(false)
      setIsInstalled(true)
    }

    return outcome
  }, [])

  return { canPrompt, isInstalled, isIos, install }
}