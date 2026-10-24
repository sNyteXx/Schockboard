import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { addLossEntry, closeSession, createPlayer, createSession, getDebtSummaries, listPlayers } from '@/db/queries'
import { applyRemoteCommands, getUnreportedResults, markResultsReported } from '@/remote/executor'
import type { RemoteCommand } from '@/remote/protocol'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }

function command(id: string, type: RemoteCommand['type'], payload: Record<string, unknown>): RemoteCommand {
  return { id, type, payload, createdAt: '2026-10-24T20:00:00Z', createdBy: 'snytex@snytex.de' }
}

beforeEach(() => {
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  memory.current.runSync(
    "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', 'x', 'x')"
  )
})

describe('remote command executor', () => {
  it('applies a correction exactly once, even if the server sends it again', () => {
    const playerId = createPlayer({ actor, name: 'Anna', isCore: true })
    const correction = command('cmd_1', 'correction.record', { playerId, amountCents: -250, reason: 'Kasse gezählt' })

    expect(applyRemoteCommands([correction], actor)).toBe(1)
    expect(applyRemoteCommands([correction], actor)).toBe(0)

    expect(getDebtSummaries().find((row) => row.playerId === playerId)!.openDebtCents).toBe(-250)
    // Silent: neither a remote marker nor the regular correction event, no "(Web)" tag.
    const audit = memory.current.getAllSync<{ event_type: string }>("SELECT event_type FROM audit_events WHERE event_type LIKE 'correction.%' OR event_type LIKE 'remote.%'")
    expect(audit).toEqual([])
    expect(memory.current.getFirstSync<{ reason: string }>('SELECT reason FROM corrections')!.reason).toBe('Kasse gezählt')
  })

  it('records invalid or failing commands as rejected without changing data', () => {
    const results = applyRemoteCommands(
      [
        command('cmd_bad', 'payment.record', { playerId: 'p', amountCents: -5 }),
        command('cmd_missing', 'loss.void', { sessionId: 's', playerId: 'p', entryId: 'e' }),
      ],
      actor
    )

    expect(results).toBe(0)
    const unreported = getUnreportedResults()
    expect(unreported.map((row) => [row.id, row.status])).toEqual([
      ['cmd_bad', 'rejected'],
      ['cmd_missing', 'rejected'],
    ])
    expect(unreported[1].error).toMatch(/nicht gefunden/)
  })

  it('creates and updates players and tracks reporting', () => {
    applyRemoteCommands([command('cmd_p', 'player.create', { name: 'Gast Gerd', isCore: false })], actor)
    const gerd = listPlayers().find((player) => player.name === 'Gast Gerd')!
    applyRemoteCommands([command('cmd_u', 'player.update', { playerId: gerd.id, isCore: true })], actor)

    expect(listPlayers().find((player) => player.id === gerd.id)!.isCore).toBe(true)
    markResultsReported(getUnreportedResults().map((row) => row.id))
    expect(getUnreportedResults()).toEqual([])
  })

  it('voids the exact remote entry atomically and only once', () => {
    const playerId = createPlayer({ actor, name: 'Ben', isCore: true })
    createSession({ actor, title: 'Abend', notes: null, stakeCents: 100 })
    const sessionId = memory.current.getFirstSync<{ id: string }>("SELECT id FROM sessions WHERE status = 'open'")!.id
    const first = addLossEntry({ actor, sessionId, playerId, note: null })
    addLossEntry({ actor, sessionId, playerId, note: null })
    const voidFirst = command('cmd_v', 'loss.void', { sessionId, playerId, entryId: first })

    expect(applyRemoteCommands([voidFirst], actor)).toBe(1)
    expect(applyRemoteCommands([voidFirst], actor)).toBe(0)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM loss_entries')!.n).toBe(1)
    expect(memory.current.getFirstSync<{ id: string }>('SELECT id FROM loss_entries')!.id).not.toBe(first)
  })

  it('lets the admin revise closed evenings without leaving receipts', () => {
    const anna = createPlayer({ actor, name: 'Anna', isCore: true })
    createSession({ actor, title: 'Freitag', notes: null, stakeCents: 100 })
    const sessionId = memory.current.getFirstSync<{ id: string }>("SELECT id FROM sessions WHERE status = 'open'")!.id
    const loss = addLossEntry({ actor, sessionId, playerId: anna, note: null })
    addLossEntry({ actor, sessionId, playerId: anna, note: null })
    closeSession({ actor, sessionId })
    const auditBefore = memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n

    applyRemoteCommands(
      [
        command('o1', 'entry.update', { kind: 'loss', entryId: loss, amountCents: 300, note: 'nachgezählt' }),
        command('o2', 'player.rename', { playerId: anna, name: 'Annika' }),
        command('o3', 'session.update', { sessionId, title: 'Freitag (Derby)' }),
      ],
      actor
    )

    expect(getDebtSummaries().find((row) => row.playerId === anna)!.openDebtCents).toBe(400)
    expect(listPlayers().find((player) => player.id === anna)!.name).toBe('Annika')
    expect(memory.current.getFirstSync<{ title: string }>('SELECT title FROM sessions')!.title).toBe('Freitag (Derby)')
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBe(auditBefore)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM corrections')!.n).toBe(0)

    applyRemoteCommands([command('o4', 'session.delete', { sessionId })], actor)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM loss_entries')!.n).toBe(0)
    expect(getDebtSummaries().find((row) => row.playerId === anna)!.openDebtCents).toBe(0)
  })
})
