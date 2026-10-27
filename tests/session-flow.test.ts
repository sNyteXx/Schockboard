import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import {
  deletePlayer,
  addGuestToSession,
  updatePlayerFlags,
  cancelSession,
  addBeerRoundEntry,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  deleteLastLoss,
  getAppSettings,
  getDebtSummaries,
  getSessionDetail,
  toggleAttendance,
  updateAppSettings,
} from '@/db/queries'
import type { AbsencePenaltyMode } from '@/domain/types'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }

function freshDatabase(mode: AbsencePenaltyMode) {
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  memory.current.runSync(
    "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', '2026-01-01', '2026-01-01')"
  )
  updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: mode })
}

/** 3 present regulars, 2 absent regulars, stake 1,00 €. */
function setUpEvening(mode: AbsencePenaltyMode) {
  freshDatabase(mode)
  const ids = ['Anna', 'Ben', 'Cem', 'Dana', 'Emil'].map((name) => createPlayer({ actor, name, isCore: true }))
  createSession({ actor, title: 'Freitag', notes: null, stakeCents: 100 })
  const sessionId = memory.current.getFirstSync<{ id: string }>("SELECT id FROM sessions WHERE status = 'open'")!.id
  const attendance = getSessionDetail(sessionId)!.attendance
  for (const absent of ids.slice(3)) {
    if (attendance.find((row) => row.playerId === absent)?.present) toggleAttendance({ actor, sessionId, playerId: absent })
  }
  for (const present of ids.slice(0, 3)) {
    if (!attendance.find((row) => row.playerId === present)?.present) toggleAttendance({ actor, sessionId, playerId: present })
  }
  return { sessionId, present: ids.slice(0, 3), absent: ids.slice(3) }
}

function absenceOf(playerId: string) {
  return getDebtSummaries().find((row) => row.playerId === playerId)!.absenceCents
}

describe('closing an evening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each<AbsencePenaltyMode>(['full_average', 'split_absent'])('charges exactly what the open-session preview showed (%s)', (mode) => {
    const { sessionId, present, absent } = setUpEvening(mode)
    // 5 losses à 1,00 € across 3 present regulars → average 1,67 €
    for (const playerId of [present[0], present[0], present[1], present[1], present[2]]) {
      addLossEntry({ actor, sessionId, playerId, note: null })
    }
    // Beer rounds must not raise the absence average.
    addBeerRoundEntry({ actor, sessionId, playerId: present[2], amountCents: 500, note: null })

    const preview = absent.map(absenceOf)
    closeSession({ actor, sessionId })
    const charged = absent.map(absenceOf)

    expect(charged).toEqual(preview)
    expect(charged).toEqual(mode === 'split_absent' ? [84, 84] : [167, 167])
  })

  it.each<AbsencePenaltyMode>(['full_average', 'split_absent'])('counts beer rounds of present regulars into the average when enabled, preview matching the charge (%s)', (mode) => {
    const { sessionId, present, absent } = setUpEvening(mode)
    for (const playerId of [present[0], present[0], present[1], present[1], present[2]]) {
      addLossEntry({ actor, sessionId, playerId, note: null })
    }
    addBeerRoundEntry({ actor, sessionId, playerId: present[2], amountCents: 500, note: null })
    // Beer round of an absent regular is no basis for anyone.
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: mode, beerRoundsInAverage: true })

    const preview = absent.map(absenceOf)
    closeSession({ actor, sessionId })
    const charged = absent.map(absenceOf)

    // (5 × 1,00 € + 5,00 €) ÷ 3 present = 3,33 €
    expect(charged).toEqual(preview)
    expect(charged).toEqual(mode === 'split_absent' ? [167, 167] : [333, 333])
  })

  it('keeps the previous calculation when the option is off and persists the switch', () => {
    const { sessionId, present, absent } = setUpEvening('full_average')
    expect(getAppSettings().beerRoundsInAverage).toBe(false)
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    addBeerRoundEntry({ actor, sessionId, playerId: present[1], amountCents: 900, note: null })
    expect(absent.map(absenceOf)).toEqual([33, 33])

    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average', beerRoundsInAverage: true })
    expect(getAppSettings().beerRoundsInAverage).toBe(true)
    expect(absent.map(absenceOf)).toEqual([333, 333])

    // Omitting the flag leaves it untouched; switching off restores the old result.
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average' })
    expect(getAppSettings().beerRoundsInAverage).toBe(true)
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average', beerRoundsInAverage: false })
    expect(absent.map(absenceOf)).toEqual([33, 33])
    // Historic entries are never rewritten.
    expect(memory.current.getFirstSync<{ n: number }>('SELECT SUM(amount_cents) AS n FROM loss_entries')!.n).toBe(1000)
  })

  it('charges nothing for an evening with only beer rounds unless enabled', () => {
    const { sessionId, present, absent } = setUpEvening('full_average')
    addBeerRoundEntry({ actor, sessionId, playerId: present[0], amountCents: 600, note: null })
    expect(absent.map(absenceOf)).toEqual([0, 0])
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average', beerRoundsInAverage: true })
    expect(absent.map(absenceOf)).toEqual([200, 200])
    closeSession({ actor, sessionId })
    expect(absent.map(absenceOf)).toEqual([200, 200])
  })

  it('does not charge absence on an evening without any bookings, whatever the switch', () => {
    const { sessionId, absent } = setUpEvening('full_average')
    updateAppSettings({ actor, defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'full_average', beerRoundsInAverage: true })
    expect(closeSession({ actor, sessionId }).absenceChargeCount).toBe(0)
    expect(absent.map(absenceOf)).toEqual([0, 0])
  })

  it('never assesses absence charges twice', () => {
    const { sessionId, present, absent } = setUpEvening('full_average')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    closeSession({ actor, sessionId })
    const second = closeSession({ actor, sessionId })

    expect(second.absenceChargeCount).toBe(0)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM absence_charges')!.n).toBe(absent.length)
  })
})

