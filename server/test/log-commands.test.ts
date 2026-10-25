import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { openStore } from '../src/store'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>> | undefined

afterEach(() => {
  server?.cleanup()
  server = undefined
})

async function setup() {
  const created = await createTestServer()
  server = created
  const { token } = await created.pair()
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file)
  await created.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: fs.readFileSync(file),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '6' },
  })
  return { token, ids }
}

const queue = (type: string, payload: unknown) =>
  server!.admin('/api/admin/commands', { method: 'POST', body: JSON.stringify({ type, payload }) })

describe('app log commands', () => {
  it('checks that audit ids exist in the snapshot', async () => {
    await setup()
    const audit = (await (await server!.admin('/api/admin/history?kind=audit')).json()) as Array<{ id: string }>
    expect(audit.length).toBeGreaterThan(1)
    expect((await queue('audit.delete', { auditIds: [] })).status).toBe(400)
    expect((await queue('audit.delete', { auditIds: [audit[0].id, 'audit_missing'] })).status).toBe(422)
    expect((await queue('audit.delete', { auditIds: [audit[0].id, audit[1].id] })).status).toBe(201)
  })

  it('validates audit.purge', async () => {
    await setup()
    expect((await queue('audit.purge', { before: 'gestern' })).status).toBe(400)
    expect((await queue('audit.purge', { before: '2000-01-01T00:00:00.000Z' })).status).toBe(422)
    expect((await queue('audit.purge', {})).status).toBe(201)
    expect((await queue('audit.purge', { before: new Date(Date.now() + 60_000).toISOString() })).status).toBe(201)
  })
})

describe('command history', () => {
  it('DELETE /commands removes finished commands and keeps pending ones', async () => {
    const { token, ids } = await setup()
    const applied = await (await queue('payment.record', { playerId: ids.players.ben, amountCents: 100 })).json()
    const cancelled = await (await queue('player.create', { name: 'Emil', isCore: true })).json()
    const pending = await (await queue('payment.record', { playerId: ids.players.cem, amountCents: 100 })).json()
    await server!.admin(`/api/admin/commands/${cancelled.id}`, { method: 'DELETE' })
    await server!.device(token, '/api/device/commands/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [{ id: applied.id, status: 'applied', appliedAt: new Date().toISOString() }] }),
    })
    const response = await server!.admin('/api/admin/commands', { method: 'DELETE' })
    expect(await response.json()).toEqual({ ok: true, deleted: 2 })
    const list = (await (await server!.admin('/api/admin/commands')).json()) as Array<{ id: string }>
    expect(list.map((command) => command.id)).toEqual([pending.id])
  })

  it('retention purges only finished commands older than the limit', () => {
    let clock = '2026-01-01T00:00:00.000Z'
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ret-'))
    const store = openStore(path.join(dir, 'server.db'), () => clock)
    try {
      const old = store.createCommand({ deviceId: 'dev_a', type: 'player.create', payload: { name: 'A', isCore: true }, createdBy: 'x' })
      store.cancelCommand(old.id)
      const oldPending = store.createCommand({ deviceId: 'dev_a', type: 'player.create', payload: { name: 'B', isCore: true }, createdBy: 'x' })
      clock = '2026-02-15T00:00:00.000Z'
      const recent = store.createCommand({ deviceId: 'dev_a', type: 'player.create', payload: { name: 'C', isCore: true }, createdBy: 'x' })
      store.cancelCommand(recent.id)
      expect(store.purgeFinishedCommands(30)).toBe(1)
      expect(store.listCommands(null).map((command) => command.id).sort()).toEqual([oldPending.id, recent.id].sort())
    } finally {
      store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
