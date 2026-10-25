import type { CashboxSummary, HistoryEntry, SessionOverview } from '@/domain/types'
import type { CommandType } from '@/remote/protocol'

export type {
  AppSettingsRecord,
  CashboxSummary,
  DashboardSnapshot,
  HistoryEntry,
  Player,
  PlayerDebtSummary,
  SessionDetail,
  SessionOverview,
} from '@/domain/types'
export type { CommandType }

/** Booking table addressed by entry.* override commands. */
export type EntryKind = 'loss' | 'payment' | 'correction' | 'absence' | 'withdrawal'

/** History rows as served by the admin API: with the booking address and the raw note. */
export type HistoryRow = HistoryEntry & { entryKind?: EntryKind | null; note?: string | null }

// ---- chart read models (server/src/charts.ts) ------------------------------

export type EveningPlayerRow = { playerId: string; playerName: string; lossCents: number; beerCents: number; absenceCents: number }

export type EveningChartRow = {
  sessionId: string
  date: string
  title: string
  lossCents: number
  beerCents: number
  absenceCents: number
  totalCents: number
  players: EveningPlayerRow[]
}

export type EveningsChart = { season: string; seasons: string[]; evenings: EveningChartRow[] }

export type DebtPoint = {
  at: string
  kind: 'evening' | 'payment' | 'correction'
  deltaCents: number
  debtCents: number
  sessionId: string | null
  label: string
  open?: boolean
}

export type PlayerChartRow = {
  playerId: string
  playerName: string
  isCore: boolean
  isArchived: boolean
  totals: {
    lossCents: number
    beerCents: number
    absenceCents: number
    paymentCents: number
    correctionCents: number
    openDebtCents: number
  }
  eveningsAttended: number
  eveningsMissed: number
  timeline: DebtPoint[]
}

export type CashboxEvent = {
  id: string
  at: string
  kind: 'payment' | 'withdrawal'
  playerId: string | null
  playerName: string | null
  amountCents: number
  note: string | null
  /** Cash on hand after this event (payments − withdrawals). */
  cashOnHandCents: number
}

export type CashboxChart = {
  totalPaymentsCents: number
  totalWithdrawalsCents: number
  cashOnHandCents: number
  openDebtCents: number
  payments: Array<{ id: string; at: string; playerId: string; playerName: string; amountCents: number; cumulativeCents: number }>
  withdrawals: Array<{ id: string; at: string; amountCents: number; note: string; sessionId: string | null; cumulativeCents: number }>
  events: CashboxEvent[]
}

export type CommandStatus = 'pending' | 'applied' | 'rejected' | 'cancelled'

export type StoredCommand = {
  id: string
  deviceId: string
  type: CommandType
  payload: Record<string, unknown>
  createdAt: string
  createdBy: string
  status: CommandStatus
  error: string | null
  appliedAt: string | null
  resultReceivedAt: string | null
  fetchedAt: string | null
  cancelledAt: string | null
}

export type DeviceSummary = {
  id: string
  /** Editable display name. */
  label: string
  /** Name the app reported when it enrolled. */
  deviceName: string
  pairedBy: string
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  status: 'active' | 'blocked'
  lastSnapshotAt: string | null
  pendingCommands: number
}

export type DeviceCashbox = {
  deviceId: string
  label: string
  cashbox: CashboxSummary | null
  cashboxLabel: string | null
  /** Running evening of that device, if any. */
  openSession: SessionOverview | null
}

/** Status of the selected device plus all devices. */
export type ServerStatus = {
  paired: boolean
  deviceId: string | null
  label: string | null
  deviceLabel: string | null
  deviceName: string | null
  pairedAt: string | null
  snapshotFromPreviousDevice?: boolean
  lastSeenAt: string | null
  lastSnapshotAt: string | null
  snapshotCreatedAt: string | null
  schemaVersion: number | null
  snapshotSizeBytes: number | null
  pendingCommands: number
  publicOrigin: string
  maxDevices: number
  activeDevices: number
  devices: DeviceSummary[]
}

// ---- selected device -------------------------------------------------------

/** Every admin request carries the selected device; the server defaults to the first active one. */
let selectedDevice: string | null = null

export function setApiDevice(deviceId: string | null) {
  selectedDevice = deviceId
}

export function getApiDevice() {
  return selectedDevice
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

const FALLBACK_MESSAGES: Record<string, string> = {
  no_snapshot: 'Noch kein Datenstand vom Gerät empfangen.',
  device_not_found: 'Gerät unbekannt oder gesperrt – bitte ein anderes Gerät wählen.',
  unauthorized: 'Anmeldung abgelaufen – bitte Seite neu laden.',
  forbidden: 'Dieses Konto ist nicht freigeschaltet.',
  internal_error: 'Serverfehler – bitte später erneut versuchen.',
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(selectedDevice ? { 'X-Schockboard-Device': selectedDevice } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Cloudflare Access login pages are HTML.
  }
  if (!response.ok) {
    const data = (body ?? {}) as { error?: string; message?: string }
    const code = data.error ?? `http_${response.status}`
    throw new ApiError(response.status, code, data.message ?? FALLBACK_MESSAGES[code] ?? `Fehler ${response.status}`)
  }
  if (body === null && text) {
    throw new ApiError(response.status, 'unexpected_response', 'Unerwartete Antwort – Anmeldung abgelaufen? Seite neu laden.')
  }
  return body as T
}

export async function queueCommand(type: CommandType, payload: Record<string, unknown>) {
  const key = `schockboard.pending:${JSON.stringify({ device: selectedDevice, type, payload })}`
  const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID()
  sessionStorage.setItem(key, requestId)
  try {
    const command = await api<StoredCommand>('/commands', { method: 'POST', body: JSON.stringify({ requestId, type, payload }) })
    sessionStorage.removeItem(key)
    return command
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) sessionStorage.removeItem(key)
    throw error
  }
}

export function cancelCommand(id: string) {
  return api<StoredCommand>(`/commands/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
