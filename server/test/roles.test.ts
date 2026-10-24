import fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { createTestServer, tempFile } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

const MANAGER = 'kassenwart@example.com'

async function setup() {
  server = await createTestServer({ managerEmails: [MANAGER] })
  const managerJwt = await server.keys.sign({ email: MANAGER })
  const manager = (pathname: string, init: RequestInit = {}) =>
    server.app.request(pathname, {
      ...init,
      headers: { 'Cf-Access-Jwt-Assertion': managerJwt, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  return { manager }
}

async function upload() {
  const { token } = await server.pair()
  const file = tempFile('snap.sqlite')
  const ids = buildDemoSnapshot(file)
  const response = await server.device(token, '/api/device/snapshot', {
    method: 'PUT',
    body: fs.readFileSync(file),
    headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': '6' },
  })
  expect(response.status).toBe(200)
  return ids
}

describe('roles', () => {
  it('reports the role in /me', async () => {
    const { manager } = await setup()
    expect(await (await server.admin('/api/admin/me')).json()).toMatchObject({ email: 'snytex@snytex.de', role: 'admin' })
    expect(await (await manager('/api/admin/me')).json()).toMatchObject({ email: MANAGER, role: 'manager' })
  })

  it('admin wins when an address is on both lists', async () => {
    server = await createTestServer({ managerEmails: ['snytex@snytex.de'] })
    expect(await (await server.admin('/api/admin/me')).json()).toMatchObject({ role: 'admin' })
  })

  it('keeps device management admin-only', async () => {
    const { manager } = await setup()
    for (const [method, path] of [
      ['POST', '/api/admin/device/enrollment'],
      ['DELETE', '/api/admin/device/enrollment'],
      ['POST', '/api/admin/device/revoke'],
      ['POST', '/api/admin/device/pair'],
    ] as const) {
      expect((await manager(path, { method })).status).toBe(403)
    }
    expect((await server.admin('/api/admin/device/enrollment', { method: 'POST' })).status).toBe(200)
    expect((await server.admin('/api/admin/device/revoke', { method: 'POST' })).status).toBe(200)
  })

  it('lets managers read everything and queue/cancel data and override commands', async () => {
    const { manager } = await setup()
    const ids = await upload()
    for (const path of ['/api/admin/status', '/api/admin/dashboard', '/api/admin/history?includeAudit=1', '/api/admin/charts/players', '/api/admin/commands']) {
      expect((await manager(path)).status).toBe(200)
    }
    const queued = await manager('/api/admin/commands', {
      method: 'POST',
      body: JSON.stringify({ type: 'session.update', payload: { sessionId: ids.closedSessionId, title: 'Derby' } }),
    })
    expect(queued.status).toBe(201)
    const command = await queued.json()
    expect(command.createdBy).toBe(MANAGER)
    expect((await manager(`/api/admin/commands/${command.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await manager('/api/admin/commands', { method: 'DELETE' })).status).toBe(200)
  })
})
