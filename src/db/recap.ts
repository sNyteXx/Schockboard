import { getDebtSummaries } from './queries'
import { getStatsRawData } from './stats-queries'
import { buildAchievements } from '@/domain/achievements'
import type { Recap } from '@/domain/recap'
import { formatDate } from '@/domain/format'

export function getRecap(input: { sessionId?: string; year?: string; includeBalances?: boolean }): Recap {
  const raw = getStatsRawData()
  const sessions = raw.sessions.filter(session => input.sessionId ? session.id === input.sessionId : session.startedAt.slice(0, 4) === input.year)
  if (input.sessionId && !sessions.length) throw new Error('Abend noch nicht abgeschlossen oder nicht gefunden.')
  const ids = new Set(sessions.map(session => session.id))
  const losses = raw.losses.filter(row => ids.has(row.sessionId))
  const present = new Set(raw.attendance.filter(row => ids.has(row.sessionId) && row.present).map(row => row.playerId))
  const balances = input.includeBalances ? new Map(getDebtSummaries().map(row => [row.playerId, row.openDebtCents])) : null
  return {
    title: input.sessionId ? sessions[0].title : `Euer Jahr ${input.year}`,
    subtitle: input.sessionId ? formatDate(sessions[0].startedAt) : 'Der Stammtisch-Jahresrückblick',
    evenings: sessions.length,
    losses: losses.reduce((sum, row) => sum + row.lossCount, 0),
    beerRounds: losses.reduce((sum, row) => sum + row.beerRoundCount, 0),
    players: raw.players.filter(player => present.has(player.id)).map(player => ({ id: player.id, name: player.name,
      losses: losses.filter(row => row.playerId === player.id).reduce((sum, row) => sum + row.lossCount, 0),
      ...(balances ? { debtCents: balances.get(player.id) ?? 0 } : {}),
    })).sort((a, b) => b.losses - a.losses || a.name.localeCompare(b.name, 'de')),
    achievements: buildAchievements(raw).filter(award => award.sessionId && ids.has(award.sessionId)),
  }
}
