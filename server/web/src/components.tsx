import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

import { formatCurrency, formatDateTime, formatSignedCurrency } from '@/domain/format'
import { playerColor, playerInitials } from '@/theme/tokens'

import type { ApiError, DeviceSummary, StoredCommand } from './api'
import { Sparkline } from './charts/Sparkline'
import { Icon, type IconName } from './icons'
import { useCountUp } from './motion'
import { WEB_THEME } from './theme'
import { Link, pendingDebtEffect, useApp } from './state'

// ---- layout ----------------------------------------------------------------

/** Compact screen header (app: ScreenHeader) + content stack. */
export function Page(props: { title: string; context?: ReactNode; icon?: IconName; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`page ${props.wide ? 'wide' : ''}`}>
      <header className="page-head">
        {props.icon ? (
          <span className="page-icon" aria-hidden>
            <Icon name={props.icon} size={18} />
          </span>
        ) : null}
        <div className="page-titles">
          <h1>{props.title}</h1>
          {props.context ? <div className="page-context">{props.context}</div> : null}
        </div>
        {props.actions ? <div className="page-actions">{props.actions}</div> : null}
      </header>
      <div className="page-body">{props.children}</div>
    </div>
  )
}

export function Card(props: {
  title?: ReactNode
  eyebrow?: string
  icon?: IconName
  actions?: ReactNode
  className?: string
  tone?: 'default' | 'hero' | 'flat'
  children: ReactNode
  id?: string
  'aria-label'?: string
}) {
  const hasHead = props.title || props.actions || props.eyebrow
  return (
    <section className={`card ${props.tone && props.tone !== 'default' ? props.tone : ''} ${props.className ?? ''}`} id={props.id} aria-label={props['aria-label']}>
      {hasHead ? (
        <div className="card-head">
          {props.icon ? (
            <span className="card-icon" aria-hidden>
              <Icon name={props.icon} size={16} />
            </span>
          ) : null}
          <div className="card-titles">
            {props.eyebrow ? <div className="overline">{props.eyebrow}</div> : null}
            {props.title ? <h2>{props.title}</h2> : null}
          </div>
          {props.actions ? <div className="card-actions">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

// ---- controls --------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

export function Button({
  variant = 'secondary',
  size,
  icon,
  iconRight,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'lg'; icon?: IconName; iconRight?: IconName }) {
  return (
    <button type={type} className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className ?? ''}`} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 15 : 17} /> : null}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  tone,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; tone?: 'danger' | 'accent' }) {
  return (
    <button type="button" className={`icon-btn ${tone ?? ''} ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={17} />
    </button>
  )
}

export type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'pending'

export function Badge(props: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${props.tone && props.tone !== 'default' ? props.tone : ''}`} title={props.title}>
      {props.icon ? <Icon name={props.icon} size={12} /> : null}
      {props.children}
    </span>
  )
}

export function Segmented<T extends string>(props: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'sm'
}) {
  return (
    <div className={`segmented ${props.size ?? ''}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={props.value === option.value}
          className={props.value === option.value ? 'active' : ''}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Single-select filter chips (app: Chip). */
export function Chips<T extends string>(props: {
  options: Array<{ value: T; label: string; count?: number; icon?: IconName }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={props.value === option.value}
          className={`chip ${props.value === option.value ? 'selected' : ''}`}
          onClick={() => props.onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          {option.label}
          {option.count !== undefined ? <span className="chip-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Field(props: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${props.className ?? ''}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  )
}

// ---- identity & numbers ------------------------------------------------------

/** Player identity, same colour (FNV-1a of the id) and initials as the app. */
export function Avatar(props: { id: string; name: string; size?: number; ring?: boolean; muted?: boolean }) {
  const size = props.size ?? 32
  const tint = props.muted ? 'var(--subtle)' : playerColor(props.id)
  return (
    <span
      className={`avatar ${props.ring ? 'ring' : ''}`}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        color: tint,
        background: `color-mix(in srgb, ${tint} ${props.muted ? 12 : 18}%, transparent)`,
        borderColor: props.ring ? 'var(--accent)' : `color-mix(in srgb, ${tint} 35%, transparent)`,
      }}
    >
      {playerInitials(props.name)}
    </span>
  )
}

export function PlayerName(props: { id: string; name: string; sub?: ReactNode; size?: number; muted?: boolean }) {
  return (
    <span className="player-name">
      <Avatar id={props.id} name={props.name} size={props.size ?? 30} muted={props.muted} />
      <span className="player-name-text">
        <span className="player-name-title">{props.name}</span>
        {props.sub ? <span className="player-name-sub">{props.sub}</span> : null}
      </span>
    </span>
  )
}

export function Money({ cents, debt = false, signed = false, className }: { cents: number; debt?: boolean; signed?: boolean; className?: string }) {
  const cls = debt ? (cents > 0 ? 'debt' : cents < 0 ? 'credit' : '') : ''
  return <span className={`amount ${cls} ${className ?? ''}`}>{signed ? formatSignedCurrency(cents) : formatCurrency(cents)}</span>
}

/** Balance bar: debt grows to the right in accent, credit in success. */
export function BalanceBar({ cents, max }: { cents: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, Math.abs(cents) / max) : 0
  return (
    <span className="balance-bar" aria-hidden>
      <span className={`balance-fill ${cents < 0 ? 'credit' : ''}`} style={{ width: `${cents === 0 ? 0 : Math.max(3, ratio * 100)}%` }} />
    </span>
  )
}

export function KpiTile(props: {
  label: string
  value: number | null
  icon: IconName
  hint?: ReactNode
  sparkline?: number[]
  sparkColor?: string
  tone?: 'default' | 'hero'
  valueTone?: 'default' | 'accent' | 'success' | 'danger'
  format?: (cents: number) => string
  onClick?: () => void
}) {
  const shown = useCountUp(props.value ?? 0)
  const format = props.format ?? formatCurrency
  const Tag = props.onClick ? 'button' : 'section'
  return (
    <Tag className={`card kpi ${props.tone === 'hero' ? 'hero' : ''} ${props.onClick ? 'clickable' : ''}`} onClick={props.onClick} type={props.onClick ? 'button' : undefined}>
      <div className="kpi-top">
        <span className="kpi-icon" aria-hidden>
          <Icon name={props.icon} size={15} />
        </span>
        <span className="kpi-label">{props.label}</span>
      </div>
      {props.value === null ? (
        <Skeleton height={40} width="60%" />
      ) : (
        <div className="kpi-main">
          <span className={`kpi-value ${props.valueTone ?? ''}`} aria-label={`${props.label}: ${format(props.value)}`}>
            <span aria-hidden>{format(shown)}</span>
          </span>
          {props.sparkline && props.sparkline.length > 1 ? (
            <span className="kpi-spark">
              <Sparkline values={props.sparkline} color={props.sparkColor ?? WEB_THEME.accent} label={`${props.label}, Verlauf`} />
            </span>
          ) : null}
        </div>
      )}
      {props.hint ? <div className="kpi-hint">{props.hint}</div> : null}
    </Tag>
  )
}

export function StatTile(props: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; tone?: 'accent' | 'success' | 'danger' }) {
  return (
    <div className={`stat ${props.tone ?? ''}`}>
      <div className="stat-label">
        {props.icon ? <Icon name={props.icon} size={13} /> : null}
        {props.label}
      </div>
      <div className="stat-value">{props.value}</div>
      {props.hint ? <div className="stat-hint">{props.hint}</div> : null}
    </div>
  )
}

// ---- loading, empty, errors ---------------------------------------------------

export function Skeleton(props: { height?: number | string; width?: number | string; radius?: number; className?: string }) {
  return (
    <span
      className={`skeleton ${props.className ?? ''}`}
      aria-hidden
      style={{ height: props.height ?? 14, width: props.width ?? '100%', borderRadius: props.radius }}
    />
  )
}

export function SkeletonRows({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Wird geladen">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          {avatar ? <Skeleton width={30} height={30} radius={15} /> : null}
          <div style={{ flex: 1, display: 'grid', gap: 6 }}>
            <Skeleton width={`${55 - ((index * 13) % 25)}%`} height={12} />
            <Skeleton width={`${30 + ((index * 17) % 20)}%`} height={10} />
          </div>
          <Skeleton width={64} height={14} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div className="skeleton-chart" style={{ height }} aria-busy="true" aria-label="Diagramm wird geladen">
      {Array.from({ length: 14 }, (_, index) => (
        <Skeleton key={index} height={`${28 + ((index * 37) % 60)}%`} width="100%" radius={4} />
      ))}
    </div>
  )
}

/** Loading placeholder for a page body. */
export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid two">
      <section className="card">
        <SkeletonRows rows={rows} avatar />
      </section>
      <section className="card">
        <SkeletonChart height={200} />
      </section>
    </div>
  )
}

export function EmptyState(props: { icon: IconName; title: string; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${props.compact ? 'compact' : ''}`}>
      <span className="empty-icon" aria-hidden>
        <Icon name={props.icon} size={20} />
      </span>
      <div className="empty-title">{props.title}</div>
      {props.text ? <div className="empty-text">{props.text}</div> : null}
      {props.action}
    </div>
  )
}

export function Notice(props: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'override'; icon?: IconName; children: ReactNode; className?: string }) {
  const tone = props.tone ?? 'info'
  const icon: IconName = props.icon ?? (tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : tone === 'override' ? 'flash' : 'info')
  return (
    <div className={`notice ${tone} ${props.className ?? ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} size={16} />
      <div className="notice-body">{props.children}</div>
    </div>
  )
}

export function ErrorView({ error }: { error: ApiError }) {
  if (error.code === 'no_snapshot') {
    return (
      <EmptyState
        icon="cloud-up"
        title="Noch kein Datenstand"
        text={
          <>
            Sobald die App auf diesem Gerät gestartet wird, verbindet sie sich automatisch und lädt ihren Stand hoch – dann erscheinen hier alle
            Daten.
          </>
        }
        action={
          <Link to="/geraete" className="btn btn-secondary btn-sm">
            Zu den Geräten
          </Link>
        }
      />
    )
  }
  return <Notice tone="danger">{error.message}</Notice>
}

// ---- commands & sync -----------------------------------------------------------

const STATUS_BADGES: Record<StoredCommand['status'], { label: string; tone: Tone; icon: IconName }> = {
  pending: { label: 'ausstehend', tone: 'pending', icon: 'time' },
  applied: { label: 'übernommen', tone: 'success', icon: 'check' },
  rejected: { label: 'abgelehnt', tone: 'danger', icon: 'alert' },
  cancelled: { label: 'storniert', tone: 'default', icon: 'undo' },
}

export function StatusBadge({ status }: { status: StoredCommand['status'] }) {
  const badge = STATUS_BADGES[status]
  return (
    <Badge tone={badge.tone} icon={badge.icon}>
      {badge.label}
    </Badge>
  )
}

/** Pending, not yet applied effects – shown next to the real numbers, never merged into them. */
export function PendingHints({ commands }: { commands: StoredCommand[] }) {
  if (commands.length === 0) return null
  return (
    <div className="pending-note">
      {commands.map((command) => (
        <Badge key={command.id} tone="pending" icon="time" title="Wird beim nächsten Hintergrund-Sync vom Gerät übernommen">
          {pendingDebtEffect(command)}
        </Badge>
      ))}
    </div>
  )
}

export function SyncHint() {
  const { selectedDevice, activeDevices } = useApp()
  const name = selectedDevice ? `„${selectedDevice.label}“` : 'das Gerät'
  return (
    <Notice tone="info" icon="sync">
      Aufträge gelten nur für {name}
      {activeDevices.length > 1 ? ' (jedes Gerät ist eine eigene Kasse)' : ''} und werden dort still beim nächsten Hintergrund-Sync übernommen
      (meist innerhalb von 1–15 Min.) – ohne Eintrag im Protokoll der App. Die Zahlen stammen immer aus dem letzten hochgeladenen Stand.
    </Notice>
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

const FRESHNESS_LABEL = { ok: 'aktuell', warn: 'länger nicht gesehen', bad: 'offline' } as const

export function Dot({ state, live = false, label }: { state: 'ok' | 'warn' | 'bad'; live?: boolean; label?: string }) {
  return <span className={`dot ${state} ${live && state === 'ok' ? 'live' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function SyncStatus() {
  const { status } = useApp()
  if (!status) return <SkeletonRows rows={2} />
  const seen = status.paired ? freshness(status.lastSeenAt) : 'bad'
  return (
    <div className="sync-status">
      <div className="sync-line">
        <Dot state={seen} live label={FRESHNESS_LABEL[seen]} />
        <span>
          Gerät zuletzt gesehen <strong>{status.paired ? relativeTime(status.lastSeenAt) : 'noch nicht verbunden'}</strong>
        </span>
      </div>
      <div className="sync-line">
        <Dot state={freshness(status.lastSnapshotAt)} label={FRESHNESS_LABEL[freshness(status.lastSnapshotAt)]} />
        <span>
          Letzter Stand <strong>{relativeTime(status.lastSnapshotAt)}</strong>
          {status.snapshotCreatedAt ? <span className="muted"> · erstellt {formatDateTime(status.snapshotCreatedAt)}</span> : null}
        </span>
      </div>
      {status.snapshotFromPreviousDevice ? (
        <Notice tone="warning">Angezeigt wird noch ein übernommener Stand eines früheren Geräts. Dieses Gerät ersetzt ihn beim nächsten Hochladen.</Notice>
      ) : null}
    </div>
  )
}

// ---- devices ----------------------------------------------------------------

/** Joined within the last 24 hours. */
export function isNewDevice(device: DeviceSummary) {
  return Date.now() - new Date(device.pairedAt).getTime() < 24 * 3_600_000
}

export function DeviceDot({ device, live = false }: { device: DeviceSummary; live?: boolean }) {
  const state = device.status === 'blocked' ? 'bad' : freshness(device.lastSeenAt)
  return <Dot state={state} live={live} label={device.status === 'blocked' ? 'gesperrt' : FRESHNESS_LABEL[state]} />
}

/**
 * Picks the device (= Kasse) every page and command form works on. Lives in
 * the top bar; a listbox with arrow-key navigation.
 */
export function DeviceSwitcher({ compact = false }: { compact?: boolean }) {
  const { activeDevices, selectedDevice, selectDevice } = useApp()
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (open) ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focusIndex]?.focus()
  }, [open, focusIndex])

  // Command palette: "Gerät wechseln" opens this menu.
  useEffect(() => {
    const openMenu = () => {
      if (activeDevices.length > 1) {
        setFocusIndex(Math.max(0, activeDevices.findIndex((device) => device.id === selectedDevice?.id)))
        setOpen(true)
      }
    }
    window.addEventListener('schockboard:device-menu', openMenu)
    return () => window.removeEventListener('schockboard:device-menu', openMenu)
  }, [activeDevices, selectedDevice])

  if (activeDevices.length === 0) {
    return (
      <div className="device-switch empty">
        <Dot state="bad" /> {compact ? null : <span className="small muted">Kein Gerät verbunden</span>}
      </div>
    )
  }
  const multiple = activeDevices.length > 1

  function onKeyDown(event: KeyboardEvent) {
    if (!open) return
    if (event.key === 'ArrowDown') setFocusIndex((index) => (index + 1) % activeDevices.length)
    else if (event.key === 'ArrowUp') setFocusIndex((index) => (index - 1 + activeDevices.length) % activeDevices.length)
    else if (event.key === 'Home') setFocusIndex(0)
    else if (event.key === 'End') setFocusIndex(activeDevices.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false)
      if (event.key === 'Escape') buttonRef.current?.focus()
      return
    } else return
    event.preventDefault()
  }

  return (
    <div className={`device-switch ${compact ? 'compact' : ''}`} ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="device-switch-button"
        onClick={() => {
          if (!multiple) return
          setFocusIndex(Math.max(0, activeDevices.findIndex((device) => device.id === selectedDevice?.id)))
          setOpen((value) => !value)
        }}
        aria-haspopup={multiple ? 'listbox' : undefined}
        aria-expanded={multiple ? open : undefined}
        aria-controls={multiple ? listId : undefined}
        aria-label={`Gerät: ${selectedDevice?.label ?? '–'}${multiple ? ' – wechseln' : ''}`}
        disabled={!multiple}
      >
        <Icon name="tablet" size={16} />
        <span className="device-switch-text">
          <span className="device-switch-label">{selectedDevice?.label ?? '–'}</span>
          {compact ? null : <span className="device-switch-sub">zuletzt gesehen {relativeTime(selectedDevice?.lastSeenAt ?? null)}</span>}
        </span>
        {selectedDevice ? <DeviceDot device={selectedDevice} live /> : null}
        {multiple ? <Icon name="chevron-down" size={15} className="device-switch-caret" /> : null}
      </button>
      {open ? (
        <div className="device-switch-menu menu" role="listbox" id={listId} aria-label="Gerät wählen">
          {activeDevices.map((device, index) => (
            <button
              key={device.id}
              type="button"
              role="option"
              tabIndex={index === focusIndex ? 0 : -1}
              aria-selected={device.id === selectedDevice?.id}
              className={device.id === selectedDevice?.id ? 'active' : ''}
              onClick={() => {
                selectDevice(device.id)
                setOpen(false)
                buttonRef.current?.focus()
              }}
            >
              <DeviceDot device={device} />
              <span className="device-switch-text">
                <span className="device-switch-label">
                  {device.label} {isNewDevice(device) ? <Badge tone="info">Neu</Badge> : null}
                </span>
                <span className="device-switch-sub">zuletzt gesehen {relativeTime(device.lastSeenAt)}</span>
              </span>
              {device.pendingCommands > 0 ? (
                <span className="count" title="ausstehende Aufträge">
                  {device.pendingCommands}
                </span>
              ) : null}
              {device.id === selectedDevice?.id ? <Icon name="check" size={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
