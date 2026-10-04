import type { ReactNode } from 'react'
import { AlertIcon, CheckIcon, InfoIcon } from './Icon'
import './Callout.css'

export type CalloutTone = 'info' | 'success' | 'warning' | 'error'

type CalloutProps = {
  tone: CalloutTone
  title: string
  children?: ReactNode
  /**
   * Whether this message appeared in response to something the user just did.
   *
   * Errors that arrive as a result of an action use `alert`, which interrupts.
   */
  live?: boolean
  /**
   * Overrides how insistently the message is announced.
   *
   * Successes default to `status` (polite) even when `live` is set: a completed
   * delete or export does not need to interrupt whatever the user is reading,
   * and two assertive messages in a row are exhausting.
   */
  politeness?: 'assertive' | 'polite'
}

const TONE_ICONS: Record<CalloutTone, ReactNode> = {
  info: <InfoIcon />,
  success: <CheckIcon />,
  warning: <AlertIcon />,
  error: <AlertIcon />,
}

export function Callout({
  tone,
  title,
  children,
  live = false,
  politeness,
}: CalloutProps) {
  // `alert` for a live error, `status` for everything else. `role="note"` was
  // used here before: it is not a valid ARIA role, so every non-live callout
  // resolved to `generic` and was announced with no role at all.
  const resolvedPoliteness: 'assertive' | 'polite' =
    politeness ?? (live && tone === 'error' ? 'assertive' : 'polite')

  return (
    <div
      className={`callout callout--${tone}`}
      role={resolvedPoliteness === 'assertive' ? 'alert' : 'status'}
    >
      <span className="callout__icon" aria-hidden="true">
        {TONE_ICONS[tone]}
      </span>
      <div className="callout__body">
        <p className="callout__title">{title}</p>
        {children !== undefined && <div className="callout__text">{children}</div>}
      </div>
    </div>
  )
}
