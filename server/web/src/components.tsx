import type { ReactNode } from 'react'

import { formatCurrency, formatDateTime } from '@/domain/format'

import type { ApiError, StoredCommand } from './api'
import { Link, pendingDebtEffect, useApp } from './state'

export function Page(props: { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          {props.eyebrow ? <div className="eyebrow">{props.eyebrow}</div> : null}
          <h1>{props.title}</h1>
        </div>
        {props.actions ? <div className="row">{props.actions}</div> : null}
      </div>
      <div className="stack" style={{ gap: 18 }}>
        {props.children}
      </div>
    </div>
  )
}

export function Card(props: { title?: string; className?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {props.title || props.actions ? (
        <div className="spread" style={{ marginBottom: 12 }}>
          {props.title ? <h2 style={{ margin: 0 }}>{props.title}</h2> : <span />}
          {props.actions}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

export function Loading() {
  return (
    <div className="grid cols-2">
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  )
}

export function ErrorView({ error }: { error: ApiError }) {
  if (error.code === 'no_snapshot') {
    return (
      <div className="banner warn">
        <div>
          <strong>Noch kein Datenstand.</strong>
          <div className="muted">
            Sobald die App auf dem Gerät gestartet wird, verbindet sie sich automatisch und lädt ihren Stand hoch – dann erscheinen hier alle Daten.{' '}
            <Link to="/geraet">Gerätestatus</Link>
          </div>
        </div>
      </div>
    )
  }
  return <div className="banner error">{error.message}</div>
}

export function Money({ cents, debt = false }: { cents: number; debt?: boolean }) {
  const cls = debt ? (cents > 0 ? 'debt' : cents < 0 ? 'neg' : '') : ''
  return <span className={`amount ${cls}`}>{formatCurrency(cents)}</span>
}

const STATUS_BADGES: Record<StoredCommand['status'], { label: string; cls: string }> = {
  pending: { label: 'ausstehend', cls: 'pending' },
  applied: { label: 'übernommen', cls: 'success' },
  rejected: { label: 'abgelehnt', cls: 'danger' },
  cancelled: { label: 'storniert', cls: '' },
}

export function StatusBadge({ status }: { status: StoredCommand['status'] }) {
  const badge = STATUS_BADGES[status]
  return <span className={`badge ${badge.cls}`}>{badge.label}</span>
}

/** Pending, not yet applied effects – shown next to the real numbers, never merged into them. */
export function PendingHints({ commands }: { commands: StoredCommand[] }) {
  if (commands.length === 0) return null
  return (
    <div className="pending-note">
      {commands.map((command) => (
        <span key={command.id} className="badge pending" title="Wird beim nächsten Hintergrund-Sync vom Gerät übernommen">
          ausstehend: {pendingDebtEffect(command)}
        </span>
      ))}
    </div>
  )
}

export function SyncHint() {
  return (
    <div className="banner info">
      <span aria-hidden>⟳</span>
      <div className="small">
        Änderungen werden beim nächsten Hintergrund-Sync vom Gerät übernommen. Die angezeigten Zahlen stammen immer aus dem
        letzten hochgeladenen Stand des Geräts.
      </div>
    </div>
  )
}

export function relativeTime(value: string | null) {
  if (!value) return 'nie'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  if (days < 14) return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`
  return formatDateTime(value)
}

export function freshness(value: string | null): 'ok' | 'warn' | 'bad' {
  if (!value) return 'bad'
  const hours = (Date.now() - new Date(value).getTime()) / 3_600_000
  return hours < 6 ? 'ok' : hours < 48 ? 'warn' : 'bad'
}

export function SyncStatus() {
  const { status } = useApp()
  if (!status) return null
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row small">
        <span className={`dot ${status.paired ? freshness(status.lastSeenAt) : 'bad'}`} />
        <span>
          Gerät zuletzt gesehen: <strong>{status.paired ? relativeTime(status.lastSeenAt) : 'noch nicht verbunden'}</strong>
        </span>
      </div>
      <div className="row small">
        <span className={`dot ${freshness(status.lastSnapshotAt)}`} />
        <span>
          Letzter Stand: <strong>{relativeTime(status.lastSnapshotAt)}</strong>
          {status.snapshotCreatedAt ? <span className="muted"> (erstellt {formatDateTime(status.snapshotCreatedAt)})</span> : null}
        </span>
      </div>
    </div>
  )
}
