import { WebTableLock } from './table-lock'
import { AchievementsPage } from './pages/Achievements'
import { useEffect, useState } from 'react'

import { formatCurrency } from '@/domain/format'

import { ActionsProvider, useActions } from './actions'
import type { DeviceCashbox } from './api'
import { Badge, Button, DeviceSwitcher, Dot, EmptyState, freshness, IconButton, relativeTime } from './components'
import { Icon, type IconName } from './icons'
import { BookingPage } from './pages/Booking'
import { CommandsPage } from './pages/Commands'
import { DashboardPage } from './pages/Dashboard'
import { DevicePage } from './pages/Device'
import { HistoryPage } from './pages/History'
import { PlayersPage } from './pages/Players'
import { SessionDetailPage, SessionsPage } from './pages/Sessions'
import { SettingsPage } from './pages/Settings'
import { Link, navigate, useApi, useApp, usePath } from './state'

const NAV: Array<{ to: string; label: string; icon: IconName; badge?: 'pending' }> = [
  { to: '/', label: 'Kommandozentrale', icon: 'grid' },
  { to: '/spieler', label: 'Spieler', icon: 'people' },
  { to: '/abende', label: 'Abende', icon: 'calendar' },
  { to: '/erfolge', label: 'Erfolge & Rückblick', icon: 'star' },
  { to: '/historie', label: 'Historie', icon: 'time' },
  { to: '/buchen', label: 'Buchen', icon: 'cash' },
  { to: '/auftraege', label: 'Aufträge', icon: 'layers', badge: 'pending' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' },
  { to: '/geraete', label: 'Geräte', icon: 'tablet' },
]

function isActive(path: string, to: string) {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)
}

function Route({ path }: { path: string }) {
  const session = /^\/abende\/([^/]+)$/.exec(path)
  if (session) return <SessionDetailPage sessionId={decodeURIComponent(session[1])} />
  switch (path) {
    case '/':
      return <DashboardPage />
    case '/erfolge': return <AchievementsPage />
    case '/spieler':
      return <PlayersPage />
    case '/abende':
      return <SessionsPage />
    case '/historie':
      return <HistoryPage />
    case '/buchen':
      return <BookingPage />
    case '/auftraege':
      return <CommandsPage />
    case '/einstellungen':
      return <SettingsPage />
    case '/geraete':
    case '/geraet':
      return <DevicePage />
    default:
      return (
        <div className="page">
          <EmptyState
            icon="search"
            title="Seite nicht gefunden"
            text="Diese Seite gibt es nicht."
            action={
              <Link to="/" className="btn btn-secondary btn-sm">
                Zur Kommandozentrale
              </Link>
            }
          />
        </div>
      )
  }
}

