import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { addLossEntry, closeSession, createPlayer, createSession, getAppSettings, getDebtSummaries, getSessionDetail, listPlayers } from '@/db/queries'
import { setHandoffLocked } from '@/domain/write-access'
import { applyRemoteCommands, getUnreportedResults, markResultsReported } from '@/remote/executor'
import type { RemoteCommand } from '@/remote/protocol'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const actor = { accountId: 'acc_test', username: 'Test' }

function command(id: string, type: RemoteCommand['type'], payload: Record<string, unknown>): RemoteCommand {
  return { id, type, payload, createdAt: '2026-10-24T20:00:00Z', createdBy: 'snytex@snytex.de' }
}

beforeEach(() => {
  setHandoffLocked(false)
  memory.current = createMemoryDatabase()
  resetBootstrapFlag()
  ensureDatabaseReady()
  memory.current.runSync(
    "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_test', 'Test', '-', '-', 'x', 'x')"
  )
})

describe('remote command executor', () => {
  it('applies shared-round losses and beer exactly once and refuses bookings after close', () => {
    const playerId = createPlayer({ actor, name: 'Anna', isCore: true })
    const sessionId = createSession({ actor, title: 'Runde', notes: null, stakeCents: 100 })
    const commands = [command('loss', 'loss.record', { playerId, sessionId }), command('beer', 'beerround.record', { playerId, sessionId, amountCents: 600 })].map(c => ({ ...c, createdBy: 'device:handy' }))
    expect(applyRemoteCommands(commands, actor)).toBe(2)
    expect(applyRemoteCommands(commands, actor)).toBe(0)
    expect(getSessionDetail(sessionId)!.losses).toHaveLength(2)
    expect(getDebtSummaries()[0].openDebtCents).toBe(700)
    closeSession({ actor, sessionId })
    expect(applyRemoteCommands([{ ...commands[0], id: 'too-late' }], actor)).toBe(0)
    expect(getUnreportedResults().find(row => row.id === 'too-late')?.status).toBe('rejected')
  })

  it('persists preferences and blocks writes while a device transfer is frozen', () => {
    expect(applyRemoteCommands([command('prefs', 'settings.update', { defaultStakeCents: 100, cashboxLabel: 'Kasse', absencePenaltyMode: 'none', hapticsEnabled: false, achievementAnimations: false, autoBackup: false })], actor)).toBe(1)
    expect(getAppSettings()).toMatchObject({ hapticsEnabled: false, achievementAnimations: false, autoBackup: false })
    setHandoffLocked(true)
    expect(() => createPlayer({ actor, name: 'Blocked', isCore: false })).toThrow()
    setHandoffLocked(false)
    expect(listPlayers()).toEqual([])
  })

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

  it('deletes single log entries or purges the log silently', () => {
    createPlayer({ actor, name: 'Ben', isCore: true })
    createPlayer({ actor, name: 'Cem', isCore: true })
    const ids = memory.current.getAllSync<{ id: string }>('SELECT id FROM audit_events ORDER BY created_at').map((row) => row.id)
    expect(ids.length).toBeGreaterThanOrEqual(2)

    applyRemoteCommands([command('a1', 'audit.delete', { auditIds: [ids[0]] })], actor)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events WHERE id = $id', { $id: ids[0] })!.n).toBe(0)

    applyRemoteCommands([command('a2', 'audit.purge', {})], actor)
    expect(memory.current.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBe(0)
    expect(listPlayers()).toHaveLength(2) // data itself untouched
  })
})
