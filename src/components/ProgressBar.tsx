import './ProgressBar.css'

type ProgressBarProps = {
  /** Completion from 0 to 1. */
  value: number
  label: string
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    /*
     * `role="progressbar"` on its own is never announced when its value
     * changes, so a screen reader user had no idea recognition had even started.
     * The live region sits on the caption rather than the track: announcing the
     * whole bar would read out every one-percent step, whereas the caption
     * changes once per stage and is coalesced by the screen reader.
     */
    <div className="progress">
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${label} (${percent}%)`}
        aria-label={label}
      >
        <div className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress__caption" role="status" aria-live="polite">
        <span className="progress__label">{label}</span>
        <span className="progress__percent">{percent}%</span>
      </p>
    </div>
  )
}
