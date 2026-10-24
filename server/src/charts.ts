import { sqliteAll, sqliteGet } from './snapshot-client'

/**
 * Read models for the web charts, computed with plain SQL from the latest
 * snapshot. Season statistics only count closed evenings; debt totals and
 * timelines include everything the app counts (incl. a running evening), so
 * their last point always equals the app's open debt.
 */

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
  /** True for bookings of an evening that is still running. */
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

export type CashboxChart = {
  totalPaymentsCents: number
  openDebtCents: number
  payments: Array<{ id: string; at: string; playerId: string; playerName: string; amountCents: number; cumulativeCents: number }>
}

export function listSeasons(): string[] {
  return sqliteAll<{ season: string }>(
    "SELECT DISTINCT strftime('%Y', started_at) AS season FROM sessions WHERE status = 'closed' ORDER BY season DESC"
  ).map((row) => row.season)
}

export function getEveningsChart(season: string): EveningsChart {
  const filter = season === 'all' ? '' : "AND strftime('%Y', s.started_at) = $season"
  const params = season === 'all' ? {} : { $season: season }

  const sessions = sqliteAll<{ id: string; title: string; started_at: string }>(
    `SELECT s.id, s.title, s.started_at FROM sessions s WHERE s.status = 'closed' ${filter} ORDER BY s.started_at ASC, s.id ASC`,
    params
  )
  const rows = sqliteAll<{ session_id: string; player_id: string; player_name: string; loss: number; beer: number; absence: number }>(
    `SELECT x.session_id, x.player_id, p.name AS player_name,
            SUM(x.loss) AS loss, SUM(x.beer) AS beer, SUM(x.absence) AS absence
     FROM (
       SELECT session_id, player_id,
              CASE WHEN is_beer_round = 1 THEN 0 ELSE amount_cents END AS loss,
              CASE WHEN is_beer_round = 1 THEN amount_cents ELSE 0 END AS beer,
              0 AS absence
       FROM loss_entries
       UNION ALL
       SELECT session_id, player_id, 0, 0, amount_cents FROM absence_charges
     ) x
     INNER JOIN sessions s ON s.id = x.session_id
     INNER JOIN players p ON p.id = x.player_id
     WHERE s.status = 'closed' ${filter}
     GROUP BY x.session_id, x.player_id
     ORDER BY p.name COLLATE NOCASE`,
    params
  )

  const bySession = new Map<string, EveningPlayerRow[]>()
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? []
    list.push({ playerId: row.player_id, playerName: row.player_name, lossCents: row.loss, beerCents: row.beer, absenceCents: row.absence })
    bySession.set(row.session_id, list)
  }

  const evenings = sessions.map((session) => {
    const players = bySession.get(session.id) ?? []
    const lossCents = players.reduce((sum, row) => sum + row.lossCents, 0)
    const beerCents = players.reduce((sum, row) => sum + row.beerCents, 0)
    const absenceCents = players.reduce((sum, row) => sum + row.absenceCents, 0)
    return {
      sessionId: session.id,
      date: session.started_at,
      title: session.title,
      lossCents,
      beerCents,
      absenceCents,
      totalCents: lossCents + beerCents + absenceCents,
      players,
    }
  })

  return { season, seasons: listSeasons(), evenings }
}

