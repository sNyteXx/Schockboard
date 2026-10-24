import { sqliteAll } from '@/db/client'

/**
 * Read-only statistics. SQL only collects compact per-evening aggregates; the
 * fun stats (Pechvogel streaks etc.) are derived in plain TypeScript by
 * buildStatistics() so they can be unit-tested without a database.
 * Only closed evenings count – an open evening is still in play.
 */

export type StatsRawData = {
  players: Array<{ id: string; name: string; isCore: boolean; isArchived: boolean }>
  sessions: Array<{ id: string; title: string; startedAt: string }>
  attendance: Array<{ sessionId: string; playerId: string; present: boolean }>
  losses: Array<{ sessionId: string; playerId: string; lossCount: number; lossCents: number; beerRoundCount: number; beerRoundCents: number }>
  absences: Array<{ sessionId: string; playerId: string; amountCents: number }>
}

export function getStatsRawData(): StatsRawData {
  const players = sqliteAll<{ id: string; name: string; is_core: number; is_archived: number }>(
    'SELECT id, name, is_core, is_archived FROM players ORDER BY name ASC'
  )
  const sessions = sqliteAll<{ id: string; title: string; started_at: string }>(
    "SELECT id, title, started_at FROM sessions WHERE status = 'closed' ORDER BY started_at ASC"
  )
  const attendance = sqliteAll<{ session_id: string; player_id: string; present: number }>(
    `
      SELECT sa.session_id, sa.player_id, sa.present
      FROM session_attendance sa
      INNER JOIN sessions s ON s.id = sa.session_id
      WHERE s.status = 'closed'
    `
  )
  const losses = sqliteAll<{
    session_id: string
    player_id: string
    loss_count: number
    loss_cents: number
    beer_count: number
    beer_cents: number
  }>(
    `
      SELECT
        le.session_id,
        le.player_id,
        SUM(CASE WHEN le.is_beer_round = 0 THEN 1 ELSE 0 END) AS loss_count,
        SUM(CASE WHEN le.is_beer_round = 0 THEN le.amount_cents ELSE 0 END) AS loss_cents,
        SUM(CASE WHEN le.is_beer_round = 1 THEN 1 ELSE 0 END) AS beer_count,
        SUM(CASE WHEN le.is_beer_round = 1 THEN le.amount_cents ELSE 0 END) AS beer_cents
      FROM loss_entries le
      INNER JOIN sessions s ON s.id = le.session_id
      WHERE s.status = 'closed'
      GROUP BY le.session_id, le.player_id
    `
  )
  const absences = sqliteAll<{ session_id: string; player_id: string; amount_cents: number }>(
    `
      SELECT ac.session_id, ac.player_id, SUM(ac.amount_cents) AS amount_cents
      FROM absence_charges ac
      INNER JOIN sessions s ON s.id = ac.session_id
      WHERE s.status = 'closed'
      GROUP BY ac.session_id, ac.player_id
    `
  )

  return {
    players: players.map((row) => ({ id: row.id, name: row.name, isCore: Boolean(row.is_core), isArchived: Boolean(row.is_archived) })),
    sessions: sessions.map((row) => ({ id: row.id, title: row.title, startedAt: row.started_at })),
    attendance: attendance.map((row) => ({ sessionId: row.session_id, playerId: row.player_id, present: Boolean(row.present) })),
    losses: losses.map((row) => ({
      sessionId: row.session_id,
      playerId: row.player_id,
      lossCount: Number(row.loss_count) || 0,
      lossCents: Number(row.loss_cents) || 0,
      beerRoundCount: Number(row.beer_count) || 0,
      beerRoundCents: Number(row.beer_cents) || 0,
    })),
    absences: absences.map((row) => ({ sessionId: row.session_id, playerId: row.player_id, amountCents: Number(row.amount_cents) || 0 })),
  }
}

export type PlayerStats = {
  playerId: string
  playerName: string
  isCore: boolean
  isArchived: boolean
  eveningsAttended: number
  eveningsMissed: number
  attendanceRate: number
  lossCount: number
  lossCents: number
  beerRoundCount: number
  beerRoundCents: number
  absenceCents: number
  averageLossCentsPerEvening: number
  averageLossesPerEvening: number
  pechvogelCount: number
  /** Longest run of attended evenings in a row without being the Pechvogel. */
  longestLuckyStreak: number
  currentLuckyStreak: number
  bestEveningLossCount: number
  cleanEvenings: number
}

export type StatisticsResult = {
  season: string | null
  eveningCount: number
  totalLossCount: number
  totalLossCents: number
  totalBeerRoundCount: number
  totalBeerRoundCents: number
  totalAbsenceCents: number
  players: PlayerStats[]
  /** Evening with the most normal losses. */
  wildestEvening: { sessionId: string; title: string; startedAt: string; lossCount: number } | null
}

export function seasonOf(isoDate: string) {
  return isoDate.slice(0, 4)
}