/** Every active device at a glance: live dot, last upload, pending commands, running evening, cash. */
function StatusStrip() {
  const { activeDevices, device: selected, selectDevice } = useApp()
  const strip = useApi<DeviceCashbox[]>(activeDevices.length > 0 ? '/devices/cashbox' : null)
  if (activeDevices.length === 0) return null
  const byId = new Map((strip.data ?? []).map((entry) => [entry.deviceId, entry]))
  return (
    <div className="status-strip" role="group" aria-label="Status aller Geräte">
      {activeDevices.map((device) => {
        const entry = byId.get(device.id)
        const seen = freshness(device.lastSeenAt)
        const isSelected = device.id === selected
        return (
          <button
            key={device.id}
            type="button"
            className={`strip-item ${isSelected ? 'active' : ''}`}
            onClick={() => selectDevice(device.id)}
            aria-pressed={isSelected}
            aria-label={`${device.label}: zuletzt gesehen ${relativeTime(device.lastSeenAt)}, ${device.pendingCommands} ausstehend${
              entry?.openSession ? `, Abend „${entry.openSession.title}“ läuft` : ''
            }${isSelected ? ' (ausgewählt)' : ''}`}
          >
            <Dot state={seen} live />
            <span className="strip-label">{device.label}</span>
            <span className="strip-meta">
              <Icon name="cloud-up" size={13} /> {relativeTime(device.lastSnapshotAt)}
            </span>
            {device.pendingCommands > 0 ? (
              <span className="strip-meta pending">
                <Icon name="layers" size={13} /> {device.pendingCommands}
              </span>
            ) : null}
            {entry?.openSession ? (
              <span className="strip-meta live">
                <Icon name="pulse" size={13} /> {entry.openSession.title}
              </span>
            ) : null}
            {entry?.cashbox ? (
              <span className="strip-meta cash">
                <Icon name="wallet" size={13} /> {formatCurrency(entry.cashbox.cashOnHandCents)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function SearchButton() {
  const { openPalette } = useActions()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <button type="button" className="search-button" onClick={openPalette} aria-label="Suche und Befehle öffnen" aria-keyshortcuts="Control+K Meta+K /">
      <Icon name="search" size={16} />
      <span className="search-placeholder">Spieler, Abende, Buchungen, Aktionen…</span>
      <span className="search-keys" aria-hidden>
        <kbd>{mac ? '⌘' : 'Strg'}</kbd>
        <kbd>K</kbd>
      </span>
    </button>
  )
}

function QuickButtons() {
  const { openBooking } = useActions()
  const { activeDevices } = useApp()
  if (activeDevices.length === 0) return null
  return (
    <div className="quick-buttons">
      <Button variant="primary" size="sm" icon="cash-in" onClick={() => openBooking('payment')}>
        Zahlung
      </Button>
      <Button variant="secondary" size="sm" icon="cash-out" onClick={() => openBooking('withdrawal')}>
        Entnahme
      </Button>
    </div>
  )
}

function Shell() {
  const path = usePath()
  const { pending, email, role, devNoAuth } = useApp()
  const { openPalette } = useActions()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [path])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const current = NAV.find((item) => isActive(path, item.to))

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>
      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="brand">
          <img src="/next-icon.png" alt="" width={48} height={48} />
          <span className="brand-text">
            <span className="brand-title">Schockboard Next</span>
            <span className="brand-sub">Kommandozentrale</span>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${isActive(path, item.to) ? 'active' : ''}`} aria-current={isActive(path, item.to) ? 'page' : undefined}>
              <Icon name={item.icon} size={18} />
              <span className="nav-label">{item.label}</span>
              {item.badge && pending.length > 0 ? (
                <span className="count" aria-label={`${pending.length} ausstehend`}>
                  {pending.length}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="nav-item" onClick={openPalette}>
            <Icon name="keyboard" size={18} />
            <span className="nav-label">Befehle</span>
            <kbd>/</kbd>
          </button>
          <div className="who">
            {devNoAuth ? <Badge tone="danger" icon="alert">DEV – ohne Anmeldung</Badge> : null}
            {role ? (
              <Badge tone={role === 'admin' ? 'accent' : 'info'} icon="shield">
                {role === 'admin' ? 'Administrator' : 'Verwalter'}
              </Badge>
            ) : null}
            {email ? <div className="who-email" title={email}>{email}</div> : null}
          </div>
        </div>
      </aside>
      <button type="button" className="sidebar-scrim" aria-label="Menü schließen" tabIndex={-1} onClick={() => setMenuOpen(false)} />
      <div className="workspace">
        <header className="topbar">
          <IconButton icon="menu" label="Menü" className="menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
          <button type="button" className="topbar-title" onClick={() => navigate('/')} aria-label="Zur Kommandozentrale">
            <img src="/next-icon.png" alt="" width={32} height={32} />
            <span>{current?.label ?? 'Schockboard'}</span>
          </button>
          <SearchButton />
          <QuickButtons />
          <DeviceSwitcher />
          <WebTableLock />
        </header>
        <StatusStrip />
        <main className="main" id="main" tabIndex={-1}>
          <Route key={path} path={path} />
        </main>
      </div>
    </div>
  )
}

export function App() {
  return (
    <ActionsProvider>
      <Shell />
    </ActionsProvider>
  )
}
