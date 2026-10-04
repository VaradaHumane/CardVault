import { useEffect, useRef } from 'react'

/**
 * Moves keyboard focus to a screen's heading whenever that screen becomes the
 * visible one.
 *
 * Without this, every navigation in CardVault silently drops focus to
 * `<body>`: the control that was activated is either unmounted or hidden with
 * the `hidden` attribute, and the next Tab press starts again from the top of
 * the document. For a keyboard or screen-reader user that means being thrown
 * back to the skip link after every single action.
 *
 * Screens stay mounted so an in-progress scan survives a tab change, so focusing
 * on mount alone is not enough -- the heading has to be re-focused each time the
 * panel transitions from hidden to visible. That is what the `active` argument
 * tracks.
 *
 * The heading needs `tabIndex={-1}` to be focusable programmatically, which is
 * why this returns a ref rather than focusing by query.
 *
 * Focus is only moved when the element actually holds focus, so it never steals
 * focus from a control the user is interacting with inside the screen.
 */
export function useScreenFocus<T extends HTMLElement>(active = true): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const wasActive = useRef(false)

  useEffect(() => {
    if (active && !wasActive.current) {
      ref.current?.focus()
    }

    wasActive.current = active
  }, [active])

  return ref
}