export function listSeasons(raw: StatsRawData) {
  return [...new Set(raw.sessions.map((session) => seasonOf(session.startedAt)))].sort().reverse()
}

export function compareRanking(left: PlayerStats, right: PlayerStats) {
  if (right.lossCount !== left.lossCount) return right.lossCount - left.lossCount
  if (right.lossCents !== left.lossCents) return right.lossCents - left.lossCents
  return left.playerName.localeCompare(right.playerName, 'de')
}

export function buildStatistics(raw: StatsRawData, season: string | null = null): StatisticsResult {
  const sessions = raw.sessions
    .filter((session) => season === null || seasonOf(session.startedAt) === season)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  const sessionIds = new Set(sessions.map((session) => session.id))
  const key = (sessionId: string, playerId: string) => `${sessionId}|${playerId}`

  const lossByKey = new Map(raw.losses.filter((row) => sessionIds.has(row.sessionId)).map((row) => [key(row.sessionId, row.playerId), row]))
  const presentByKey = new Map(raw.attendance.filter((row) => sessionIds.has(row.sessionId)).map((row) => [key(row.sessionId, row.playerId), row.present]))
  const absenceRows = raw.absences.filter((row) => sessionIds.has(row.sessionId))

  // Pechvogel per evening: everybody tied on the highest non-zero loss count.
  const pechvogelBySession = new Map<string, Set<string>>()
  let wildestEvening: StatisticsResult['wildestEvening'] = null
  for (const session of sessions) {
    const rows = raw.losses.filter((row) => row.sessionId === session.id)
    const max = rows.reduce((value, row) => Math.max(value, row.lossCount), 0)
    pechvogelBySession.set(session.id, new Set(max > 0 ? rows.filter((row) => row.lossCount === max).map((row) => row.playerId) : []))
    const total = rows.reduce((sum, row) => sum + row.lossCount, 0)
    if (total > 0 && (!wildestEvening || total > wildestEvening.lossCount)) {
      wildestEvening = { sessionId: session.id, title: session.title, startedAt: session.startedAt, lossCount: total }
    }
  }

  const players: PlayerStats[] = []
  for (const player of raw.players) {
    let attended = 0
    let missed = 0
    let lossCount = 0
    let lossCents = 0
    let beerRoundCount = 0
    let beerRoundCents = 0
    let pechvogelCount = 0
    let streak = 0
    let longest = 0
    let best = 0
    let clean = 0
    let involved = false

    for (const session of sessions) {
      const present = presentByKey.get(key(session.id, player.id))
      const loss = lossByKey.get(key(session.id, player.id))
      if (present === undefined && !loss) continue
      involved = true
      if (loss) {
        lossCount += loss.lossCount
        lossCents += loss.lossCents
        beerRoundCount += loss.beerRoundCount
        beerRoundCents += loss.beerRoundCents
      }
      if (present === false && !loss) {
        if (player.isCore) missed += 1
        continue
      }
      attended += 1
      const count = loss?.lossCount ?? 0
      best = Math.max(best, count)
      if (count === 0) clean += 1
      if (pechvogelBySession.get(session.id)?.has(player.id)) {
        pechvogelCount += 1
        streak = 0
      } else {
        streak += 1
        longest = Math.max(longest, streak)
      }
    }

    const absenceCents = absenceRows.filter((row) => row.playerId === player.id).reduce((sum, row) => sum + row.amountCents, 0)
    if (!involved && absenceCents === 0) continue

    players.push({
      playerId: player.id,
      playerName: player.name,
      isCore: player.isCore,
      isArchived: player.isArchived,
      eveningsAttended: attended,
      eveningsMissed: missed,
      attendanceRate: attended + missed > 0 ? attended / (attended + missed) : 0,
      lossCount,
      lossCents,
      beerRoundCount,
      beerRoundCents,
      absenceCents,
      averageLossCentsPerEvening: attended > 0 ? Math.round(lossCents / attended) : 0,
      averageLossesPerEvening: attended > 0 ? Math.round((lossCount / attended) * 10) / 10 : 0,
      pechvogelCount,
      longestLuckyStreak: longest,
      currentLuckyStreak: streak,
      bestEveningLossCount: best,
      cleanEvenings: clean,
    })
  }

  players.sort(compareRanking)
  const sum = (pick: (row: PlayerStats) => number) => players.reduce((total, row) => total + pick(row), 0)

  return {
    season,
    eveningCount: sessions.length,
    totalLossCount: sum((row) => row.lossCount),
    totalLossCents: sum((row) => row.lossCents),
    totalBeerRoundCount: sum((row) => row.beerRoundCount),
    totalBeerRoundCents: sum((row) => row.beerRoundCents),
    totalAbsenceCents: sum((row) => row.absenceCents),
    players,
    wildestEvening,
  }
}

export function getStatistics(season: string | null = null) {
  const raw = getStatsRawData()
  return { seasons: listSeasons(raw), stats: buildStatistics(raw, season) }
}
