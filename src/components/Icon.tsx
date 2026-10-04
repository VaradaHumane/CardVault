type IconProps = {
  className?: string
}

const baseProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

export function CardIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
      <path d="M6.5 14.5h4" />
    </svg>
  )
}

export function ScanIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M3.5 12h17" />
    </svg>
  )
}

export function ContactsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3.25" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.38" />
      <path d="M15.5 5.13a3.25 3.25 0 0 1 0 5.74" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  )
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7a1.5 1.5 0 0 0 1.3-.75l.7-1.1A1.5 1.5 0 0 1 10.5 3.5h3a1.5 1.5 0 0 1 1.3.75l.7 1.1A1.5 1.5 0 0 0 16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <circle cx="12" cy="12.5" r="3.25" />
    </svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 15.5V4" />
      <path d="M8 7.5 12 3.5l4 4" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </svg>
  )
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.75" cy="9.75" r="1.5" />
      <path d="m3.5 17 4.6-4.1a1.75 1.75 0 0 1 2.35-.05L14 16" />
      <path d="m13.5 14.5 2.1-1.9a1.75 1.75 0 0 1 2.35-.05L20.5 15" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  )
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 8.5v4.5" />
      <path d="M12 16.5h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75h.01" />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M20 11.5A8 8 0 0 0 6.2 6.4L4 8.5" />
      <path d="M4 4.5v4h4" />
      <path d="M4 12.5A8 8 0 0 0 17.8 17.6l2.2-2.1" />
      <path d="M20 19.5v-4h-4" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="11" cy="11" r="6.25" />
      <path d="m20 20-4.4-4.4" />
    </svg>
  )
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M16.4 4.6a2 2 0 0 1 2.83 0l.17.17a2 2 0 0 1 0 2.83L9.6 17.4l-4.1 1 1-4.1z" />
      <path d="M14.4 6.6 17.4 9.6" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.75A1.25 1.25 0 0 1 10.75 3.5h2.5A1.25 1.25 0 0 1 14.5 4.75V6.5" />
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
      <path d="M10.5 10.5v6" />
      <path d="M13.5 10.5v6" />
    </svg>
  )
}

export function BuildingIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 20.5V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5v15" />
      <path d="M14 10h3.5A1.5 1.5 0 0 1 19 11.5v9" />
      <path d="M3 20.5h18" />
      <path d="M7 8h4" />
      <path d="M7 12h4" />
      <path d="M16.5 14h.01" />
      <path d="M16.5 17.5h.01" />
    </svg>
  )
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 21s6.5-5.6 6.5-10.1a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.75" r="2.25" />
    </svg>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 3.75v10.5" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.75 15.75v2.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-2.5" />
    </svg>
  )
}


