import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { formatCurrency, formatSignedCurrency } from '@/domain/format'

import { api, ApiError, type StoredCommand, type ServerStatus } from './api'

// ---- tiny router -----------------------------------------------------------

const listeners = new Set<() => void>()

export function navigate(to: string) {
  if (to === window.location.pathname + window.location.search) return
  window.history.pushState(null, '', to)
  listeners.forEach((listener) => listener())
  window.scrollTo({ top: 0, behavior: 'smooth' })
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

export function Link(props: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={props.to}
      className={props.className}
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
  status: ServerStatus | null
  commands: StoredCommand[]
  pending: StoredCommand[]
  email: string | null
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
  const [commands, setCommands] = useState<StoredCommand[]>([])
  const [me, setMe] = useState<{ email: string; devNoAuth: boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const fingerprint = useRef('')

  const toast = useCallback((message: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, kind }])
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextCommands] = await Promise.all([api<ServerStatus>('/status'), api<StoredCommand[]>('/commands')])
      setStatus(nextStatus)
      setCommands(nextCommands)
      const print = `${nextStatus.lastSnapshotAt}|${nextCommands.map((command) => `${command.id}:${command.status}`).join(',')}`
      if (print !== fingerprint.current) {
        fingerprint.current = print
        setRevision((value) => value + 1)
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        toast(error.message, 'error')
      }
    }
  }, [toast])

  useEffect(() => {
    void refresh()
    api<{ email: string; devNoAuth: boolean }>('/me').then(setMe, () => undefined)
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
      status,
      commands,
      pending: commands.filter((command) => command.status === 'pending'),
      email: me?.email ?? null,
      devNoAuth: me?.devNoAuth ?? false,
      revision,
      refresh,
      toast,
    }),
    [status, commands, me, revision, refresh, toast]
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((entry) => (
          <div key={entry.id} className={`toast ${entry.kind === 'error' ? 'error' : ''}`}>
            {entry.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}

// ---- data fetching ---------------------------------------------------------

export function useApi<T>(path: string | null) {
  const { revision } = useApp()
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) return
    let alive = true
    setState((current) => ({ ...current, loading: true }))
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
  }, [path, revision, nonce])

  return { ...state, reload: () => setNonce((value) => value + 1) }
}

// ---- command descriptions --------------------------------------------------

export const COMMAND_LABELS: Record<StoredCommand['type'], string> = {
  'correction.record': 'Korrektur',
  'payment.record': 'Zahlung',
  'player.create': 'Spieler anlegen',
  'player.update': 'Spieler ändern',
  'settings.update': 'Einstellungen',
  'loss.void': 'Eintrag stornieren',
}

const PENALTY_LABELS: Record<string, string> = {
  none: 'keine Abwesenheitsgebühr',
  full_average: 'voller Durchschnitt',
  split_absent: 'Durchschnitt auf Abwesende verteilt',
}

export function describeCommand(command: StoredCommand, names: Map<string, string>) {
  const payload = command.payload
  const name = (id: unknown) => names.get(String(id)) ?? 'Unbekannter Spieler'
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
      return `Eintrag von ${name(payload.playerId)} stornieren`
  }
}

/** Pending effects for one player, for the "ausstehend" hints next to real numbers. */
export function pendingForPlayer(pending: StoredCommand[], playerId: string) {
  return pending.filter((command) => command.payload.playerId === playerId)
}

/** Short signed-amount label of a pending command's effect on a player's debt, if any. */
export function pendingDebtEffect(command: StoredCommand) {
  if (command.type === 'payment.record') return `−${formatCurrency(Number(command.payload.amountCents))} Zahlung`
  if (command.type === 'correction.record') return `${formatSignedCurrency(Number(command.payload.amountCents))} Korrektur`
  if (command.type === 'loss.void') return 'Stornierung'
  if (command.type === 'player.update') return 'Statusänderung'
  return COMMAND_LABELS[command.type]
}
