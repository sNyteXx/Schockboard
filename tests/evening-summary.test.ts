import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import {
  addBeerRoundEntry,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  getSessionDetail,
  toggleAttendance,
  updateAppSettings,
} from '@/db/queries'
import {
  buildEveningSummary,
  findPechvogel,
  formatEveningSummaryText,
  summaryInputFromDetail,
  type EveningSummaryInput,
} from '@/domain/evening-summary'
import type { AbsencePenaltyMode } from '@/domain/types'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const attendance = [
  { playerId: 'a', playerName: 'Anna', isCore: true, present: true },
  { playerId: 'b', playerName: 'Ben', isCore: true, present: true },
  { playerId: 'c', playerName: 'Cem', isCore: true, present: true },
  { playerId: 'd', playerName: 'Dana', isCore: true, present: false },
  { playerId: 'e', playerName: 'Emil', isCore: true, present: false },
  { playerId: 'g', playerName: 'Gast Gerd', isCore: false, present: true },
]

function loss(playerId: string, amountCents = 100, isBeerRound = false) {
  const name = attendance.find((row) => row.playerId === playerId)!.playerName
  return { playerId, playerName: name, amountCents, isBeerRound }
}

function input(overrides: Partial<EveningSummaryInput> = {}): EveningSummaryInput {
  return {
    status: 'open',
    attendance,
    losses: [loss('a'), loss('a'), loss('b'), loss('b'), loss('c'), loss('g'), loss('c', 500, true)],
    absences: [],
    absencePenaltyMode: 'full_average',
    ...overrides,
  }
}

describe('buildEveningSummary', () => {
  it('ranks present players and totals losses and beer rounds', () => {
    const summary = buildEveningSummary(input())

    expect(summary.ranking.map((player) => player.playerName)).toEqual(['Anna', 'Ben', 'Cem', 'Gast Gerd'])
    expect(summary.lossCount).toBe(6)
    expect(summary.lossCents).toBe(600)
    expect(summary.beerRoundCount).toBe(1)
    expect(summary.beerRoundCents).toBe(500)
    expect(summary.ranking.find((player) => player.playerId === 'c')!.totalCents).toBe(600)
  })

  it('projects full-average absence charges from present regulars only (no guests, no beer)', () => {
    const summary = buildEveningSummary(input())
    // present regulars lost 5,00 € → average 1,67 €
    expect(summary.absenceChargeCents).toBe(167)
    expect(summary.absentCore.map((player) => player.absenceCents)).toEqual([167, 167])
    expect(summary.absenceCents).toBe(334)
    expect(summary.totalCents).toBe(600 + 500 + 334)
  })

  it('splits the rounded average among absent regulars', () => {
    const summary = buildEveningSummary(input({ absencePenaltyMode: 'split_absent' }))
    expect(summary.absenceChargeCents).toBe(84)
  })

  it('explains why no charges apply', () => {
    expect(buildEveningSummary(input({ absencePenaltyMode: 'none' })).absenceSkipReason).toBe('disabled')
    expect(buildEveningSummary(input({ losses: [loss('g')] })).absenceSkipReason).toBe('no-losses')
    const nobody = attendance.map((row) => (row.isCore ? { ...row, present: false } : row))
    const summary = buildEveningSummary(input({ attendance: nobody, losses: [loss('g')] }))
    expect(summary.absenceSkipReason).toBe('no-present-core')
    expect(summary.absenceCents).toBe(0)
  })

  it('uses booked charges for closed evenings', () => {
    const summary = buildEveningSummary(
      input({ status: 'closed', absences: [{ playerId: 'd', playerName: 'Dana', amountCents: 150 }] })
    )
    expect(summary.isFinal).toBe(true)
    expect(summary.absentCore.map((player) => player.absenceCents)).toEqual([150, 0])
    expect(summary.absenceCents).toBe(150)
  })

  it('names all tied players as Pechvogel and ignores beer rounds', () => {
    const summary = buildEveningSummary(input())
    expect(summary.pechvogel?.names).toEqual(['Anna', 'Ben'])
    expect(summary.pechvogel?.lossCount).toBe(2)
    expect(findPechvogel([])).toBeNull()
    expect(buildEveningSummary(input({ losses: [loss('a', 500, true)] })).pechvogel).toBeNull()
  })

  it('renders a shareable text', () => {
    const text = formatEveningSummaryText(buildEveningSummary(input()), { title: 'Freitag', dateLabel: '24.10.2026' })
    expect(text).toContain('Pechvogel des Abends: Anna & Ben')
    expect(text).toContain('Dana')
    expect(text).toMatch(/Gesamt: 14,34/)
  })
})

describe('summary preview vs. closeSession', () => {
  const actor = { accountId: 'acc_test', username: 'Test' }

  it.each<AbsencePenaltyMode>(['full_average', 'split_absent', 'none'])('preview equals booked charges (%s)', (mode) => {
    memory.current = createMemoryDatabase()
    resetBootstrapFlag()
    ensureDatabaseReady()
    memory.current.runSync(
      "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', '2026-01-01', '2026-01-01')"
    )
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: mode })
    const ids = ['Anna', 'Ben', 'Cem', 'Dana', 'Emil'].map((name) => createPlayer({ actor, name, isCore: true }))
    const sessionId = createSession({ actor, title: 'Freitag', notes: null, stakeCents: 100 })
    for (const absent of ids.slice(3)) toggleAttendance({ actor, sessionId, playerId: absent })
    for (const playerId of [ids[0], ids[0], ids[1], ids[1], ids[2]]) addLossEntry({ actor, sessionId, playerId, note: null })
    addBeerRoundEntry({ actor, sessionId, playerId: ids[2], amountCents: 500, note: null })

    const preview = buildEveningSummary(summaryInputFromDetail(getSessionDetail(sessionId)!, mode))
    closeSession({ actor, sessionId })
    const final = buildEveningSummary(summaryInputFromDetail(getSessionDetail(sessionId)!, mode))

    expect(final.isFinal).toBe(true)
    expect(final.absentCore.map((player) => player.absenceCents)).toEqual(preview.absentCore.map((player) => player.absenceCents))
    expect(final.totalCents).toBe(preview.totalCents)
  })
})