export function getPlayersChart(): PlayerChartRow[] {
  const players = sqliteAll<{ id: string; name: string; is_core: number; is_archived: number }>(
    'SELECT id, name, is_core, is_archived FROM players ORDER BY name COLLATE NOCASE'
  )

  // One row per player and evening (charges), payment or correction, oldest first.
  const events = sqliteAll<{
    player_id: string
    at: string
    kind: DebtPoint['kind']
    delta: number
    loss: number
    beer: number
    absence: number
    session_id: string | null
    label: string
    open: number
    ref: string
  }>(
    `SELECT player_id, at, kind, delta, loss, beer, absence, session_id, label, open, ref FROM (
       SELECT x.player_id, s.started_at AS at, 'evening' AS kind, SUM(x.amount) AS delta,
              SUM(x.loss) AS loss, SUM(x.beer) AS beer, SUM(x.absence) AS absence,
              s.id AS session_id, s.title AS label, CASE WHEN s.status = 'open' THEN 1 ELSE 0 END AS open, s.id AS ref
       FROM (
         SELECT session_id, player_id, amount_cents AS amount,
                CASE WHEN is_beer_round = 1 THEN 0 ELSE amount_cents END AS loss,
                CASE WHEN is_beer_round = 1 THEN amount_cents ELSE 0 END AS beer,
                0 AS absence
         FROM loss_entries
         UNION ALL
         SELECT session_id, player_id, amount_cents, 0, 0, amount_cents FROM absence_charges
       ) x
       INNER JOIN sessions s ON s.id = x.session_id
       GROUP BY x.player_id, s.id
       UNION ALL
       SELECT player_id, created_at, 'payment', -amount_cents, 0, 0, 0, session_id, COALESCE(note, 'Zahlung'), 0, id FROM payments
       UNION ALL
       SELECT player_id, created_at, 'correction', amount_cents, 0, 0, 0, session_id, reason, 0, id FROM corrections
     )
     -- same instant: charges before corrections before payments, running evening last
     ORDER BY at ASC, open ASC, CASE kind WHEN 'evening' THEN 0 WHEN 'correction' THEN 1 ELSE 2 END, ref ASC`
  )

  const attendance = sqliteAll<{ player_id: string; attended: number; missed: number }>(
    `SELECT sa.player_id,
            SUM(CASE WHEN sa.present = 1 THEN 1 ELSE 0 END) AS attended,
            SUM(CASE WHEN sa.present = 1 THEN 0 ELSE 1 END) AS missed
     FROM session_attendance sa
     INNER JOIN sessions s ON s.id = sa.session_id AND s.status = 'closed'
     GROUP BY sa.player_id`
  )
  const attendanceById = new Map(attendance.map((row) => [row.player_id, row]))

  const result = new Map<string, PlayerChartRow>(
    players.map((player) => [
      player.id,
      {
        playerId: player.id,
        playerName: player.name,
        isCore: player.is_core === 1,
        isArchived: player.is_archived === 1,
        totals: { lossCents: 0, beerCents: 0, absenceCents: 0, paymentCents: 0, correctionCents: 0, openDebtCents: 0 },
        eveningsAttended: attendanceById.get(player.id)?.attended ?? 0,
        eveningsMissed: attendanceById.get(player.id)?.missed ?? 0,
        timeline: [],
      },
    ])
  )

  for (const event of events) {
    const player = result.get(event.player_id)
    if (!player) continue
    const totals = player.totals
    if (event.kind === 'evening') {
      totals.lossCents += event.loss
      totals.beerCents += event.beer
      totals.absenceCents += event.absence
    } else if (event.kind === 'payment') {
      totals.paymentCents -= event.delta
    } else {
      totals.correctionCents += event.delta
    }
    totals.openDebtCents += event.delta
    player.timeline.push({
      at: event.at,
      kind: event.kind,
      deltaCents: event.delta,
      debtCents: totals.openDebtCents,
      sessionId: event.session_id,
      label: event.label,
      ...(event.open ? { open: true } : {}),
    })
  }

  return [...result.values()]
}

export function getCashboxChart(): CashboxChart {
  const rows = sqliteAll<{ id: string; created_at: string; player_id: string; player_name: string; amount_cents: number }>(
    `SELECT pmt.id, pmt.created_at, pmt.player_id, p.name AS player_name, pmt.amount_cents
     FROM payments pmt INNER JOIN players p ON p.id = pmt.player_id
     ORDER BY pmt.created_at ASC, pmt.id ASC`
  )
  let cumulative = 0
  const payments = rows.map((row) => {
    cumulative += row.amount_cents
    return {
      id: row.id,
      at: row.created_at,
      playerId: row.player_id,
      playerName: row.player_name,
      amountCents: row.amount_cents,
      cumulativeCents: cumulative,
    }
  })
  const debt = sqliteGet<{ total: number }>(
    `SELECT COALESCE((SELECT SUM(amount_cents) FROM loss_entries), 0)
          + COALESCE((SELECT SUM(amount_cents) FROM absence_charges), 0)
          + COALESCE((SELECT SUM(amount_cents) FROM corrections), 0)
          - COALESCE((SELECT SUM(amount_cents) FROM payments), 0) AS total`
  )
  return { totalPaymentsCents: cumulative, openDebtCents: debt?.total ?? 0, payments }
}

// ---- booking lookups for the override UI ------------------------------------

export type EntryKind = 'loss' | 'payment' | 'correction' | 'absence'

export const ENTRY_TABLES: Record<EntryKind, { table: string; note: string }> = {
  loss: { table: 'loss_entries', note: 'note' },
  payment: { table: 'payments', note: 'note' },
  correction: { table: 'corrections', note: 'reason' },
  absence: { table: 'absence_charges', note: 'note' },
}

/** Maps history kinds onto the booking table addressed by entry.* commands. */
export function entryKindOf(historyKind: string): EntryKind | null {
  if (historyKind === 'loss' || historyKind === 'beerround') return 'loss'
  if (historyKind === 'payment' || historyKind === 'correction' || historyKind === 'absence') return historyKind
  return null
}

/** Raw note/reason of bookings (history messages contain display fallbacks instead). */
export function entryNotes(kind: EntryKind, ids: string[]) {
  const notes = new Map<string, string | null>()
  if (ids.length === 0) return notes
  const { table, note } = ENTRY_TABLES[kind]
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const params = Object.fromEntries(chunk.map((id, position) => [`$p${position}`, id]))
    const rows = sqliteAll<{ id: string; note: string | null }>(
      `SELECT id, ${note} AS note FROM ${table} WHERE id IN (${chunk.map((_, position) => `$p${position}`).join(', ')})`,
      params
    )
    for (const row of rows) notes.set(row.id, row.note)
  }
  return notes
}
