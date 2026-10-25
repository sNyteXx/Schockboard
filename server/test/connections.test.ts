import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestServer, tempFile } from './helpers'
import { buildDemoSnapshot } from '../scripts/demo-data'

let server: Awaited<ReturnType<typeof createTestServer>>
afterEach(() => server?.cleanup())
const post = (body?: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
async function setup() {
  server = await createTestServer()
  const host = (await server.enroll('Spieltisch')).body, guest = (await server.enroll('Handy')).body
  const file = tempFile('connection.sqlite')
  buildDemoSnapshot(file)
  const bytes = fs.readFileSync(file)
  expect((await server.device(host.token, '/api/device/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '10' }, body: bytes })).status).toBe(200)
  return { host, guest, bytes }
}
async function invite(token: string, purpose = 'join') {
  const response = await server.device(token, '/api/device/connect/invite', post({ purpose }))
  expect(response.status).toBe(200)
  const invitation = await response.json()
  return { ...invitation, code: new URL(invitation.url).searchParams.get('code') }
}

describe('paired rounds', () => {
  it('uses expiring single-use QR invitations, isolates roles and supports revocation', async () => {
    const { host, guest } = await setup()
    const invitation = await invite(host.token)
    expect(invitation.svg).toContain('<svg')
    expect((await server.device(guest.token, '/api/device/connect/claim', post({ code: invitation.code }))).status).toBe(200)
    const other = (await server.enroll('Anderes Handy')).body
    expect((await server.device(other.token, '/api/device/connect/claim', post({ code: invitation.code }))).status).toBe(403)
    const view = await (await server.device(guest.token, '/api/device/connect/round')).json()
    expect(view.role).toBe('viewer')
    expect(view.balances).toEqual([])
    expect(Object.keys(view.session)).toEqual(['session', 'attendance', 'losses'])
    expect(view.session.losses.every((row: Record<string, unknown>) => Object.keys(row).every(key => ['playerId', 'isBeerRound'].includes(key)))).toBe(true)
    expect((await server.device(guest.token, '/api/device/connect/round/commands', post({}))).status).toBe(400)
    expect((await server.device(guest.token, `/api/device/connect/members/${guest.deviceId}`, { ...post({ role: 'operator' }), method: 'PATCH' })).status).toBe(404)
    expect((await server.device(host.token, `/api/device/connect/members/${guest.deviceId}`, { ...post({ role: 'operator' }), method: 'PATCH' })).status).toBe(200)
    expect((await (await server.device(guest.token, '/api/device/connect/round')).json()).role).toBe('operator')
    await server.device(host.token, `/api/device/connect/members/${guest.deviceId}`, { method: 'DELETE' })
    expect((await server.device(guest.token, '/api/device/connect/round')).status).toBe(403)
    const expired = await invite(host.token)
    server.store.db.prepare("UPDATE round_invites SET expires_at = '2000-01-01' WHERE id = ?").run(expired.id)
    expect((await server.device(guest.token, '/api/device/connect/claim', post({ code: expired.code }))).status).toBe(403)
  })
  it('keeps booking retries idempotent and denies stale-session and unauthorized bookings', async () => {
    const { host, guest } = await setup()
    const invitation = await invite(host.token)
    await server.device(guest.token, '/api/device/connect/claim', post({ code: invitation.code }))
    await server.device(host.token, `/api/device/connect/members/${guest.deviceId}`, { ...post({ role: 'operator' }), method: 'PATCH' })
    const players = await (await server.admin(`/api/admin/players?device=${host.deviceId}`)).json()
    const playerId = players[0].id
    const body = { requestId: 'cefe034a-3535-4e2a-8dd9-b77db217726d', type: 'payment.record', payload: { playerId, amountCents: 100 } }
    const first = await server.device(guest.token, '/api/device/connect/round/commands', post(body))
    expect(first.status).toBe(200)
    const firstId = (await first.json()).id
    expect((await (await server.device(guest.token, '/api/device/connect/round/commands', post(body))).json()).id).toBe(firstId)
    expect(server.store.countPendingCommands(host.deviceId)).toBe(1)
    expect((await server.device(guest.token, '/api/device/connect/round/commands', post({ ...body, payload: { ...body.payload, amountCents: 200 } }))).status).toBe(409)
    expect((await server.device(guest.token, '/api/device/connect/round/commands', post({ requestId: 'aefe034a-3535-4e2a-8dd9-b77db217726d', type: 'loss.record', payload: { playerId, sessionId: 'missing' } }))).status).toBe(400)
    await server.device(host.token, `/api/device/connect/members/${guest.deviceId}`, { ...post({ role: 'viewer' }), method: 'PATCH' })
    expect(server.store.getCommand(firstId)?.status).toBe('cancelled')
    expect(await (await server.device(guest.token, '/api/device/connect/round/commands', post(body))).json()).toMatchObject({ id: firstId, status: 'cancelled' })
    expect((await server.device(guest.token, '/api/device/connect/round/commands', post({ ...body, requestId: 'd2fe034a-3535-4e2a-8dd9-b77db217726d' }))).status).toBe(403)
  })
})

describe('device transfer', () => {
  it('freezes the source until a verified copy is installed, protects access and makes completion repeatable', async () => {
    const { host, guest, bytes } = await setup()
    expect((await server.admin(`/api/admin/connect/invite?device=${host.deviceId}`, post({ purpose: 'transfer' }))).status).toBe(409)
    const targetFile = tempFile('target-before-transfer.sqlite')
    buildDemoSnapshot(targetFile)
    await server.device(guest.token, '/api/device/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '10' }, body: fs.readFileSync(targetFile) })
    const prepared = await server.device(host.token, '/api/device/connect/prepare-transfer', post())
    expect(prepared.status).toBe(200)
    const code = new URL((await prepared.json()).url).searchParams.get('code')
    const claimed = await (await server.device(guest.token, '/api/device/connect/claim', post({ code }))).json()
    const id = claimed.state.transfer.id
    expect(await (await server.admin(`/api/admin/commands?device=${guest.deviceId}`, post({ type: 'player.create', payload: { name: 'Während Umzug', isCore: false } }))).json()).toMatchObject({ error: 'transfer_locked' })
    expect((await server.device(host.token, '/api/device/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '10' }, body: bytes })).status).toBe(409)
    expect((await server.device(host.token, `/api/device/connect/transfers/${id}/snapshot`)).status).toBe(403)
    expect((await server.device(host.token, `/api/device/connect/transfers/${id}/cancel`, post())).status).toBe(403)
    expect((await server.device(guest.token, `/api/device/connect/transfers/${id}/complete`, post())).status).toBe(409)
    const download = await server.device(guest.token, `/api/device/connect/transfers/${id}/snapshot`)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
    await server.device(guest.token, '/api/device/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '10' }, body: bytes })
    expect((await server.device(guest.token, `/api/device/connect/transfers/${id}/complete`, post())).status).toBe(200)
    expect((await server.device(guest.token, `/api/device/connect/transfers/${id}/complete`, post())).status).toBe(200)
    expect((await (await server.device(host.token, '/api/device/connect')).json()).host).toMatchObject({ deviceId: guest.deviceId, role: 'viewer' })
  })
})

it('rejects an unused invitation if its host has since joined another round', async () => {
  const { host, guest, bytes } = await setup()
  const stale = await invite(host.token)
  const other = (await server.enroll('Neuer Tisch')).body
  await server.device(other.token, '/api/device/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '10' }, body: bytes })
  const join = await invite(other.token)
  expect((await server.device(host.token, '/api/device/connect/claim', post({ code: join.code }))).status).toBe(200)
  expect((await server.device(guest.token, '/api/device/connect/claim', post({ code: stale.code }))).status).toBe(403)
})

it('serves trophies, explicit balance exports and versioned backups behind admin authentication', async () => {
  const { host } = await setup()
  expect((await server.app.request('/api/admin/achievements')).status).toBe(401)
  const awards = await (await server.admin(`/api/admin/achievements?device=${host.deviceId}`)).json()
  expect(awards.length).toBeGreaterThan(0)
  const recap = await (await server.admin(`/api/admin/recap?device=${host.deviceId}&year=2026`)).json()
  expect(recap.players.every((row: Record<string, unknown>) => !('debtCents' in row))).toBe(true)
  const backups = await (await server.admin(`/api/admin/backups?device=${host.deviceId}`)).json()
  expect(backups.length).toBe(1)
  expect((await server.admin(`/api/admin/backup/${backups[0].name}?device=${host.deviceId}`)).status).toBe(200)
  expect((await server.admin(`/api/admin/backup/invalid?device=${host.deviceId}`)).status).toBe(404)
})

it('keeps web booking retries idempotent after the command history is cleared', async () => {
  const { host } = await setup()
  const players = await (await server.admin(`/api/admin/players?device=${host.deviceId}`)).json()
  const body = { requestId: 'd2fe034a-3535-4e2a-8dd9-b77db217726d', type: 'payment.record', payload: { playerId: players[0].id, amountCents: 100 } }
  const first = await (await server.admin(`/api/admin/commands?device=${host.deviceId}`, post(body))).json()
  expect(first.id).toBeTruthy()
  expect((await (await server.admin(`/api/admin/commands?device=${host.deviceId}`, post(body))).json()).id).toBe(first.id)
  server.store.db.prepare('DELETE FROM commands WHERE id = ?').run(first.id)
  expect((await (await server.admin(`/api/admin/commands?device=${host.deviceId}`, post(body))).json()).id).toBe(first.id)
  expect(server.store.countPendingCommands(host.deviceId)).toBe(0)
  expect((await server.admin(`/api/admin/commands?device=${host.deviceId}`, post({ ...body, payload: { ...body.payload, amountCents: 200 } }))).status).toBe(409)
})