describe('voiding losses', () => {
  it('removes the newest normal loss but leaves beer rounds alone', () => {
    const { sessionId, present } = setUpEvening('none')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    addBeerRoundEntry({ actor, sessionId, playerId: present[0], amountCents: 500, note: null })

    deleteLastLoss({ actor, sessionId, playerId: present[0] })

    const debt = getDebtSummaries().find((row) => row.playerId === present[0])!
    expect(debt.openDebtCents).toBe(500) // only the beer round remains, no double deduction
  })

  it('voids exactly the given entry when an id is passed', () => {
    const { sessionId, present } = setUpEvening('none')
    const beer = addBeerRoundEntry({ actor, sessionId, playerId: present[0], amountCents: 700, note: null })
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })

    deleteLastLoss({ actor, sessionId, playerId: present[0], entryId: beer })

    expect(getDebtSummaries().find((row) => row.playerId === present[0])!.openDebtCents).toBe(100)
  })

  it('refuses to void on a closed evening', () => {
    const { sessionId, present } = setUpEvening('none')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    closeSession({ actor, sessionId })

    expect(() => deleteLastLoss({ actor, sessionId, playerId: present[0] })).toThrow(/offene/)
  })
})

describe('attendance guard', () => {
  it('refuses to mark a player absent who already has bookings tonight', () => {
    const { sessionId, present } = setUpEvening('full_average')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })

    expect(() => toggleAttendance({ actor, sessionId, playerId: present[0] })).toThrow(/Buchungen/)
    deleteLastLoss({ actor, sessionId, playerId: present[0] })
    expect(() => toggleAttendance({ actor, sessionId, playerId: present[0] })).not.toThrow()
  })
})

describe('cancelling an evening', () => {
  it('discards bookings without absence charges and keeps payments', () => {
    const { sessionId, present } = setUpEvening('full_average')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    addBeerRoundEntry({ actor, sessionId, playerId: present[1], amountCents: 500, note: null })

    cancelSession({ actor, sessionId })

    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(0)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM loss_entries')!.n).toBe(0)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM absence_charges')!.n).toBe(0)
    expect(getDebtSummaries().every((row) => row.openDebtCents === 0)).toBe(true)
  })

  it('refuses to cancel a closed evening', () => {
    const { sessionId } = setUpEvening('none')
    closeSession({ actor, sessionId })
    expect(() => cancelSession({ actor, sessionId })).toThrow(/offene/)
  })
})

