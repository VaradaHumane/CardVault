import type { ReactNode } from 'react'
import { ContactsIcon, ScanIcon, SettingsIcon } from './Icon'
import './BottomNav.css'

export type TabId = 'scan' | 'contacts' | 'settings'

type NavItem = {
  id: TabId
  label: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'scan', label: 'Scan', icon: <ScanIcon /> },
  { id: 'contacts', label: 'Contacts', icon: <ContactsIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

type BottomNavProps = {
  activeTab: TabId
  onSelect: (tab: TabId) => void
}

export function BottomNav({ activeTab, onSelect }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <ul className="bottom-nav__list">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeTab

          return (
            <li key={item.id} className="bottom-nav__item">
              <button
                type="button"
                className="bottom-nav__link"
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="bottom-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="bottom-nav__label">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
