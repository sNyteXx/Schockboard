import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
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

type Row = { id: string; kind: string; entryKind: string | null; note: string | null; playerId: string | null }

async function history(kind: string) {
  return (await (await server.admin(`/api/admin/history?kind=${kind}`)).json()) as Row[]
}

describe('admin override commands', () => {
  it('exposes booking ids, kinds and raw notes in history and session detail', async () => {
    const { ids } = await setup()
    const payments = await history('payment')
    expect(payments[0]).toMatchObject({ kind: 'payment', entryKind: 'payment', note: 'Bar' })
    const beer = await history('beerround')
    expect(beer[0]).toMatchObject({ kind: 'beerround', entryKind: 'loss' })
    const corrections = await history('correction')
    expect(corrections[0]).toMatchObject({ entryKind: 'correction', note: 'Rundungsfehler' })

    const detail = await (await server.admin(`/api/admin/sessions/${ids.closedSessionId}`)).json()
    expect(detail.losses.length).toBeGreaterThan(0)
    expect(detail.losses[0].id).toBeTruthy()
    expect(detail.absences[0]).toMatchObject({ playerId: ids.players.dana })
    expect(detail.timeline.every((entry: Row) => entry.kind === 'audit' || entry.entryKind)).toBe(true)
  })

  it('validates entry.delete and entry.update against the snapshot', async () => {
    const { ids } = await setup()
    const [payment] = await history('payment')
    const [correction] = await history('correction')
    const detail = await (await server.admin(`/api/admin/sessions/${ids.closedSessionId}`)).json()
    const loss = detail.losses[0]
    const absence = detail.absences[0]

    // wrong kind / unknown id
    expect((await queue('entry.delete', { kind: 'loss', entryId: payment.id })).status).toBe(422)
    expect((await queue('entry.delete', { kind: 'payment', entryId: 'pay_missing' })).status).toBe(422)
    expect((await queue('entry.delete', { kind: 'nope', entryId: payment.id })).status).toBe(400)

    // closed evening bookings are editable
    expect((await queue('entry.delete', { kind: 'absence', entryId: absence.id })).status).toBe(201)
    const duplicate = await queue('entry.delete', { kind: 'absence', entryId: absence.id })
    expect(duplicate.status).toBe(422)
    expect((await queue('entry.update', { kind: 'absence', entryId: absence.id, amountCents: 10 })).status).toBe(422)

    expect((await queue('entry.update', { kind: 'loss', entryId: loss.id })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'loss', entryId: loss.id, amountCents: -1 })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'payment', entryId: payment.id, amountCents: -100 })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'correction', entryId: correction.id, amountCents: 0 })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'correction', entryId: correction.id, note: '' })).status).toBe(422)
    expect((await queue('entry.update', { kind: 'correction', entryId: correction.id, amountCents: -75 })).status).toBe(201)
    expect((await queue('entry.update', { kind: 'loss', entryId: loss.id, amountCents: 0, note: 'Freirunde' })).status).toBe(201)
    expect((await queue('entry.update', { kind: 'payment', entryId: payment.id, note: null })).status).toBe(201)

    // loss.void and entry.delete guard each other
    expect((await queue('loss.void', { sessionId: ids.closedSessionId, playerId: loss.playerId, entryId: loss.id })).status).toBe(201)
    expect((await queue('entry.delete', { kind: 'loss', entryId: loss.id })).status).toBe(422)
  })

  it('validates player.rename', async () => {
    const { ids } = await setup()
    expect((await queue('player.rename', { playerId: 'player_missing', name: 'Zoe' })).status).toBe(422)
    expect((await queue('player.rename', { playerId: ids.players.anna, name: 'BEN' })).status).toBe(422)
    expect((await queue('player.rename', { playerId: ids.players.anna, name: 'ANNA' })).status).toBe(201)
    expect((await queue('player.rename', { playerId: ids.players.ben, name: '  Benjamin ' })).status).toBe(201)
    expect((await queue('player.rename', { playerId: ids.players.cem, name: 'benjamin' })).status).toBe(422)
    expect((await queue('player.create', { name: 'Emil', isCore: true })).status).toBe(201)
    expect((await queue('player.rename', { playerId: ids.players.dana, name: 'emil' })).status).toBe(422)
    expect((await queue('player.rename', { playerId: ids.players.dana, name: '' })).status).toBe(400)
  })

  it('validates session.update and session.delete', async () => {
    const { ids } = await setup()
    expect((await queue('session.update', { sessionId: 'ses_missing', title: 'X' })).status).toBe(422)
    expect((await queue('session.update', { sessionId: ids.closedSessionId })).status).toBe(422)
    expect((await queue('session.update', { sessionId: ids.closedSessionId, stakeCents: -1 })).status).toBe(400)
    expect((await queue('session.update', { sessionId: ids.closedSessionId, title: 'Freitag (Derby)', stakeCents: 50 })).status).toBe(201)
    expect((await queue('session.delete', { sessionId: 'ses_missing' })).status).toBe(422)
    expect((await queue('session.delete', { sessionId: ids.openSessionId })).status).toBe(201)
    expect((await queue('session.delete', { sessionId: ids.openSessionId })).status).toBe(422)
  })
})