describe('active and archived players', () => {
  it('never charges archived regulars and removes them from the open evening', () => {
    const { sessionId, present, absent } = setUpEvening('full_average')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })

    // absent regular gets archived mid-evening → no absence charge for them
    updatePlayerFlags({ actor, playerId: absent[0], isArchived: true })
    expect(getSessionDetail(sessionId)!.attendance.some((row) => row.playerId === absent[0])).toBe(false)

    closeSession({ actor, sessionId })
    const charged = memory.current.getAllSync<{ player_id: string }>('SELECT player_id FROM absence_charges').map((row) => row.player_id)
    expect(charged).toEqual([absent[1]])
  })

  it('refuses to archive a player with bookings tonight', () => {
    const { sessionId, present } = setUpEvening('none')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })
    expect(() => updatePlayerFlags({ actor, playerId: present[0], isArchived: true })).toThrow(/Buchungen/)
  })

  it('lets reactivated and new regulars join the running evening', () => {
    const { sessionId, absent } = setUpEvening('none')
    updatePlayerFlags({ actor, playerId: absent[0], isArchived: true })
    updatePlayerFlags({ actor, playerId: absent[0], isArchived: false })
    const fresh = createPlayer({ actor, name: 'Frieda', isCore: true })

    const attendance = getSessionDetail(sessionId)!.attendance
    expect(attendance.find((row) => row.playerId === absent[0])?.present).toBe(true)
    expect(attendance.find((row) => row.playerId === fresh)?.present).toBe(true)
  })

  it('reuses a returning guest instead of creating a duplicate', () => {
    const first = setUpEvening('none')
    addGuestToSession({ actor, sessionId: first.sessionId, name: 'Onkel Heinz' })
    closeSession({ actor, sessionId: first.sessionId })

    createSession({ actor, title: 'Nächste Woche', notes: null, stakeCents: 100 })
    const next = memory.current.getFirstSync<{ id: string }>("SELECT id FROM sessions WHERE status = 'open'")!.id
    addGuestToSession({ actor, sessionId: next, name: 'onkel heinz' })

    expect(memory.current.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM players WHERE lower(name) = 'onkel heinz'")!.n).toBe(1)
    expect(() => addGuestToSession({ actor, sessionId: next, name: 'Onkel Heinz' })).toThrow(/schon dabei/)
    expect(() => createPlayer({ actor, name: 'ANNA', isCore: true })).toThrow(/gibt es schon/)
  })
})

describe('deleting players', () => {
  it('removes an absent regular from the open evening, but refuses with bookings tonight', () => {
    const { sessionId, present, absent } = setUpEvening('full_average')
    addLossEntry({ actor, sessionId, playerId: present[0], note: null })

    deletePlayer({ actor, playerId: absent[0] })
    expect(getSessionDetail(sessionId)!.attendance.some((row) => row.playerId === absent[0])).toBe(false)
    expect(() => deletePlayer({ actor, playerId: present[0] })).toThrow(/Buchungen/)
  })
})

describe('closing preview explains the absence rule', () => {
  it('matches the booked charge and ignores archived players', async () => {
    const { buildEveningSummary, summaryInputFromDetail } = await import('@/domain/evening-summary')
    const { sessionId, present, absent } = setUpEvening('full_average')
    for (const playerId of [present[0], present[0], present[1], present[1], present[2]]) addLossEntry({ actor, sessionId, playerId, note: null })
    // simulate an archived player still listed in the evening (pre-2.0 data)
    memory.current.runSync('UPDATE players SET is_archived = 1 WHERE id = $id', { $id: absent[1] })

    const preview = buildEveningSummary(summaryInputFromDetail(getSessionDetail(sessionId)!, 'full_average'))
    expect(preview.absenceMath).toEqual({ baseCents: 500, presentCoreCount: 3, averageCents: 167, absentCoreCount: 1 })
    expect(preview.absentCore.map((player) => player.playerId)).toEqual([absent[0]])

    closeSession({ actor, sessionId })
    const booked = memory.current.getAllSync<{ player_id: string; amount_cents: number }>('SELECT player_id, amount_cents FROM absence_charges')
    expect(booked).toEqual([{ player_id: absent[0], amount_cents: preview.absenceChargeCents }])
  })
})
