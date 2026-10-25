import { Link, useApp, usePath } from './state'
import { BookingPage } from './pages/Booking'
import { CommandsPage } from './pages/Commands'
import { DashboardPage } from './pages/Dashboard'
import { DeviceSwitcher } from './components'
import { DevicePage } from './pages/Device'
import { HistoryPage } from './pages/History'
import { PlayersPage } from './pages/Players'
import { SessionDetailPage, SessionsPage } from './pages/Sessions'
import { SettingsPage } from './pages/Settings'

const NAV = [
  { to: '/', label: 'Übersicht' },
  { to: '/spieler', label: 'Spieler' },
  { to: '/abende', label: 'Abende' },
  { to: '/historie', label: 'Historie' },
  { to: '/buchen', label: 'Buchen' },
  { to: '/auftraege', label: 'Aufträge', badge: true },
  { to: '/einstellungen', label: 'Einstellungen' },
  { to: '/geraete', label: 'Geräte' },
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
          <h1>Nicht gefunden</h1>
          <p className="muted">
            Diese Seite gibt es nicht. <Link to="/">Zur Übersicht</Link>
          </p>
        </div>
      )
  }
}

export function App() {
  const path = usePath()
  const { pending, email, role, devNoAuth } = useApp()

  const links = (className?: string) =>
    NAV.map((item) => (
      <Link key={item.to} to={item.to} className={`${className ?? ''} ${isActive(path, item.to) ? 'active' : ''}`}>
        <span>{item.label}</span>
        {item.badge && pending.length > 0 ? <span className="count">{pending.length}</span> : null}
      </Link>
    ))

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-title">Schockboard</div>
            <div className="brand-sub">Verwaltung</div>
          </div>
        </div>
        <DeviceSwitcher />
        <nav className="nav">{links()}</nav>
        <div className="sidebar-foot">
          {devNoAuth ? <div className="badge danger" style={{ marginBottom: 8 }}>DEV – ohne Anmeldung</div> : null}
          {role ? (
            <div className={`badge ${role === 'admin' ? 'yellow' : 'info'}`} style={{ marginBottom: 8 }}>
              {role === 'admin' ? 'Administrator' : 'Verwalter'}
            </div>
          ) : null}
          {email ? <div>Angemeldet als {email}</div> : null}
        </div>
      </aside>
      <div>
        <header className="mobile-bar">
          <div className="brand-mark" style={{ width: 36, height: 36, fontSize: 18 }}>
            S
          </div>
          <div className="brand-title">Schockboard</div>
          {devNoAuth ? <span className="badge danger">DEV</span> : null}
          {role ? <span className={`badge ${role === 'admin' ? 'yellow' : 'info'}`}>{role === 'admin' ? 'Admin' : 'Verwalter'}</span> : null}
          <DeviceSwitcher compact />
        </header>
        <nav className="mobile-nav">{links()}</nav>
        <main className="main">
          <Route key={path} path={path} />
        </main>
      </div>
    </div>
  )
}
