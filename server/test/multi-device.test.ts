import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

/** Demo DB; with `rename`, Anna is called differently (second ledger). */
function snapshotBytes(rename?: string) {
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file)
  if (rename) {
    const db = new DatabaseSync(file)
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run(rename, ids.players.anna)
    db.close()
  }
  return { bytes: fs.readFileSync(file), ids }
}

async function upload(token: string, bytes: Uint8Array) {
  const response = await server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '6' },
  })
  expect(response.status).toBe(200)
}

async function twoDevices() {
  server = await createTestServer()
  const a = (await server.enroll('Tablet Stammtisch')).body
  const b = (await server.enroll('Handy Mike')).body
  const snapA = snapshotBytes()
  const snapB = snapshotBytes('Zora')
  await upload(a.token, snapA.bytes)
  await upload(b.token, snapB.bytes)
  return { a: { ...a, ids: snapA.ids }, b: { ...b, ids: snapB.ids } }
}

const names = async (query: string, init?: RequestInit) =>
  ((await (await server.admin(`/api/admin/players${query}`, init)).json()) as Array<{ name: string }>).map((p) => p.name).sort()

const queue = (deviceId: string, type: string, payload: unknown) =>
  server.admin(`/api/admin/commands?device=${deviceId}`, { method: 'POST', body: JSON.stringify({ type, payload }) })

