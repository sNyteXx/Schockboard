import { afterEach, describe, expect, it } from 'vitest'

import { createTestServer } from './helpers'

type TestServer = Awaited<ReturnType<typeof createTestServer>>
let server: TestServer | null = null

afterEach(() => {
  server?.cleanup()
  server = null
})

describe('automatic device enrollment', () => {
  it('lets every app enroll itself as a new device, labelled with its device name', async () => {
    server = await createTestServer()
    const first = await server.enroll('Pixel Tablet')
    expect(first.status).toBe(200)
    expect((await server.device(first.body.token, '/api/device/ping')).status).toBe(200)

    const second = await server.enroll('Handy Mike')
    expect(second.status).toBe(200)
    expect(second.body.deviceId).not.toBe(first.body.deviceId)
    // the first device stays valid
    expect((await server.device(first.body.token, '/api/device/ping')).status).toBe(200)

    const devices = (await (await server.admin('/api/admin/devices')).json()) as Array<{ id: string; label: string; status: string }>
    expect(devices.map((device) => [device.label, device.status])).toEqual([
      ['Pixel Tablet', 'active'],
      ['Handy Mike', 'active'],
    ])
    const status = await (await server.admin('/api/admin/status')).json()
    expect(status).toMatchObject({ deviceLabel: 'app: Pixel Tablet', label: 'Pixel Tablet', activeDevices: 2 })
  })

  it('refuses enrollment beyond MAX_DEVICES active devices; blocked ones do not count', async () => {
    server = await createTestServer({ maxDevices: 2 })
    const a = await server.enroll('A')
    await server.enroll('B')
    const refused = await server.enroll('C')
    expect(refused.status).toBe(403)
    expect(refused.body.error).toBe('device_limit')

    await server.admin(`/api/admin/devices/${a.body.deviceId}/revoke`, { method: 'POST' })
    expect((await server.enroll('C')).status).toBe(200)
  })

  it('rate-limits enrollment per client IP (CF-Connecting-IP)', async () => {
    server = await createTestServer({ enrollLimitPerMinute: 2, enrollLimitPerDay: 3 })
    const ip = { 'CF-Connecting-IP': '203.0.113.7' }
    expect((await server.enroll('1', ip)).status).toBe(200)
    expect((await server.enroll('2', ip)).status).toBe(200)
    expect((await server.enroll('3', ip)).status).toBe(429)
    // another client is not affected
    expect((await server.enroll('4', { 'CF-Connecting-IP': '203.0.113.8' })).status).toBe(200)
  })

  it('a blocked app loses its token and may re-enroll as a new device', async () => {
    server = await createTestServer()
    const old = await server.enroll('Tablet')
    await server.admin('/api/admin/device/revoke', { method: 'POST' })
    expect((await server.device(old.body.token, '/api/device/ping')).status).toBe(401)

    const again = await server.enroll('Tablet')
    expect(again.status).toBe(200)
    expect(again.body.deviceId).not.toBe(old.body.deviceId)
    const devices = (await (await server.admin('/api/admin/devices')).json()) as Array<{ id: string; status: string }>
    expect(devices.map((device) => [device.id, device.status])).toEqual([
      [again.body.deviceId, 'active'],
      [old.body.deviceId, 'blocked'],
    ])
  })

  it('admin enrollment window endpoints are gone', async () => {
    server = await createTestServer()
    expect((await server.admin('/api/admin/device/enrollment', { method: 'POST' })).status).toBe(404)
  })
})
