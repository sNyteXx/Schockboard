import { sqliteAll } from '@/db/client'

/**
 * Read-only data for charts. SQL returns compact rows; every shaping step is
 * a pure function below so it can be unit-tested without a database.
 * Season statistics only count closed evenings.
 */

export type EveningTotal = {
  sessionId: string
  title: string
  status: 'open' | 'closed'
  startedAt: string
  closedAt: string | null
  presentCount: number
  lossCount: number
  lossCents: number
  beerRoundCents: number
  absenceCents: number
}

export type SessionPlayerTotal = {
  sessionId: string
  playerId: string
  playerName: string
  lossCount: number
  totalCents: number
}

export type MoneyEvent = {
  at: string
  /** Charges (losses, beer rounds, absences, corrections) add debt, payments reduce it. */
  kind: 'charge' | 'payment'
  amountCents: number
}

export type SeasonLossRow = {
  sessionId: string
  playerId: string
  lossCount: number
  lossCents: number
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** Every evening (open and closed), oldest first. */
export function getEveningTotals(): EveningTotal[] {
  const rows = sqliteAll<{
    id: string
    title: string
    status: 'open' | 'closed'
    started_at: string
    closed_at: string | null
    present_count: number
    loss_count: number
    loss_cents: number
    beer_cents: number
    absence_cents: number
  }>(
    `
      SELECT
        s.id, s.title, s.status, s.started_at, s.closed_at,
        (SELECT COUNT(*) FROM session_attendance sa WHERE sa.session_id = s.id AND sa.present = 1) AS present_count,
        (SELECT COUNT(*) FROM loss_entries le WHERE le.session_id = s.id AND le.is_beer_round = 0) AS loss_count,
        (SELECT COALESCE(SUM(le.amount_cents), 0) FROM loss_entries le WHERE le.session_id = s.id AND le.is_beer_round = 0) AS loss_cents,
        (SELECT COALESCE(SUM(le.amount_cents), 0) FROM loss_entries le WHERE le.session_id = s.id AND le.is_beer_round = 1) AS beer_cents,
        (SELECT COALESCE(SUM(ac.amount_cents), 0) FROM absence_charges ac WHERE ac.session_id = s.id) AS absence_cents
      FROM sessions s
      ORDER BY s.started_at ASC
    `
  )
  return rows.map((row) => ({
    sessionId: row.id,
    title: row.title,
    status: row.status,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    presentCount: Number(row.present_count) || 0,
    lossCount: Number(row.loss_count) || 0,
    lossCents: Number(row.loss_cents) || 0,
    beerRoundCents: Number(row.beer_cents) || 0,
    absenceCents: Number(row.absence_cents) || 0,
  }))
}

/** Per evening and player: normal losses and total booked (incl. beer rounds). */
export function getSessionPlayerTotals(): SessionPlayerTotal[] {
  const rows = sqliteAll<{ session_id: string; player_id: string; player_name: string; loss_count: number; total_cents: number }>(
    `
      SELECT
        le.session_id,
        le.player_id,
        p.name AS player_name,
        SUM(CASE WHEN le.is_beer_round = 0 THEN 1 ELSE 0 END) AS loss_count,
        SUM(le.amount_cents) AS total_cents
      FROM loss_entries le
      INNER JOIN players p ON p.id = le.player_id
      GROUP BY le.session_id, le.player_id
    `
  )
  return rows.map((row) => ({
    sessionId: row.session_id,
    playerId: row.player_id,
    playerName: row.player_name,
    lossCount: Number(row.loss_count) || 0,
    totalCents: Number(row.total_cents) || 0,
  }))
}

/** All money movements, oldest first. */
export function getMoneyEvents(): MoneyEvent[] {
  const rows = sqliteAll<{ at: string; kind: 'charge' | 'payment'; amount_cents: number }>(
    `
      SELECT created_at AS at, 'charge' AS kind, amount_cents FROM loss_entries
      UNION ALL SELECT created_at, 'charge', amount_cents FROM absence_charges
      UNION ALL SELECT created_at, 'charge', amount_cents FROM corrections
      UNION ALL SELECT created_at, 'payment', amount_cents FROM payments
      ORDER BY at ASC
    `
  )
  return rows.map((row) => ({ at: row.at, kind: row.kind, amountCents: Number(row.amount_cents) || 0 }))
}

/** Normal losses per closed evening and player (season line chart). */
export function getClosedSessionLossRows(): SeasonLossRow[] {
  const rows = sqliteAll<{ session_id: string; player_id: string; loss_count: number; loss_cents: number }>(
    `
      SELECT le.session_id, le.player_id, COUNT(*) AS loss_count, SUM(le.amount_cents) AS loss_cents
      FROM loss_entries le
      INNER JOIN sessions s ON s.id = le.session_id
      WHERE s.status = 'closed' AND le.is_beer_round = 0
      GROUP BY le.session_id, le.player_id
    `
  )
  return rows.map((row) => ({
    sessionId: row.session_id,
    playerId: row.player_id,
    lossCount: Number(row.loss_count) || 0,
    lossCents: Number(row.loss_cents) || 0,
  }))
}

// ---------------------------------------------------------------------------
// Pure transformations
// ---------------------------------------------------------------------------

export type BalancePoint = { at: string; paidCents: number; openCents: number }

/**
 * Running cash (sum of payments) and open debt (charges − payments) sampled
 * at each checkpoint (inclusive). Events and checkpoints must be ISO strings.
 */
export function buildBalanceTimeline(events: MoneyEvent[], checkpoints: string[]): BalancePoint[] {
  const sorted = [...events].sort((left, right) => left.at.localeCompare(right.at))
  const points: BalancePoint[] = []
  let index = 0
  let charged = 0
  let paid = 0
  for (const checkpoint of [...checkpoints].sort()) {
    while (index < sorted.length && sorted[index].at <= checkpoint) {
      const event = sorted[index]
      if (event.kind === 'payment') paid += event.amountCents
      else charged += event.amountCents
      index++
    }
    points.push({ at: checkpoint, paidCents: paid, openCents: charged - paid })
  }
  return points
}

/** Last `count` closed evenings, oldest first. */
export function lastClosedEvenings(evenings: EveningTotal[], count: number) {
  return evenings.filter((evening) => evening.status === 'closed').slice(-count)
}

export type DashboardCharts = {
  /** Cash in the box after each of the last evenings, ending with "now". */
  cashSeries: number[]
  /** Open debt after each of the last evenings, ending with "now". */
  debtSeries: number[]
  /** Normal loss cents of the last 5 closed evenings. */
  recentLossSeries: number[]
  recentLossCents: number
  recentEveningCount: number
  /** Trend over the last up to 12 closed evenings. */
  trend: { labels: string[]; lossCents: number[]; absenceCents: number[] }
}

/**
 * Dashboard series. `current` are the authoritative KPI values (they include
 * the still-pending absence of an open evening) and become the last point so
 * sparkline and number never disagree.
 */
export function buildDashboardCharts(
  evenings: EveningTotal[],
  events: MoneyEvent[],
  current: { paidCents: number; openCents: number },
  labelOf: (iso: string) => string,
  window = 8
): DashboardCharts {
  const closed = evenings.filter((evening) => evening.status === 'closed')
  const checkpoints = closed.slice(-window).map((evening) => evening.closedAt ?? evening.startedAt)
  const timeline = buildBalanceTimeline(events, checkpoints)
  const recent = lastClosedEvenings(evenings, 5)
  const trendRows = lastClosedEvenings(evenings, 12)
  return {
    cashSeries: [...timeline.map((point) => point.paidCents), current.paidCents],
    debtSeries: [...timeline.map((point) => point.openCents), current.openCents],
    recentLossSeries: recent.map((evening) => evening.lossCents),
    recentLossCents: recent.reduce((sum, evening) => sum + evening.lossCents, 0),
    recentEveningCount: recent.length,
    trend: {
      labels: trendRows.map((evening) => labelOf(evening.startedAt)),
      lossCents: trendRows.map((evening) => evening.lossCents),
      absenceCents: trendRows.map((evening) => evening.absenceCents),
    },
  }
}

export type CumulativeSeries = { playerId: string; playerName: string; points: number[]; totalCents: number }

/**
 * Cumulative loss cents per player over the given (chronological) evenings.
 * Returns the `limit` players with the highest total, highest first.
 */
export function buildCumulativeLossSeries(
  sessionIds: string[],
  rows: SeasonLossRow[],
  players: Array<{ id: string; name: string }>,
  limit = 6
): CumulativeSeries[] {
  const bySessionPlayer = new Map(rows.map((row) => [`${row.sessionId}|${row.playerId}`, row.lossCents]))
  const series = players.map((player) => {
    let running = 0
    const points = sessionIds.map((sessionId) => {
      running += bySessionPlayer.get(`${sessionId}|${player.id}`) ?? 0
      return running
    })
    return { playerId: player.id, playerName: player.name, points, totalCents: running }
  })
  return series
    .filter((entry) => entry.totalCents > 0)
    .sort((left, right) => right.totalCents - left.totalCents || left.playerName.localeCompare(right.playerName, 'de'))
    .slice(0, limit)
}

/** Groups per-player totals by evening, biggest share first. */
export function groupBySession(rows: SessionPlayerTotal[]) {
  const map = new Map<string, SessionPlayerTotal[]>()
  for (const row of rows) {
    const list = map.get(row.sessionId) ?? []
    list.push(row)
    map.set(row.sessionId, list)
  }
  for (const list of map.values()) list.sort((left, right) => right.totalCents - left.totalCents || left.playerName.localeCompare(right.playerName, 'de'))
  return map
}

// ---------------------------------------------------------------------------
// Loaders used by screens
// ---------------------------------------------------------------------------

export function getDashboardCharts(current: { paidCents: number; openCents: number }, labelOf: (iso: string) => string) {
  return buildDashboardCharts(getEveningTotals(), getMoneyEvents(), current, labelOf)
}

export function getSessionListCharts() {
  const evenings = getEveningTotals()
  return {
    breakdown: groupBySession(getSessionPlayerTotals()),
    /** Total booked per closed evening, oldest first (last 12). */
    totals: lastClosedEvenings(evenings, 12).map((evening) => evening.lossCents + evening.beerRoundCents),
  }
}

/** Cumulative losses per player across the closed evenings of a season (null = all). */
export function getSeasonLossSeries(season: string | null, labelOf: (iso: string) => string, limit = 6) {
  const sessions = sqliteAll<{ id: string; started_at: string }>(
    "SELECT id, started_at FROM sessions WHERE status = 'closed' ORDER BY started_at ASC"
  ).filter((session) => season === null || session.started_at.slice(0, 4) === season)
  const players = sqliteAll<{ id: string; name: string }>('SELECT id, name FROM players ORDER BY name ASC')
  return {
    labels: sessions.map((session) => labelOf(session.started_at)),
    series: buildCumulativeLossSeries(sessions.map((session) => session.id), getClosedSessionLossRows(), players, limit),
  }
}
