import { afterEach, describe, expect, it } from 'vitest'

import { createTestServer } from './helpers'

type TestServer = Awaited<ReturnType<typeof createTestServer>>
let server: TestServer | null = null

afterEach(() => {
  server?.cleanup()
  server = null
})

function enroll(target: TestServer, deviceName = 'Pixel Tablet') {
  return target.app.request('/api/device/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName }),
  })
}

describe('automatic device enrollment', () => {
  it('lets exactly the first device enroll itself, then closes', async () => {
    server = await createTestServer()
    const first = await enroll(server)
    expect(first.status).toBe(200)
    const { token } = (await first.json()) as { token: string }
    expect((await server.device(token, '/api/device/ping')).status).toBe(200)

    expect((await enroll(server, 'Fremdgerät')).status).toBe(403)
    const status = (await (await server.admin('/api/admin/status')).json()) as { deviceLabel: string; enrollmentOpenUntil: string | null }
    expect(status).toMatchObject({ deviceLabel: 'app: Pixel Tablet', enrollmentOpenUntil: null })
  })

  it('accepts a replacement device only inside the admin window and revokes the old one', async () => {
    server = await createTestServer()
    const { token: oldToken } = (await (await enroll(server)).json()) as { token: string }
    await server.admin('/api/admin/device/revoke', { method: 'POST' })
    expect((await server.device(oldToken, '/api/device/ping')).status).toBe(401)
    expect((await enroll(server, 'Neues Tablet')).status).toBe(403) // revoke alone does not reopen

    await server.admin('/api/admin/device/enrollment', { method: 'POST' })
    const replacement = await enroll(server, 'Neues Tablet')
    expect(replacement.status).toBe(200)
    expect((await enroll(server, 'Noch eins')).status).toBe(403)
  })
})

describe('device switch', () => {
  it('cancels commands queued for the previous device', async () => {
    const target = await createTestServer()
    try {
      const enrollOnce = (name: string) =>
        target.app.request('/api/device/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: name }) })
      await enrollOnce('Altes Tablet')
      target.store.db
        .prepare("INSERT INTO commands (id, type, payload_json, status, created_at, created_by) VALUES ('c1', 'audit.purge', '{}', 'pending', 'x', 'admin')")
        .run()
      await target.admin('/api/admin/device/enrollment', { method: 'POST' })
      await enrollOnce('Neues Tablet')

      const row = target.store.db.prepare("SELECT status, error FROM commands WHERE id = 'c1'").get() as { status: string; error: string }
      expect(row).toEqual({ status: 'cancelled', error: 'Gerät gewechselt' })
    } finally {
      target.cleanup()
    }
  })
})
