import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'

import { createApp } from '../src/app'
import { loadConfig, type ServerConfig } from '../src/config'
import { migrateLegacySnapshot } from '../src/migrate'
import { createSnapshotManager } from '../src/snapshot'
import { openStore } from '../src/store'

export const TEAM_DOMAIN = 'test-team.cloudflareaccess.com'
export const ADMIN_EMAIL = 'snytex@snytex.de'

export async function createAccessKeys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
  const jwks = createLocalJWKSet({ keys: [jwk] })

  async function sign(claims: Record<string, unknown> = {}, options: { issuer?: string; audience?: string; key?: CryptoKey; expiresIn?: string | number } = {}) {
    const jwt = new SignJWT({ email: ADMIN_EMAIL, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(options.issuer ?? `https://${TEAM_DOMAIN}`)
      .setExpirationTime(options.expiresIn ?? '5m')
    if (options.audience) jwt.setAudience(options.audience)
    return jwt.sign(options.key ?? privateKey)
  }

  return { jwks, sign }
}

export async function createTestServer(overrides: Partial<ServerConfig> = {}, options: { dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'))
  const config: ServerConfig = {
    ...loadConfig({ DATA_DIR: dataDir, CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN }),
    publicDir: null,
    ...overrides,
  }
  const logs: string[] = []
  const store = openStore(path.join(dataDir, 'server.db'), undefined, { log: (message) => logs.push(message) })
  const snapshots = createSnapshotManager(dataDir)
  migrateLegacySnapshot(store, snapshots, (message) => logs.push(message))
  const keys = await createAccessKeys()
  const app = createApp({ config, store, snapshots, jwks: keys.jwks, log: (message) => logs.push(message) })
  const adminJwt = await keys.sign()

  const admin = (pathname: string, init: RequestInit = {}) =>
    app.request(pathname, {
      ...init,
      headers: { 'Cf-Access-Jwt-Assertion': adminJwt, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })

  const device = (token: string, pathname: string, init: RequestInit = {}) =>
    app.request(pathname, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

  /** Self-enrollment as the app does it. */
  async function enroll(deviceName: string, headers: Record<string, string> = {}) {
    const response = await app.request('/api/device/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ deviceName }),
    })
    return { status: response.status, body: (await response.json()) as { token: string; deviceId: string; error?: string } }
  }

  async function pair() {
    const response = await admin('/api/admin/device/pair', { method: 'POST' })
    return (await response.json()) as { token: string; deviceId: string }
  }

  function cleanup() {
    snapshots.close()
    store.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }

  return { app, config, store, snapshots, keys, admin, device, pair, enroll, cleanup, dataDir, logs }
}

const fixtureDirs: string[] = []
// Registered on the importing test file's root suite.
afterAll(() => {
  for (const dir of fixtureDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Temp file in its own directory; removed after the test file. */
export function tempFile(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fixture-'))
  fixtureDirs.push(dir)
  return path.join(dir, name)
}
