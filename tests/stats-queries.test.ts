import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { addBeerRoundEntry, addLossEntry, closeSession, createPlayer, createSession, toggleAttendance, updateAppSettings } from '@/db/queries'
import { buildStatistics, getStatistics, type StatsRawData } from '@/db/stats-queries'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }

function raw(): StatsRawData {
  const players = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), isCore: true, isArchived: false }))
  const sessions = [
    { id: 's1', title: 'Eins', startedAt: '2025-12-01T19:00:00.000Z' },
    { id: 's2', title: 'Zwei', startedAt: '2026-01-05T19:00:00.000Z' },
    { id: 's3', title: 'Drei', startedAt: '2026-02-05T19:00:00.000Z' },
  ]
  const attendance = sessions.flatMap((session) =>
    players.map((player) => ({ sessionId: session.id, playerId: player.id, present: !(session.id === 's3' && player.id === 'c') }))
  )
  const row = (sessionId: string, playerId: string, lossCount: number) => ({
    sessionId, playerId, lossCount, lossCents: lossCount * 100, beerRoundCount: 0, beerRoundCents: 0,
  })
  return {
    players,
    sessions,
    attendance,
    losses: [row('s1', 'a', 3), row('s1', 'b', 1), row('s2', 'a', 2), row('s2', 'b', 2), row('s3', 'b', 1)],
    absences: [{ sessionId: 's3', playerId: 'c', amountCents: 50 }],
  }
}

describe('buildStatistics', () => {
  it('ranks by losses and computes averages and attendance', () => {
    const stats = buildStatistics(raw())
    expect(stats.eveningCount).toBe(3)
    expect(stats.players.map((player) => player.playerId)).toEqual(['a', 'b', 'c'])
    const a = stats.players[0]
    expect(a.lossCount).toBe(5)
    expect(a.eveningsAttended).toBe(3)
    expect(a.averageLossCentsPerEvening).toBe(167)
    const c = stats.players[2]
    expect(c.eveningsAttended).toBe(2)
    expect(c.eveningsMissed).toBe(1)
    expect(c.absenceCents).toBe(50)
    expect(stats.wildestEvening?.sessionId).toBe('s1')
  })

  it('counts tied Pechvögel and lucky streaks', () => {
    const stats = buildStatistics(raw())
    const byId = Object.fromEntries(stats.players.map((player) => [player.playerId, player]))
    expect(byId.a.pechvogelCount).toBe(2) // s1 alone, s2 tied
    expect(byId.b.pechvogelCount).toBe(2) // s2 tied, s3 alone
    expect(byId.a.currentLuckyStreak).toBe(1)
    expect(byId.c.longestLuckyStreak).toBe(2)
    expect(byId.c.cleanEvenings).toBe(2)
  })

  it('filters by season', () => {
    const stats = buildStatistics(raw(), '2026')
    expect(stats.eveningCount).toBe(2)
    expect(stats.players.find((player) => player.playerId === 'a')!.lossCount).toBe(2)
  })
})

describe('getStatistics (SQL)', () => {
  it('reads only closed evenings', () => {
    memory.current = createMemoryDatabase()
    resetBootstrapFlag()
    ensureDatabaseReady()
    memory.current.runSync(
      "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', '2026-01-01', '2026-01-01')"
    )
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average' })
    const [anna, ben, cem] = ['Anna', 'Ben', 'Cem'].map((name) => createPlayer({ actor, name, isCore: true }))
    const first = createSession({ actor, title: 'Eins', notes: null, stakeCents: 100 })
    toggleAttendance({ actor, sessionId: first, playerId: cem })
    addLossEntry({ actor, sessionId: first, playerId: anna, note: null })
    addLossEntry({ actor, sessionId: first, playerId: anna, note: null })
    addLossEntry({ actor, sessionId: first, playerId: ben, note: null })
    addBeerRoundEntry({ actor, sessionId: first, playerId: ben, amountCents: 500, note: null })
    closeSession({ actor, sessionId: first })
    const second = createSession({ actor, title: 'Zwei', notes: null, stakeCents: 100 })
    addLossEntry({ actor, sessionId: second, playerId: ben, note: null })

    const { stats, seasons } = getStatistics()
    expect(seasons).toHaveLength(1)
    expect(stats.eveningCount).toBe(1)
    const byName = Object.fromEntries(stats.players.map((player) => [player.playerName, player]))
    expect(byName.Anna.lossCount).toBe(2)
    expect(byName.Anna.pechvogelCount).toBe(1)
    expect(byName.Ben.lossCount).toBe(1)
    expect(byName.Ben.beerRoundCents).toBe(500)
    expect(byName.Cem.eveningsMissed).toBe(1)
    expect(byName.Cem.absenceCents).toBe(150)
  })
})
