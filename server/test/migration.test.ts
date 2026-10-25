import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDemoSnapshot } from '../scripts/demo-data'
import { hashToken } from '../src/store'
import { createTestServer } from './helpers'

/** server.db exactly as the single-device server (≤ b87e3d2) created it. */
const LEGACY_SCHEMA = `
  CREATE TABLE devices (id TEXT PRIMARY KEY, token_hash BLOB NOT NULL, paired_at TEXT NOT NULL, paired_by TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE commands (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT,
    created_at TEXT NOT NULL, created_by TEXT NOT NULL, applied_at TEXT, result_received_at TEXT, fetched_at TEXT, cancelled_at TEXT);
  CREATE INDEX commands_status_created ON commands (status, created_at);
  CREATE TABLE snapshot_meta (id INTEGER PRIMARY KEY CHECK (id = 1), received_at TEXT NOT NULL, created_at TEXT, schema_version INTEGER,
    size_bytes INTEGER NOT NULL, device_id TEXT);
`

const TOKEN = 'legacy-token-abcdefghijklmnopqrstuvwxyz0123'
const dirs: string[] = []
let servers: Array<Awaited<ReturnType<typeof createTestServer>>> = []

afterEach(() => {
  for (const server of servers) {
    server.snapshots.close()
    server.store.close()
  }
  servers = []
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function legacyDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-legacy-'))
  dirs.push(dir)
  const db = new DatabaseSync(path.join(dir, 'server.db'))
  db.exec(LEGACY_SCHEMA)
  db.prepare("INSERT INTO devices VALUES ('dev_old', ?, '2026-01-01T00:00:00.000Z', 'app: Altes Tablet', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')").run(
    hashToken('old-token-abcdefghijklmnopqrstuvwxyz0123')
  )
  db.prepare("INSERT INTO devices VALUES ('dev_sm', ?, '2026-03-01T00:00:00.000Z', 'app: SM-X910', '2026-10-24T09:00:00.000Z', NULL)").run(hashToken(TOKEN))
  db.exec(`
    INSERT INTO commands (id, type, payload_json, status, created_at, created_by, applied_at, result_received_at)
      VALUES ('cmd_done', 'player.create', '{"name":"Emil","isCore":true}', 'applied', '2026-10-01T00:00:00.000Z', 'a@b', '2026-10-01T01:00:00.000Z', '2026-10-01T01:00:00.000Z');
    INSERT INTO commands (id, type, payload_json, status, created_at, created_by)
      VALUES ('cmd_open', 'audit.purge', '{}', 'pending', '2026-10-24T00:00:00.000Z', 'a@b');
    INSERT INTO snapshot_meta VALUES (1, '2026-10-24T09:00:00.000Z', '2026-10-24T08:59:00.000Z', 6, 4096, 'dev_sm');
    INSERT INTO kv VALUES ('enrollment_open_until', '2020-01-01T00:00:00.000Z');
  `)
  db.close()
  const ids = buildDemoSnapshot(path.join(dir, 'snapshot.sqlite'))
  fs.copyFileSync(path.join(dir, 'snapshot.sqlite'), path.join(dir, 'snapshot-work.sqlite'))
  return { dir, ids, original: fs.readFileSync(path.join(dir, 'snapshot.sqlite')) }
}

describe('migration from the single-device layout', () => {
  it('keeps device, token, commands and snapshot (assigned to the active device)', async () => {
    const { dir, ids, original } = legacyDataDir()
    const server = await createTestServer({}, { dataDir: dir })
    servers.push(server)

    expect(server.logs.join('\n')).toMatch(/2 Aufträge → dev_sm, Snapshot → dev_sm/)
    expect(fs.existsSync(path.join(dir, 'server.db.pre-multidevice.bak'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'snapshot.sqlite'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'snapshot-work.sqlite'))).toBe(false)
    expect(fs.readFileSync(server.snapshots.rawFile('dev_sm')).equals(original)).toBe(true)

    // the real device keeps working with its existing token
    expect((await server.device(TOKEN, '/api/device/ping')).status).toBe(200)
    const fetched = await (await server.device(TOKEN, '/api/device/commands')).json()
    expect(fetched.commands.map((command: { id: string }) => command.id)).toEqual(['cmd_open'])

    const devices = (await (await server.admin('/api/admin/devices')).json()) as Array<Record<string, unknown>>
    expect(devices).toEqual([
      expect.objectContaining({ id: 'dev_sm', label: 'SM-X910', deviceName: 'SM-X910', status: 'active', pendingCommands: 1, lastSnapshotAt: '2026-10-24T09:00:00.000Z' }),
      expect.objectContaining({ id: 'dev_old', label: 'Altes Tablet', status: 'blocked', pendingCommands: 0 }),
    ])
    const status = await (await server.admin('/api/admin/status')).json()
    expect(status).toMatchObject({ deviceId: 'dev_sm', deviceLabel: 'app: SM-X910', schemaVersion: 6, snapshotFromPreviousDevice: false })
    const players = (await (await server.admin('/api/admin/players')).json()) as Array<{ id: string }>
    expect(players.map((player) => player.id)).toContain(ids.players.anna)
    const commands = (await (await server.admin('/api/admin/commands')).json()) as Array<{ id: string; deviceId: string }>
    expect(commands.map((command) => [command.id, command.deviceId])).toEqual([
      ['cmd_open', 'dev_sm'],
      ['cmd_done', 'dev_sm'],
    ])
  })

  it('is idempotent across restarts', async () => {
    const { dir } = legacyDataDir()
    const first = await createTestServer({}, { dataDir: dir })
    first.snapshots.close()
    first.store.close()
    const second = await createTestServer({}, { dataDir: dir })
    servers.push(second)
    expect(second.logs.join('\n')).not.toMatch(/umgestellt|verschoben/)
    expect((await second.admin('/api/admin/players')).status).toBe(200)
    expect(second.store.listCommands(null)).toHaveLength(2)
    const version = second.store.db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(2)
  })
})
