import { describe, expect, it } from 'vitest'
import { buildAchievements } from '@/domain/achievements'
import { recapSvg } from '@/domain/recap'
import { invitationCode } from '@/remote/collaboration-protocol'
import type { StatsRawData } from '@/db/stats-queries'

function history(count = 10): StatsRawData {
  const sessions = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, title: `Abend ${i}`, startedAt: `2026-01-${String(i + 1).padStart(2, '0')}T20:00:00Z` }))
  return { players: ['a', 'b'].map(id => ({ id, name: id, isCore: true, isArchived: false })), sessions,
    attendance: sessions.flatMap(session => ['a', 'b'].map(playerId => ({ sessionId: session.id, playerId, present: true }))),
    losses: sessions.map(session => ({ sessionId: session.id, playerId: 'b', lossCount: 2, lossCents: 200, beerRoundCount: 0, beerRoundCents: 0 })), absences: [] }
}
const award = (raw: StatsRawData, id: string, player = 'a') => buildAchievements(raw).find(row => row.id === id && row.playerId === player)!

describe('achievements', () => {
  it('awards exact thresholds with historical dates and ignores attendance gaps for lucky streaks', () => {
    const raw = history()
    expect(award(raw, 'regular-10')).toMatchObject({ progress: 10, sessionId: 's9', unlockedAt: raw.sessions[9].startedAt })
    expect(award(raw, 'lucky')).toMatchObject({ progress: 5, sessionId: 's4' })
    expect(award(raw, 'clean', 'b').unlockedAt).toBeNull()
    raw.attendance.find(row => row.playerId === 'a' && row.sessionId === 's2')!.present = false
    expect(award(raw, 'loyal').sessionId).toBe('s7')
    expect(award(raw, 'lucky').sessionId).toBe('s5')
    expect(award(raw, 'regular-10').unlockedAt).toBeNull()
  })
  it('does not reward empty or unattended evenings and recalculates after correction', () => {
    const raw = history(5)
    raw.losses = []
    expect(buildAchievements(raw).every(row => row.progress === 0)).toBe(true)
    raw.losses = history(5).losses
    expect(award(raw, 'loyal').unlockedAt).not.toBeNull()
    raw.sessions.pop()
    expect(award(raw, 'loyal').unlockedAt).toBeNull()
  })
  it('counts tied Pechvögel and comeback at the next attended evening', () => {
    const raw = history(3)
    raw.losses.push({ ...raw.losses[0], playerId: 'a' })
    raw.attendance.find(row => row.playerId === 'a' && row.sessionId === 's1')!.present = false
    expect(award(raw, 'comeback').sessionId).toBe('s2')
    expect(award(raw, 'lucky').progress).toBe(1)
  })
})

it('escapes recap markup and excludes balances unless present explicitly', () => {
  const input = { title: '<script>&"', subtitle: 'Abend', evenings: 1, losses: 2, beerRounds: 0, players: [{ id: 'a', name: '<Anna>', losses: 2 }], achievements: [] }
  const svg = recapSvg(input)
  expect(svg).not.toContain('<script>')
  expect(svg).toContain('&lt;Anna&gt;')
  expect(svg).not.toContain('Kontostände')
  expect(recapSvg({ ...input, players: [{ ...input.players[0], debtCents: 100 }] })).toContain('Kontostände')
})

it('only accepts the new app scheme and valid one-time codes', () => {
  const code = 'A'.repeat(32)
  expect(invitationCode(`schockboard-next://connect?code=${code}`)).toBe(code)
  expect(invitationCode(`https://evil.test/connect?code=${code}`)).toBeNull()
  expect(invitationCode('schockboard-next://connect?code=short')).toBeNull()
})
