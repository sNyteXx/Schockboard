export type RuleProfile = {
  title: string
  alias: {
    general: string
    schockAus: string
  }
  overview: string
  ranking: string[]
  toggles: Array<{
    id: 'einkaufen' | 'sechsen-drehen' | 'laden'
    label: string
    description: string
    enabled: boolean
  }>
}

export type ViewMode = 'basic' | 'advanced'

export type ThemeId = 'original' | 'bvb09' | 'midnight'

export type AbsencePenaltyMode = 'none' | 'split_absent' | 'full_average'

export type AppSettingsRecord = {
  defaultStakeCents: number
  currency: 'EUR'
  cashboxLabel: string
  ruleProfile: RuleProfile
  viewMode: ViewMode
  themeId: ThemeId
  absencePenaltyMode: AbsencePenaltyMode
}

export type AuthAccount = {
  id: string
  username: string
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export type Actor = {
  accountId: string
  username: string
}

export type Player = {
  id: string
  name: string
  slug: string
  isCore: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export type Session = {
  id: string
  title: string
  notes: string | null
  stakeCents: number
  status: 'open' | 'closed'
  startedAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export type LossEntry = {
  id: string
  sessionId: string
  playerId: string
  amountCents: number
  note: string | null
  isBeerRound: boolean
  createdAt: string
}

export type AbsenceCharge = {
  id: string
  sessionId: string
  playerId: string
  amountCents: number
  averageBaseLossCents: number
  averagePresentCoreCount: number
  note: string | null
  createdAt: string
}

export type Payment = {
  id: string
  playerId: string
  sessionId: string | null
  amountCents: number
  note: string | null
  createdAt: string
}

export type Correction = {
  id: string
  playerId: string
  sessionId: string | null
  amountCents: number
  reason: string
  createdAt: string
}

export type PlayerDebtSummary = {
  playerId: string
  playerName: string
  isCore: boolean
  isArchived: boolean
  lossCents: number
  absenceCents: number
  correctionCents: number
  paymentCents: number
  openDebtCents: number
}

export type CashboxSummary = {
  totalPaymentsCents: number
  totalOutstandingCents: number
}

export type SessionOverview = {
  id: string
  title: string
  status: 'open' | 'closed'
  stakeCents: number
  startedAt: string
  closedAt: string | null
  presentCount: number
  lossCount: number
  totalLossCents: number
  totalAbsenceCents: number
}

export type SessionAttendanceRow = {
  id: string
  sessionId: string
  playerId: string
  playerName: string
  isCore: boolean
  isArchived: boolean
  present: boolean
}

export type HistoryEntry = {
  id: string
  kind: 'loss' | 'beerround' | 'absence' | 'payment' | 'correction' | 'audit'
  createdAt: string
  playerId: string | null
  playerName: string | null
  amountCents: number | null
  message: string
  sessionId: string | null
  sessionTitle: string | null
  actorUsername: string | null
}

export type DashboardSnapshot = {
  openSession: SessionOverview | null
  debtors: PlayerDebtSummary[]
  cashbox: CashboxSummary
  recentHistory: HistoryEntry[]
  settings: AppSettingsRecord
}

export type SessionDetail = {
  session: SessionOverview & {
    notes: string | null
  }
  attendance: SessionAttendanceRow[]
  availablePresentPlayers: Array<{
    id: string
    name: string
    isCore: boolean
  }>
  losses: Array<LossEntry & { playerName: string }>
  absences: Array<AbsenceCharge & { playerName: string }>
  timeline: HistoryEntry[]
}

export type HistoryFilters = {
  playerId?: string
  kind?: HistoryEntry['kind'] | 'all'
  includeAudit?: boolean
}

export type FlashMessage = {
  type: 'success' | 'error'
  message: string
}
