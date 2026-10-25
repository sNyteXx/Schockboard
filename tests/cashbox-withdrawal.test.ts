import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { addLossEntry, createPlayer, createSession, getCashboxSummary, getDebtSummaries, getHistoryEntries, recordPayment, recordWithdrawal } from '@/db/queries'
import { applyRemoteCommands } from '@/remote/executor'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }

beforeEach(() => {
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  memory.current.runSync("INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', 'x', 'x')")
})

describe('cashbox withdrawals', () => {
  it('lower the cash on hand but never player balances', () => {
    const anna = createPlayer({ actor, name: 'Anna', isCore: true })
    createSession({ actor, title: 'Abend', notes: null, stakeCents: 100 })
    const sessionId = memory.current.getFirstSync<{ id: string }>("SELECT id FROM sessions WHERE status = 'open'")!.id
    addLossEntry({ actor, sessionId, playerId: anna, note: null })
    recordPayment({ actor, playerId: anna, amountCents: 3000, note: null })

    recordWithdrawal({ actor, amountCents: 1850, note: 'Kasten Bier' })

    const cash = getCashboxSummary()
    expect(cash).toMatchObject({ totalPaymentsCents: 3000, totalWithdrawalsCents: 1850, cashOnHandCents: 1150 })
    expect(getDebtSummaries().find((row) => row.playerId === anna)!.openDebtCents).toBe(100 - 3000)
    expect(getHistoryEntries().some((entry) => entry.kind === 'withdrawal' && entry.message === 'Kasten Bier')).toBe(true)
  })

  it('refuses to take out more than is in the box or without a purpose', () => {
    expect(() => recordWithdrawal({ actor, amountCents: 100, note: 'Chips' })).toThrow(/nur 0,00 €/)
    const ben = createPlayer({ actor, name: 'Ben', isCore: true })
    recordPayment({ actor, playerId: ben, amountCents: 500, note: null })
    expect(() => recordWithdrawal({ actor, amountCents: 100, note: '  ' })).toThrow(/wofür/)
  })

  it('can be booked, edited and deleted silently from the web', () => {
    const ben = createPlayer({ actor, name: 'Ben', isCore: true })
    recordPayment({ actor, playerId: ben, amountCents: 2000, note: null })
    const command = (id: string, type: never, payload: Record<string, unknown>) => ({ id, type, payload, createdAt: 'x', createdBy: 'admin' })

    applyRemoteCommands([command('w1', 'cashbox.withdraw' as never, { amountCents: 500, note: 'Pizza' })], actor)
    const id = memory.current.getFirstSync<{ id: string }>('SELECT id FROM cashbox_withdrawals')!.id
    applyRemoteCommands([command('w2', 'entry.update' as never, { kind: 'withdrawal', entryId: id, amountCents: 700 })], actor)
    expect(getCashboxSummary().cashOnHandCents).toBe(1300)
    applyRemoteCommands([command('w3', 'entry.delete' as never, { kind: 'withdrawal', entryId: id })], actor)
    expect(getCashboxSummary().cashOnHandCents).toBe(2000)
    expect(memory.current.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'cashbox.withdrawal'")!.n).toBe(0)
  })
})
