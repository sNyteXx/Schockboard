import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import {
  addBeerRoundEntry,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  deleteLastLoss,
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
