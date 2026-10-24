import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)
vi.mock('expo-secure-store', () => ({}))

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { createPlayer, getDebtSummaries, listPlayers } from '@/db/queries'
import { normalizeServerOrigin } from '@/remote/config'
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
    const audit = memory.current.getAllSync<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'remote.command_applied'")
    expect(audit[0].n).toBe(1)
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
    expect(unreported[1].error).toMatch(/offene/)
  })

  it('creates and updates players and tracks reporting', () => {
    applyRemoteCommands([command('cmd_p', 'player.create', { name: 'Gast Gerd', isCore: false })], actor)
    const gerd = listPlayers().find((player) => player.name === 'Gast Gerd')!
    applyRemoteCommands([command('cmd_u', 'player.update', { playerId: gerd.id, isCore: true })], actor)

    expect(listPlayers().find((player) => player.id === gerd.id)!.isCore).toBe(true)
    markResultsReported(getUnreportedResults().map((row) => row.id))
    expect(getUnreportedResults()).toEqual([])
  })
})

describe('pairing target', () => {
  it('accepts only the own https admin server', () => {
    expect(normalizeServerOrigin('https://sh0ckb04rd.snytex.de/egal')).toBe('https://sh0ckb04rd.snytex.de')
    expect(() => normalizeServerOrigin('http://sh0ckb04rd.snytex.de')).toThrow(/HTTPS/)
    expect(() => normalizeServerOrigin('https://evil.example.com')).toThrow(/abgelehnt/)
  })
})
