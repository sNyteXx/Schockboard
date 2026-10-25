import { generateKeyPair } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestServer } from './helpers'

let server: Awaited<ReturnType<typeof createTestServer>>

afterEach(() => server?.cleanup())

describe('admin auth (Cloudflare Access)', () => {
  it('rejects requests without an Access JWT', async () => {
    server = await createTestServer()
    const response = await server.app.request('/api/admin/status')
    expect(response.status).toBe(401)
  })

  it('rejects garbage and wrongly signed tokens', async () => {
    server = await createTestServer()
    const garbage = await server.app.request('/api/admin/status', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } })
    expect(garbage.status).toBe(401)

    const { privateKey } = await generateKeyPair('RS256')
    const forged = await server.keys.sign({}, { key: privateKey })
    const response = await server.app.request('/api/admin/status', { headers: { 'Cf-Access-Jwt-Assertion': forged } })
    expect(response.status).toBe(401)
  })

  it('rejects a wrong issuer and an expired token', async () => {
    server = await createTestServer()
    const wrongIssuer = await server.keys.sign({}, { issuer: 'https://evil.cloudflareaccess.com' })
    expect((await server.app.request('/api/admin/status', { headers: { 'Cf-Access-Jwt-Assertion': wrongIssuer } })).status).toBe(401)
    const expired = await server.keys.sign({}, { expiresIn: Math.floor(Date.now() / 1000) - 3600 })
    expect((await server.app.request('/api/admin/status', { headers: { 'Cf-Access-Jwt-Assertion': expired } })).status).toBe(401)
  })

  it('rejects an email that is not on the allow-list', async () => {
    server = await createTestServer()
    const token = await server.keys.sign({ email: 'someone@example.com' })
    const response = await server.app.request('/api/admin/status', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(response.status).toBe(403)
  })

  it('accepts a valid token for an allowed email (case-insensitive)', async () => {
    server = await createTestServer()
    const token = await server.keys.sign({ email: 'SnyTex@snytex.de' })
    const response = await server.app.request('/api/admin/me', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ email: 'snytex@snytex.de' })
  })

  it('checks the audience only when CF_ACCESS_AUD is configured', async () => {
    server = await createTestServer({ cfAccessAud: 'aud-123' })
    const missing = await server.keys.sign()
    expect((await server.app.request('/api/admin/me', { headers: { 'Cf-Access-Jwt-Assertion': missing } })).status).toBe(401)
    const good = await server.keys.sign({}, { audience: 'aud-123' })
    expect((await server.app.request('/api/admin/me', { headers: { 'Cf-Access-Jwt-Assertion': good } })).status).toBe(200)
  })

  it('also guards the web UI, but not /healthz', async () => {
    server = await createTestServer()
    expect((await server.app.request('/')).status).toBe(401)
    expect((await server.app.request('/spieler')).status).toBe(401)
    expect((await server.app.request('/healthz')).status).toBe(200)
  })

  it('DEV_NO_AUTH bypasses Access', async () => {
    server = await createTestServer({ devNoAuth: true })
    const response = await server.app.request('/api/admin/me')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ email: 'dev@localhost', devNoAuth: true })
  })
})
