import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { deviceCommandsResponseSchema } from '@/remote/protocol'

import { buildDemoSnapshot, type DemoIds } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

async function setup() {
  server = await createTestServer()
  const { token } = await server.pair()
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file)
  const response = await server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: fs.readFileSync(file),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '6' },
  })
  expect(response.status).toBe(200)
  return { token, ids }
}

function queue(type: string, payload: unknown) {
  return server.admin('/api/admin/commands', { method: 'POST', body: JSON.stringify({ type, payload }) })
}

async function lossOf(ids: DemoIds, playerId: string) {
  const detail = await (await server.admin(`/api/admin/sessions/${ids.openSessionId}`)).json()
  return detail.losses.find((loss: { playerId: string }) => loss.playerId === playerId) as { id: string }
}

describe('command lifecycle', () => {
  it('requires a snapshot before commands can be checked', async () => {
    server = await createTestServer()
    const response = await queue('payment.record', { playerId: 'player_x', amountCents: 100 })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'no_snapshot' })
  })

  it('validates payloads with the protocol schemas and sanity-checks against the snapshot', async () => {
    const { ids } = await setup()
    expect((await queue('unknown.type', {})).status).toBe(400)
    expect((await queue('payment.record', { playerId: ids.players.anna, amountCents: -5 })).status).toBe(400)
    expect((await queue('correction.record', { playerId: ids.players.anna, amountCents: 0, reason: 'x' })).status).toBe(400)
    expect((await queue('payment.record', { playerId: 'player_missing', amountCents: 100 })).status).toBe(422)
    expect((await queue('player.create', { name: 'anna', isCore: false })).status).toBe(422)
    expect((await queue('player.update', { playerId: ids.players.anna })).status).toBe(422)

    const closedLoss = (await (await server.admin(`/api/admin/sessions/${ids.closedSessionId}`)).json()).losses[0]
    const closed = await queue('loss.void', { sessionId: ids.closedSessionId, playerId: closedLoss.playerId, entryId: closedLoss.id })
    // loss.void is an override now: closed evenings are allowed
    expect(closed.status).toBe(201)

    const loss = await lossOf(ids, ids.players.cem)
    expect((await queue('loss.void', { sessionId: ids.openSessionId, playerId: ids.players.anna, entryId: loss.id })).status).toBe(422)
    expect((await queue('loss.void', { sessionId: ids.openSessionId, playerId: ids.players.cem, entryId: loss.id })).status).toBe(201)
    expect((await queue('loss.void', { sessionId: ids.openSessionId, playerId: ids.players.cem, entryId: loss.id })).status).toBe(422)
  })

  it('goes pending → fetched by device → applied / rejected', async () => {
    const { token, ids } = await setup()
    const payment = await queue('payment.record', { playerId: ids.players.ben, amountCents: 500, note: '  Überweisung ' })
    expect(payment.status).toBe(201)
    const paymentCommand = await payment.json()
    expect(paymentCommand).toMatchObject({ status: 'pending', createdBy: 'snytex@snytex.de', payload: { note: 'Überweisung' } })

    const settings = await (
      await queue('settings.update', { defaultStakeCents: 50, cashboxLabel: 'Kasse', absencePenaltyMode: 'none' })
    ).json()
    const cancelled = await (await queue('player.create', { name: 'Emil', isCore: true })).json()
    expect((await server.admin(`/api/admin/commands/${cancelled.id}`, { method: 'DELETE' })).status).toBe(200)

    expect((await (await server.admin('/api/admin/status')).json()).pendingCommands).toBe(2)

    const fetched = await server.device(token, '/api/device/commands')
    expect(fetched.status).toBe(200)
    const body = deviceCommandsResponseSchema.parse(await fetched.json())
    expect(body.protocolVersion).toBe(1)
    expect(body.commands.map((command) => command.id)).toEqual([paymentCommand.id, settings.id])

    const results = await server.device(token, '/api/device/commands/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [
          { id: paymentCommand.id, status: 'applied', appliedAt: '2026-10-24T12:00:00.000Z' },
          { id: settings.id, status: 'rejected', error: 'Einstellungen gesperrt', appliedAt: '2026-10-24T12:00:01.000Z' },
          { id: 'cmd_unknown', status: 'applied', appliedAt: '2026-10-24T12:00:02.000Z' },
        ],
      }),
    })
    expect(results.status).toBe(200)
    expect(await results.json()).toEqual({ ok: true, accepted: 2, ignored: ['cmd_unknown'] })

    const list = (await (await server.admin('/api/admin/commands')).json()) as Array<{ id: string; status: string; error: string | null; appliedAt: string | null }>
    expect(list.map((command) => command.id)).toEqual([cancelled.id, settings.id, paymentCommand.id])
    expect(list.find((command) => command.id === paymentCommand.id)).toMatchObject({ status: 'applied', appliedAt: '2026-10-24T12:00:00.000Z', error: null })
    expect(list.find((command) => command.id === settings.id)).toMatchObject({ status: 'rejected', error: 'Einstellungen gesperrt' })
    expect(list.find((command) => command.id === cancelled.id)).toMatchObject({ status: 'cancelled' })

    // finished commands can no longer be cancelled; nothing left for the device
    expect((await server.admin(`/api/admin/commands/${paymentCommand.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await server.admin('/api/admin/commands/cmd_nope', { method: 'DELETE' })).status).toBe(404)
    const empty = await (await server.device(token, '/api/device/commands')).json()
    expect(empty.commands).toEqual([])
  })

  it('rejects malformed result payloads', async () => {
    const { token } = await setup()
    const response = await server.device(token, '/api/device/commands/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [{ id: 'x', status: 'maybe', appliedAt: 'now' }] }),
    })
    expect(response.status).toBe(400)
  })

  it('admin reads never leak the device token into logs', async () => {
    const { token } = await setup()
    await server.device(token, '/api/device/ping')
    expect(server.logs.join('\n')).not.toContain(token)
  })
})
