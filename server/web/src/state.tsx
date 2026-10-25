import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { formatCurrency, formatDateTime, formatSignedCurrency } from '@/domain/format'

import { Icon } from './icons'
import { api, ApiError, getApiDevice, setApiDevice, type DeviceSummary, type EntryKind, type ServerStatus, type StoredCommand } from './api'

// ---- tiny router -----------------------------------------------------------

const listeners = new Set<() => void>()

const DEVICE_PARAM = 'device'
const DEVICE_STORAGE_KEY = 'schockboard.device'

function readStoredDevice() {
  try {
    return window.localStorage.getItem(DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

// The selection is applied before the first request: URL (?device=) wins over localStorage.
setApiDevice(new URLSearchParams(window.location.search).get(DEVICE_PARAM) || readStoredDevice() || null)

/** Adds (or removes) ?device=<selected> so links and reloads keep the device. */
export function withDeviceParam(to: string) {
  const url = new URL(to, window.location.origin)
  const device = getApiDevice()
  if (device) url.searchParams.set(DEVICE_PARAM, device)
  else url.searchParams.delete(DEVICE_PARAM)
  return url.pathname + url.search + url.hash
}

/** history.replaceState that keeps the device parameter. */
export function replaceUrl(to: string) {
  window.history.replaceState(null, '', withDeviceParam(to))
}

export function navigate(rawTo: string) {
  const to = withDeviceParam(rawTo)
  if (to === window.location.pathname + window.location.search) return
  window.history.pushState(null, '', to)
  listeners.forEach((listener) => listener())
  window.scrollTo({ top: 0 })
}

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return path
}

/** Current query string; updates on navigate() and back/forward. */
export function useSearch() {
  const [search, setSearch] = useState(() => window.location.search)
  useEffect(() => {
    const update = () => setSearch(window.location.search)
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return search
}

export function Link(props: { to: string; className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page'; 'aria-label'?: string }) {
  // Subscribes to the device selection so the href carries the current ?device=.
  useContext(AppContext)
  return (
    <a
      href={withDeviceParam(props.to)}
      className={props.className}
      title={props.title}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(props.to)
      }}
    >
      {props.children}
    </a>
  )
}

// ---- global app state ------------------------------------------------------

type Toast = { id: number; message: string; kind: 'ok' | 'error' }

type AppState = {
  /** Selected device id (all pages and command forms use it). */
  device: string | null
  /** All devices incl. blocked ones. */
  devices: DeviceSummary[]
  activeDevices: DeviceSummary[]
  selectedDevice: DeviceSummary | null
  selectDevice: (deviceId: string) => void
  status: ServerStatus | null
  commands: StoredCommand[]
  pending: StoredCommand[]
  email: string | null
  /** 'manager' may queue every data/override/log command but not manage the device. */
  role: 'admin' | 'manager' | null
  isAdmin: boolean
  devNoAuth: boolean
  /** Changes whenever a new snapshot or command update arrives; data hooks refetch on change. */
  revision: number
  refresh: () => Promise<void>
  toast: (message: string, kind?: Toast['kind']) => void
}

const AppContext = createContext<AppState | null>(null)

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppProvider missing')
  return value
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [device, setDevice] = useState<string | null>(() => getApiDevice())
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [commands, setCommands] = useState<StoredCommand[]>([])
  const [me, setMe] = useState<{ email: string; role: 'admin' | 'manager'; devNoAuth: boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const fingerprint = useRef('')

  const toast = useCallback((message: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, kind }])
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), kind === 'error' ? 7000 : 4200)
  }, [])

  const applyDevice = useCallback((deviceId: string | null) => {
    setApiDevice(deviceId)
    try {
      if (deviceId) window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId)
      else window.localStorage.removeItem(DEVICE_STORAGE_KEY)
    } catch {
      // private mode
    }
    replaceUrl(window.location.pathname + window.location.search)
    setDevice(deviceId)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const nextDevices = await api<DeviceSummary[]>('/devices')
      setDevices(nextDevices)
      const active = nextDevices.filter((entry) => entry.status === 'active')
      const current = getApiDevice()
      // Unknown, blocked or no selection → first active device.
      if (!current || !active.some((entry) => entry.id === current)) applyDevice(active[0]?.id ?? null)
      const selected = getApiDevice()
      const [nextStatus, nextCommands] = await Promise.all([api<ServerStatus>('/status'), api<StoredCommand[]>('/commands')])
      if (getApiDevice() !== selected) return // switched meanwhile; a newer refresh follows
      setStatus(nextStatus)
      setCommands(nextCommands)
      const print = `${selected}|${nextStatus.lastSnapshotAt}|${nextCommands.map((command) => `${command.id}:${command.status}`).join(',')}`
      if (print !== fingerprint.current) {
        fingerprint.current = print
        setRevision((value) => value + 1)
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        toast(error.message, 'error')
      }
    }
  }, [toast, applyDevice])

  const selectDevice = useCallback(
    (deviceId: string) => {
      if (deviceId === getApiDevice()) return
      applyDevice(deviceId)
      setStatus(null)
      setCommands([])
      void refresh()
    },
    [applyDevice, refresh]
  )

  useEffect(() => {
    void refresh()
    api<{ email: string; role: 'admin' | 'manager'; devNoAuth: boolean }>('/me').then(setMe, () => undefined)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 20_000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const value = useMemo<AppState>(
    () => ({
      device,
      devices,
      activeDevices: devices.filter((entry) => entry.status === 'active'),
      selectedDevice: devices.find((entry) => entry.id === device) ?? null,
      selectDevice,
      status,
      commands,
      pending: commands.filter((command) => command.status === 'pending'),
      email: me?.email ?? null,
      role: me?.role ?? null,
      isAdmin: me?.role === 'admin',
      devNoAuth: me?.devNoAuth ?? false,
      revision,
      refresh,
      toast,
    }),
    [device, devices, selectDevice, status, commands, me, revision, refresh, toast]
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite" aria-relevant="additions">
        {toasts.map((entry) => (
          <div key={entry.id} className={`toast ${entry.kind === 'error' ? 'error' : ''}`} role={entry.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={entry.kind === 'error' ? 'alert' : 'check'} size={16} />
            <span>{entry.message}</span>
            <button type="button" className="toast-close" aria-label="Hinweis schließen" onClick={() => setToasts((current) => current.filter((item) => item.id !== entry.id))}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}

// ---- data fetching ---------------------------------------------------------

export function useApi<T>(path: string | null) {
  const { revision, device } = useApp()
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  })
  const [nonce, setNonce] = useState(0)
  const loadedFor = useRef(device)

  useEffect(() => {
    if (!path) return
    let alive = true
    // Never show the previous device's numbers under another device.
    const switched = loadedFor.current !== device
    loadedFor.current = device
    setState((current) => (switched ? { data: null, error: null, loading: true } : { ...current, loading: true }))
    api<T>(path).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) =>
        alive &&
        setState({
          data: null,
          error: error instanceof ApiError ? error : new ApiError(0, 'network', 'Netzwerkfehler.'),
          loading: false,
        })
    )
    return () => {
      alive = false
    }
  }, [path, revision, nonce, device])

  return { ...state, reload: () => setNonce((value) => value + 1) }
}

// ---- command descriptions --------------------------------------------------

export const COMMAND_LABELS: Record<StoredCommand['type'], string> = {
  'correction.record': 'Korrektur',
  'payment.record': 'Zahlung',
  'player.create': 'Spieler anlegen',
  'player.update': 'Spieler ändern',
  'settings.update': 'Einstellungen',
  'loss.void': 'Eintrag löschen',
  'entry.delete': 'Buchung löschen',
  'entry.update': 'Buchung ändern',
  'player.rename': 'Spieler umbenennen',
  'session.update': 'Abend ändern',
  'session.delete': 'Abend löschen',
  'cashbox.withdraw': 'Entnahme',
  'audit.delete': 'Protokolleinträge löschen',
  'audit.purge': 'App-Protokoll leeren',
}

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  loss: 'Verlust/Bierrunde',
  payment: 'Zahlung',
  correction: 'Korrektur',
  absence: 'Abwesenheit',
  withdrawal: 'Entnahme',
}

const PENALTY_LABELS: Record<string, string> = {
  none: 'keine Abwesenheitsgebühr',
  full_average: 'voller Durchschnitt',
  split_absent: 'Durchschnitt auf Abwesende verteilt',
}

export function describeCommand(command: StoredCommand, names: Map<string, string>, sessions: Map<string, string> = new Map()) {
  const payload = command.payload
  const name = (id: unknown) => names.get(String(id)) ?? 'Unbekannter Spieler'
  const session = (id: unknown) => (sessions.get(String(id)) ? `„${sessions.get(String(id))}“` : 'Abend')
  switch (command.type) {
    case 'correction.record':
      return `${name(payload.playerId)}: ${formatSignedCurrency(Number(payload.amountCents))} – ${String(payload.reason)}`
    case 'payment.record':
      return `${name(payload.playerId)} zahlt ${formatCurrency(Number(payload.amountCents))}${payload.note ? ` (${String(payload.note)})` : ''}`
    case 'player.create':
      return `${String(payload.name)} als ${payload.isCore ? 'Stammspieler' : 'Gast'}`
    case 'player.update': {
      const parts: string[] = []
      if (payload.isCore !== undefined) parts.push(payload.isCore ? 'wird Stammspieler' : 'kein Stammspieler mehr')
      if (payload.isArchived !== undefined) parts.push(payload.isArchived ? 'wird archiviert' : 'wird reaktiviert')
      return `${name(payload.playerId)} ${parts.join(', ')}`
    }
    case 'settings.update':
      return `Einsatz ${formatCurrency(Number(payload.defaultStakeCents))}, Kasse „${String(payload.cashboxLabel)}“, ${
        PENALTY_LABELS[String(payload.absencePenaltyMode)] ?? String(payload.absencePenaltyMode)
      }`
    case 'loss.void':
      return `Eintrag von ${name(payload.playerId)} löschen`
    case 'entry.delete':
      return `${ENTRY_KIND_LABELS[payload.kind as EntryKind] ?? 'Buchung'} löschen`
    case 'entry.update':
      return `${ENTRY_KIND_LABELS[payload.kind as EntryKind] ?? 'Buchung'}: ${describeEntryUpdate(payload)}`
    case 'player.rename':
      return `${name(payload.playerId)} heißt künftig „${String(payload.name)}“`
    case 'session.update':
      return `${session(payload.sessionId)}: ${describeSessionUpdate(payload)}`
    case 'session.delete':
      return `${session(payload.sessionId)} mit allen Buchungen löschen`
    case 'cashbox.withdraw':
      return `${formatCurrency(Number(payload.amountCents))} aus der Kasse – ${String(payload.note)}`
    case 'audit.delete': {
      const count = Array.isArray(payload.auditIds) ? payload.auditIds.length : 0
      return `${count} ${count === 1 ? 'Protokolleintrag' : 'Protokolleinträge'} der App löschen`
    }
    case 'audit.purge':
      return payload.before ? `App-Protokoll vor dem ${formatDateTime(String(payload.before))} leeren` : 'Gesamtes App-Protokoll leeren'
  }
}

export function describeEntryUpdate(payload: Record<string, unknown>) {
  const parts: string[] = []
  if (payload.amountCents !== undefined) parts.push(`Betrag → ${formatCurrency(Number(payload.amountCents))}`)
  if (payload.note !== undefined) parts.push(payload.note ? `Notiz → „${String(payload.note)}“` : 'Notiz entfernt')
  return parts.join(', ')
}

export function describeSessionUpdate(payload: Record<string, unknown>) {
  const parts: string[] = []
  if (payload.title !== undefined) parts.push(`Titel → „${String(payload.title)}“`)
  if (payload.stakeCents !== undefined) parts.push(`Einsatz → ${formatCurrency(Number(payload.stakeCents))}`)
  return parts.join(', ')
}

// ---- pending overrides -----------------------------------------------------

export type PendingOverrides = {
  /** Pending delete per booking (`kind:id`), via entry.delete or loss.void. */
  entryDeletes: Map<string, StoredCommand>
  /** All pending edits per booking (`kind:id`), oldest first. */
  entryUpdates: Map<string, StoredCommand[]>
  sessionDeletes: Map<string, StoredCommand>
  sessionUpdates: Map<string, StoredCommand[]>
  renames: Map<string, StoredCommand[]>
  auditDeletes: Map<string, StoredCommand>
  auditPurges: StoredCommand[]
}

export const entryKey = (kind: EntryKind, id: string) => `${kind}:${id}`

export function pendingOverrides(pending: StoredCommand[]): PendingOverrides {
  const result: PendingOverrides = {
    entryDeletes: new Map(),
    entryUpdates: new Map(),
    sessionDeletes: new Map(),
    sessionUpdates: new Map(),
    renames: new Map(),
    auditDeletes: new Map(),
    auditPurges: [],
  }
  const push = (map: Map<string, StoredCommand[]>, key: string, command: StoredCommand) => map.set(key, [...(map.get(key) ?? []), command])
  for (const command of pending) {
    const payload = command.payload
    if (command.type === 'entry.delete') result.entryDeletes.set(entryKey(payload.kind as EntryKind, String(payload.entryId)), command)
    if (command.type === 'loss.void') result.entryDeletes.set(entryKey('loss', String(payload.entryId)), command)
    if (command.type === 'entry.update') push(result.entryUpdates, entryKey(payload.kind as EntryKind, String(payload.entryId)), command)
    if (command.type === 'session.delete') result.sessionDeletes.set(String(payload.sessionId), command)
    if (command.type === 'session.update') push(result.sessionUpdates, String(payload.sessionId), command)
    if (command.type === 'player.rename') push(result.renames, String(payload.playerId), command)
    if (command.type === 'audit.delete') for (const auditId of payload.auditIds as string[]) result.auditDeletes.set(auditId, command)
    if (command.type === 'audit.purge') result.auditPurges.push(command)
  }
  return result
}

/** Pending command that will remove this app-log entry, if any. */
export function pendingAuditRemoval(overrides: PendingOverrides, entry: { id: string; createdAt: string }) {
  return (
    overrides.auditDeletes.get(entry.id) ??
    overrides.auditPurges.find((command) => !command.payload.before || entry.createdAt < String(command.payload.before))
  )
}

export function usePendingOverrides() {
  const { pending } = useApp()
  return useMemo(() => pendingOverrides(pending), [pending])
}

/** Pending effects for one player, for the "ausstehend" hints next to real numbers. */
export function pendingForPlayer(pending: StoredCommand[], playerId: string) {
  return pending.filter((command) => command.payload.playerId === playerId)
}

/** Short signed-amount label of a pending command's effect on a player's debt, if any. */
export function pendingDebtEffect(command: StoredCommand) {
  if (command.type === 'payment.record') return `−${formatCurrency(Number(command.payload.amountCents))} Zahlung`
  if (command.type === 'correction.record') return `${formatSignedCurrency(Number(command.payload.amountCents))} Korrektur`
  if (command.type === 'loss.void') return 'Eintrag wird gelöscht'
  if (command.type === 'player.rename') return `heißt künftig „${String(command.payload.name)}“`
  if (command.type === 'player.update') return 'Statusänderung'
  if (command.type === 'cashbox.withdraw') return `−${formatCurrency(Number(command.payload.amountCents))} Entnahme`
  return COMMAND_LABELS[command.type]
}