describe('several devices', () => {
  it('keeps one snapshot per device and isolates reads', async () => {
    const { a, b } = await twoDevices()
    expect(await names(`?device=${a.deviceId}`)).toEqual(['Anna', 'Ben', 'Cem', 'Dana'])
    expect(await names(`?device=${b.deviceId}`)).toEqual(['Ben', 'Cem', 'Dana', 'Zora'])
    expect(await names('', { headers: { 'X-Schockboard-Device': b.deviceId } })).toContain('Zora')
    // default = first active device
    expect(await names('')).toContain('Anna')
    // interleaved reads stay isolated (cached working copies)
    expect(await names(`?device=${a.deviceId}`)).toContain('Anna')
    const charts = await (await server.admin(`/api/admin/charts/players?device=${b.deviceId}`)).json()
    expect(charts.map((row: { playerName: string }) => row.playerName)).toContain('Zora')
    expect(fs.existsSync(server.snapshots.rawFile(a.deviceId))).toBe(true)
    expect(fs.existsSync(server.snapshots.rawFile(b.deviceId))).toBe(true)

    expect((await server.admin('/api/admin/players?device=dev_unknown')).status).toBe(404)
    expect((await server.admin('/api/admin/status?device=dev_unknown')).status).toBe(404)

    const status = await (await server.admin(`/api/admin/status?device=${b.deviceId}`)).json()
    expect(status).toMatchObject({ deviceId: b.deviceId, label: 'Handy Mike', activeDevices: 2 })
    expect(status.devices).toHaveLength(2)

    const strip = (await (await server.admin('/api/admin/devices/cashbox')).json()) as Array<{ deviceId: string; cashbox: unknown }>
    expect(strip.map((entry) => entry.deviceId)).toEqual([a.deviceId, b.deviceId])
    expect(strip[0].cashbox).toMatchObject({ totalPaymentsCents: 200 })
  })

  it('checks commands against the target device snapshot and delivers them only there', async () => {
    const { a, b } = await twoDevices()
    // Anna's id only exists on A
    expect((await queue(b.deviceId, 'payment.record', { playerId: a.ids.players.anna, amountCents: 100 })).status).toBe(422)
    const forA = await queue(a.deviceId, 'payment.record', { playerId: a.ids.players.anna, amountCents: 100 })
    expect(forA.status).toBe(201)
    const command = await forA.json()
    expect(command.deviceId).toBe(a.deviceId)
    // duplicate-name check is per device
    expect((await queue(a.deviceId, 'player.create', { name: 'Emil', isCore: true })).status).toBe(201)
    expect((await queue(b.deviceId, 'player.create', { name: 'Emil', isCore: true })).status).toBe(201)

    const fetchedB = await (await server.device(b.token, '/api/device/commands')).json()
    expect(fetchedB.commands.map((entry: { type: string }) => entry.type)).toEqual(['player.create'])
    const fetchedA = await (await server.device(a.token, '/api/device/commands')).json()
    expect(fetchedA.commands.map((entry: { id: string }) => entry.id)).toContain(command.id)

    // B cannot report results for A's command
    const results = { results: [{ id: command.id, status: 'applied', appliedAt: '2026-10-24T12:00:00.000Z' }] }
    const wrong = await server.device(b.token, '/api/device/commands/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    })
    expect(await wrong.json()).toMatchObject({ accepted: 0, ignored: [command.id] })
    const right = await server.device(a.token, '/api/device/commands/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    })
    expect(await right.json()).toMatchObject({ accepted: 1 })

    const listA = (await (await server.admin(`/api/admin/commands?device=${a.deviceId}`)).json()) as Array<{ deviceId: string }>
    expect(listA).toHaveLength(2)
    expect(listA.every((entry) => entry.deviceId === a.deviceId)).toBe(true)
    expect(await (await server.admin('/api/admin/commands?device=all')).json()).toHaveLength(3)

    const devices = (await (await server.admin('/api/admin/devices')).json()) as Array<{ id: string; pendingCommands: number }>
    expect(Object.fromEntries(devices.map((device) => [device.id, device.pendingCommands]))).toEqual({ [a.deviceId]: 1, [b.deviceId]: 1 })
  })

  it('clears the command history per device or for all', async () => {
    const { a, b } = await twoDevices()
    for (const id of [a.deviceId, b.deviceId]) {
      const created = await (await queue(id, 'player.create', { name: 'Emil', isCore: true })).json()
      await server.admin(`/api/admin/commands/${created.id}`, { method: 'DELETE' })
    }
    expect(await (await server.admin(`/api/admin/commands?device=${a.deviceId}`, { method: 'DELETE' })).json()).toMatchObject({ deleted: 1 })
    expect(await (await server.admin(`/api/admin/commands?device=${b.deviceId}`)).json()).toHaveLength(1)
    expect(await (await server.admin('/api/admin/commands?device=all', { method: 'DELETE' })).json()).toMatchObject({ deleted: 1 })
  })

  it('revoking a device cancels only its queue; replacedBy hands over the name', async () => {
    const { a, b } = await twoDevices()
    const ca = await (await queue(a.deviceId, 'player.create', { name: 'Emil', isCore: true })).json()
    const cb = await (await queue(b.deviceId, 'player.create', { name: 'Emil', isCore: true })).json()

    const response = await server.admin(`/api/admin/devices/${a.deviceId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ replacedBy: b.deviceId }),
    })
    expect(await response.json()).toMatchObject({ ok: true, revoked: true, cancelled: 1 })
    expect(server.store.getCommand(ca.id)).toMatchObject({ status: 'cancelled', error: 'Gerät ersetzt' })
    expect(server.store.getCommand(cb.id)).toMatchObject({ status: 'pending' })
    expect((await server.device(a.token, '/api/device/ping')).status).toBe(401)
    expect(server.store.getDevice(b.deviceId)?.label).toBe('Tablet Stammtisch')

    // blocked device: reads 404, then it can be removed with its snapshot
    expect((await server.admin(`/api/admin/players?device=${a.deviceId}`)).status).toBe(404)
    expect((await server.admin(`/api/admin/devices/${b.deviceId}`, { method: 'DELETE' })).status).toBe(409)
    expect((await server.admin(`/api/admin/devices/${a.deviceId}`, { method: 'DELETE' })).status).toBe(200)
    expect(fs.existsSync(server.snapshots.rawFile(a.deviceId))).toBe(false)
    expect(server.store.getCommand(ca.id)).toBeNull()
    expect(await names('')).toContain('Zora')
  })

  it('renames a device', async () => {
    const { b } = await twoDevices()
    const renamed = await server.admin(`/api/admin/devices/${b.deviceId}`, { method: 'PATCH', body: JSON.stringify({ label: 'Mikes Handy' }) })
    expect(await renamed.json()).toMatchObject({ label: 'Mikes Handy', deviceName: 'Handy Mike' })
    expect((await server.admin(`/api/admin/devices/${b.deviceId}`, { method: 'PATCH', body: JSON.stringify({ label: ' ' }) })).status).toBe(400)
  })
})
