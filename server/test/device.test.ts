import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

function upload(token: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'X-Schockboard-Schema': '6',
      'X-Snapshot-Created-At': '2026-10-24T10:00:00.000Z',
      ...headers,
    },
  })
}

describe('device auth', () => {
  it('rejects missing, malformed and unknown tokens', async () => {
    server = await createTestServer()
    expect((await server.app.request('/api/device/ping')).status).toBe(401)
    expect((await server.device('x', '/api/device/ping')).status).toBe(401)
    expect((await server.device('A'.repeat(43), '/api/device/ping')).status).toBe(401)
  })

  it('accepts the paired token, stores only its hash and updates lastSeenAt', async () => {
    server = await createTestServer()
    const { token } = await server.pair()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const stored = server.store.db.prepare('SELECT * FROM devices').all()
    expect(JSON.stringify(stored)).not.toContain(token)

    let status = await (await server.admin('/api/admin/status')).json()
    expect(status).toMatchObject({ paired: true, lastSeenAt: null })

    const ping = await server.device(token, '/api/device/ping')
    expect(ping.status).toBe(200)
    expect(await ping.json()).toEqual({ ok: true })

    status = await (await server.admin('/api/admin/status')).json()
    expect(status.lastSeenAt).toEqual(expect.any(String))
  })

  it('pairing adds devices; each token stays valid until that device is blocked', async () => {
    server = await createTestServer()
    const first = await server.pair()
    const second = await server.pair()
    expect((await server.device(first.token, '/api/device/ping')).status).toBe(200)
    expect((await server.device(second.token, '/api/device/ping')).status).toBe(200)
    await server.admin(`/api/admin/devices/${first.deviceId}/revoke`, { method: 'POST' })
    expect((await server.device(first.token, '/api/device/ping')).status).toBe(401)
    expect((await server.device(second.token, '/api/device/ping')).status).toBe(200)
  })

  it('rate-limits device endpoints', async () => {
    server = await createTestServer({ deviceRateLimitPerMinute: 3 })
    const { token } = await server.pair()
    const statuses = []
    for (let i = 0; i < 5; i++) statuses.push((await server.device(token, '/api/device/ping')).status)
    expect(statuses).toEqual([200, 200, 200, 429, 429])
  })
})

describe('snapshot upload', () => {
  it('rejects non-SQLite bodies, wrong content types and oversize uploads', async () => {
    server = await createTestServer({ maxSnapshotBytes: 64 * 1024 })
    const { token } = await server.pair()
    expect((await upload(token, new TextEncoder().encode('hello world'.repeat(100)))).status).toBe(400)
    expect((await upload(token, new Uint8Array(1024), { 'Content-Type': 'text/plain' })).status).toBe(415)
    const big = new Uint8Array(128 * 1024)
    big.set(new TextEncoder().encode('SQLite format 3\0'))
    expect((await upload(token, big)).status).toBe(413)
    expect((await server.admin('/api/admin/dashboard')).status).toBe(409)
  })

  it('rejects a SQLite file that is not a Schockboard database', async () => {
    server = await createTestServer()
    const { token } = await server.pair()
    const file = tempFile('other.sqlite')
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE x (a); INSERT INTO x VALUES (1);')
    db.close()
    const response = await upload(token, fs.readFileSync(file))
    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain('players')
  })

  it('makes uploaded data visible through the app queries (WAL header image)', async () => {
    server = await createTestServer()
    const { token } = await server.pair()
    expect((await server.admin('/api/admin/dashboard')).status).toBe(409)

    const file = tempFile('snap.sqlite')
    const ids = buildDemoSnapshot(file, { wal: true })
    const bytes = fs.readFileSync(file)
    expect(bytes[18]).toBe(2)

    const response = await upload(token, bytes)
    expect(response.status).toBe(200)
    const deviceId = server.store.listActiveDevices()[0].id
    expect(await response.json()).toMatchObject({ ok: true, sizeBytes: bytes.length, schemaVersion: 6 })

    // raw image kept untouched, working copy switched to rollback journal
    expect(fs.readFileSync(server.snapshots.rawFile(deviceId))[18]).toBe(2)
    expect(fs.readFileSync(server.snapshots.workFile(deviceId))[18]).toBe(1)

    const status = await (await server.admin('/api/admin/status')).json()
    expect(status).toMatchObject({ schemaVersion: 6, snapshotCreatedAt: '2026-10-24T10:00:00.000Z', snapshotSizeBytes: bytes.length })
    expect(status.lastSnapshotAt).toEqual(expect.any(String))

    const dashboard = await (await server.admin('/api/admin/dashboard')).json()
    expect(dashboard.openSession).toMatchObject({ id: ids.openSessionId, title: 'Samstag', lossCount: 2 })
    expect(dashboard.cashbox.totalPaymentsCents).toBe(200)

    const debts = (await (await server.admin('/api/admin/debts')).json()) as Array<{ playerId: string; openDebtCents: number; absenceCents: number }>
    const byId = Object.fromEntries(debts.map((row) => [row.playerId, row]))
    // Freitag: Anna 2×1€, Ben 1€, Cem Bierrunde 6€; Dana absent → avg (2+1+0)/3 = 1€
    expect(byId[ids.players.anna].openDebtCents).toBe(200 - 200)
    expect(byId[ids.players.ben].openDebtCents).toBe(100 - 50)
    expect(byId[ids.players.cem].openDebtCents).toBe(600 + 50)
    expect(byId[ids.players.dana].absenceCents).toBe(100)

    const players = await (await server.admin('/api/admin/players')).json()
    expect(players).toHaveLength(4)
    const sessions = await (await server.admin('/api/admin/sessions')).json()
    expect(sessions.map((s: { title: string }) => s.title)).toEqual(['Samstag', 'Freitag'])
    const detail = await (await server.admin(`/api/admin/sessions/${ids.closedSessionId}`)).json()
    expect(detail.losses).toHaveLength(4)
    expect(detail.absences).toHaveLength(1)
    expect((await server.admin('/api/admin/sessions/nope')).status).toBe(404)

    const history = (await (await server.admin(`/api/admin/history?playerId=${ids.players.anna}&kind=payment`)).json()) as unknown[]
    expect(history).toHaveLength(1)
    expect((await server.admin('/api/admin/history?kind=bogus')).status).toBe(400)

    // a second upload replaces the first atomically
    const again = await upload(token, bytes)
    expect(again.status).toBe(200)
    expect((await server.admin('/api/admin/players')).status).toBe(200)
  })
})
