import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Runs the real app sync engine against the built admin server
 * (server/dist/server.js). Skipped when the server has not been built.
 */
const serverEntry = resolve(__dirname, '../server/dist/server.js')
const secure = new Map<string, string>()

vi.mock('expo-crypto', async () => (await import('./support/memory-sqlite')).cryptoMock)
vi.mock('@/db/client', async () => (await import('./support/memory-sqlite')).clientMock)
vi.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof fetch>) => fetch(...args) }))
vi.mock('expo-constants', () => ({ default: { deviceName: 'Test-Tablet' } }))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secure.set(key, value),
  deleteItemAsync: async (key: string) => void secure.delete(key),
}))

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { createPlayer, getDebtSummaries } from '@/db/queries'
import { RemoteConfigStore } from '@/remote/config'
import { SyncEngine } from '@/remote/sync-engine'
import { AuthService } from '@/services/auth-service'
import { createMemoryDatabase, memory } from './support/memory-sqlite'

const port = 18000 + Math.floor(Math.random() * 1000)
const origin = `http://127.0.0.1:${port}`
process.env.EXPO_PUBLIC_SCHOCKBOARD_SERVER = origin
let server: ChildProcess
let dataDir: string

async function admin(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}/api/admin${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  return { status: response.status, body: await response.json() }
}

describe.skipIf(!existsSync(serverEntry))('app ↔ admin server sync', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-e2e-'))
    server = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, DEV_NO_AUTH: '1', PUBLIC_ORIGIN: origin },
      stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await fetch(`${origin}/healthz`).then((r) => r.ok, () => false)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    memory.current = createMemoryDatabase()
    resetBootstrapFlag()
    ensureDatabaseReady()
  })

  afterAll(() => {
    server?.kill()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('uploads local state and applies a correction queued in the web', async () => {
    const account = (await AuthService.ensureLocalAccount())!
    const playerId = createPlayer({ actor: { accountId: account.id, username: account.username }, name: 'Anna', isCore: true })

    // 1st round: the app enrolls itself (no pairing), then uploads its state
    expect(await RemoteConfigStore.get()).toBeNull()
    const first = await SyncEngine.syncNow()
    expect((await RemoteConfigStore.get())?.token).toBeTruthy()
    const { body: status } = await admin('/status')
    expect(status).toMatchObject({ paired: true, deviceLabel: 'app: Next · Test-Tablet' })
    expect(first).toMatchObject({ status: 'ok', applied: 0, uploaded: true })
    const { body: players } = await admin('/players')
    expect(JSON.stringify(players)).toContain('Anna')

    // web queues a correction → device applies it on the next round
    const queued = await admin('/commands', {
      method: 'POST',
      body: JSON.stringify({ type: 'correction.record', payload: { playerId, amountCents: 300, reason: 'Nachtrag' } }),
    })
    expect(queued.status).toBeLessThan(300)

    const second = await SyncEngine.syncNow()
    expect(second).toMatchObject({ status: 'ok', applied: 1, uploaded: true })
    expect(getDebtSummaries().find((row) => row.playerId === playerId)!.openDebtCents).toBe(300)

    const { body: commands } = await admin('/commands')
    expect(JSON.stringify(commands)).toContain('"applied"')

    // 3rd round: nothing new → no re-upload
    expect(await SyncEngine.syncNow()).toMatchObject({ status: 'ok', applied: 0, uploaded: false })
  })

  it('forgets a revoked token and re-enrolls automatically as a new device', async () => {
    const { body: before } = await admin('/devices')
    const firstId = (before.devices ?? before)[0].id
    await admin(`/devices/${firstId}/revoke`, { method: 'POST' })
    expect(await SyncEngine.syncNow()).toMatchObject({ status: 'error' })
    expect(await RemoteConfigStore.get()).toBeNull()

    await RemoteConfigStore.setLastEnrollAttempt(0)
    expect(await SyncEngine.syncNow()).toMatchObject({ status: 'ok', uploaded: true })
    const { body: after } = await admin('/devices')
    const active = (after.devices ?? after).filter((device: { status: string }) => device.status === 'active')
    expect(active).toHaveLength(1)
    expect(active[0].id).not.toBe(firstId)
  })
})
