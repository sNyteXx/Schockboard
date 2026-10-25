import type { StatsRawData } from '@/db/stats-queries'

export type Achievement = {
  id: string
  playerId: string
  playerName: string
  title: string
  description: string
  progress: number
  target: number
  unlockedAt: string | null
  sessionId: string | null
}

/** Rebuilt from closed evenings: corrections and restored backups cannot leave stale trophies. */
export function buildAchievements(raw: StatsRawData): Achievement[] {
  const sessions = [...raw.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  const key = (sessionId: string, playerId: string) => `${sessionId}|${playerId}`
  const attendance = new Map(raw.attendance.map(row => [key(row.sessionId, row.playerId), row.present]))
  const losses = new Map(raw.losses.map(row => [key(row.sessionId, row.playerId), row.lossCount]))
  const totals = new Map<string, number>()
  const maxLoss = new Map<string, number>()
  for (const row of raw.losses) {
    totals.set(row.sessionId, (totals.get(row.sessionId) ?? 0) + row.lossCount + row.beerRoundCount)
    maxLoss.set(row.sessionId, Math.max(maxLoss.get(row.sessionId) ?? 0, row.lossCount))
  }
  return raw.players.flatMap(player => {
    const definitions = [
      ['regular-10', 'Stammgast · Bronze', '10 abgeschlossene Abende mitgespielt', 10],
      ['regular-25', 'Stammgast · Silber', '25 abgeschlossene Abende mitgespielt', 25],
      ['regular-50', 'Stammgast · Gold', '50 abgeschlossene Abende mitgespielt', 50],
      ['clean', 'Weiße Weste', 'Einen gespielten Abend ohne Verlust beendet', 1],
      ['lucky', 'Glückssträhne', 'Fünf besuchte Abende in Folge kein Pechvogel', 5],
      ['loyal', 'Dauerbrenner', 'Fünf Spielabende hintereinander dabei', 5],
      ['comeback', 'Comeback', 'Nach einem Pechvogel-Abend beim nächsten Mitspielen verlustfrei', 1],
    ] as const
    const awards: Achievement[] = definitions.map(([id, title, description, target]) => ({
      id, title, description, target, playerId: player.id, playerName: player.name,
      progress: 0, unlockedAt: null, sessionId: null,
    }))
    let attended = 0, loyal = 0, lucky = 0, clean = 0, comeback = 0
    let wasPechvogel = false
    for (const session of sessions) {
      // Empty test evenings do not earn trophies or break playing streaks.
      if (!(totals.get(session.id) ?? 0)) continue
      if (attendance.get(key(session.id, player.id)) !== true) { loyal = 0; continue }
      attended++
      loyal++
      const count = losses.get(key(session.id, player.id)) ?? 0
      const pechvogel = count > 0 && count === maxLoss.get(session.id)
      lucky = pechvogel ? 0 : lucky + 1
      if (count === 0) { clean++; if (wasPechvogel) comeback++ }
      wasPechvogel = pechvogel
      const values = [attended, attended, attended, clean, lucky, loyal, comeback]
      awards.forEach((award, index) => {
        award.progress = Math.min(award.target, Math.max(award.progress, values[index]))
        if (!award.unlockedAt && values[index] >= award.target) {
          award.unlockedAt = session.closedAt ?? session.startedAt
          award.sessionId = session.id
        }
      })
    }
    return awards
  })
}
