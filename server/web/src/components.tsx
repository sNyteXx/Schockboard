import { useEffect, useRef, useState, type ReactNode } from 'react'

import { formatCurrency, formatDateTime } from '@/domain/format'

import type { ApiError, DeviceSummary, StoredCommand } from './api'
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
            Sobald die App auf diesem Gerät gestartet wird, verbindet sie sich automatisch und lädt ihren Stand hoch – dann erscheinen hier alle
            Daten. <Link to="/geraete">Geräte</Link>
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
  const { selectedDevice, activeDevices } = useApp()
  const name = selectedDevice ? `„${selectedDevice.label}“` : 'das Gerät'
  return (
    <div className="banner info">
      <span aria-hidden>⟳</span>
      <div className="small">
        Aufträge gelten nur für {name}
        {activeDevices.length > 1 ? ' (jedes Gerät ist eine eigene Kasse)' : ''} und werden dort still beim nächsten Hintergrund-Sync
        übernommen (meist innerhalb von 1–15 Min.) – ohne Eintrag im Protokoll der App. Die angezeigten Zahlen stammen immer aus dem
        letzten hochgeladenen Stand dieses Geräts.
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
      {status.snapshotFromPreviousDevice ? (
        <div className="banner warn small">
          Angezeigt wird noch ein übernommener Stand eines früheren Geräts. Dieses Gerät ersetzt ihn beim nächsten Hochladen.
        </div>
      ) : null}
    </div>
  )
}

// ---- devices ----------------------------------------------------------------

/** Joined within the last 24 hours. */
export function isNewDevice(device: DeviceSummary) {
  return Date.now() - new Date(device.pairedAt).getTime() < 24 * 3_600_000
}

export function DeviceDot({ device }: { device: DeviceSummary }) {
  return <span className={`dot ${device.status === 'blocked' ? 'bad' : freshness(device.lastSeenAt)}`} />
}

/**
 * Picks the device (= Kasse) every page and command form works on. Shown in
 * the sidebar and the mobile top bar.
 */
export function DeviceSwitcher({ compact = false }: { compact?: boolean }) {
  const { activeDevices, selectedDevice, selectDevice } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  if (activeDevices.length === 0) {
    return compact ? null : (
      <div className="device-switch empty">
        <span className="dot bad" /> <span className="small muted">Kein Gerät verbunden</span>
      </div>
    )
  }
  const multiple = activeDevices.length > 1

  return (
    <div className={`device-switch ${compact ? 'compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="device-switch-button"
        onClick={() => multiple && setOpen((value) => !value)}
        aria-haspopup={multiple ? 'listbox' : undefined}
        aria-expanded={multiple ? open : undefined}
        disabled={!multiple}
        title={multiple ? 'Gerät wechseln' : undefined}
      >
        {selectedDevice ? <DeviceDot device={selectedDevice} /> : null}
        <span className="device-switch-text">
          <span className="device-switch-label">{selectedDevice?.label ?? '–'}</span>
          {compact ? null : <span className="device-switch-sub">zuletzt gesehen {relativeTime(selectedDevice?.lastSeenAt ?? null)}</span>}
        </span>
        {selectedDevice && selectedDevice.pendingCommands > 0 ? <span className="count">{selectedDevice.pendingCommands}</span> : null}
        {multiple ? <span className="device-switch-caret" aria-hidden>▾</span> : null}
      </button>
      {open ? (
        <div className="device-switch-menu" role="listbox" aria-label="Gerät wählen">
          {activeDevices.map((device) => (
            <button
              key={device.id}
              type="button"
              role="option"
              aria-selected={device.id === selectedDevice?.id}
              className={device.id === selectedDevice?.id ? 'active' : ''}
              onClick={() => {
                selectDevice(device.id)
                setOpen(false)
              }}
            >
              <DeviceDot device={device} />
              <span className="device-switch-text">
                <span className="device-switch-label">
                  {device.label} {isNewDevice(device) ? <span className="badge info">Neu</span> : null}
                </span>
                <span className="device-switch-sub">zuletzt gesehen {relativeTime(device.lastSeenAt)}</span>
              </span>
              {device.pendingCommands > 0 ? <span className="count" title="ausstehende Aufträge">{device.pendingCommands}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
