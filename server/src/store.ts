import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { CommandResult, CommandType, RemoteCommand } from '@/remote/protocol'

/**
 * Server-side state in `server.db`: the paired device (token hash only),
 * the command queue and metadata of the latest snapshot. Never holds any
 * Schockboard business data — that only lives in the uploaded snapshot.
 */

export type CommandStatus = 'pending' | 'applied' | 'rejected' | 'cancelled'

export type StoredCommand = RemoteCommand & {
  deviceId: string
  status: CommandStatus
  error: string | null
  appliedAt: string | null
  resultReceivedAt: string | null
  fetchedAt: string | null
  cancelledAt: string | null
}

export type DeviceRow = {
  id: string
  pairedAt: string
  lastSeenAt: string | null
  /** 'app: <device name>' for self-enrolled devices, else the admin email. */
  pairedBy?: string
  /** Editable display name (defaults to the enrolled device name). */
  label?: string
  deviceName?: string
  revokedAt?: string | null
}

export type DeviceStatus = 'active' | 'blocked'

export type DeviceSummary = {
  id: string
  label: string
  deviceName: string
  pairedBy: string
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  status: DeviceStatus
  lastSnapshotAt: string | null
  pendingCommands: number
}

export type SnapshotMeta = {
  receivedAt: string
  createdAt: string | null
  schemaVersion: number | null
  sizeBytes: number
  /** Device that uploaded the image (differs only for a migrated single-device snapshot). */
  deviceId: string | null
}

type RawCommand = {
  id: string
  device_id: string
  type: CommandType
  payload_json: string
  status: CommandStatus
  error: string | null
  created_at: string
  created_by: string
  applied_at: string | null
  result_received_at: string | null
  fetched_at: string | null
  cancelled_at: string | null
}

type RawDevice = {
  id: string
  label: string | null
  device_name: string | null
  paired_at: string
  paired_by: string
  last_seen_at: string | null
  revoked_at: string | null
}

/** server.db layout version (PRAGMA user_version). 0/1 = single device, 2 = several devices. */
export const STORE_SCHEMA_VERSION = 2

const SCHEMA_V2 = `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    token_hash BLOB NOT NULL,
    paired_at TEXT NOT NULL,
    paired_by TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    label TEXT,
    device_name TEXT
  );
  CREATE INDEX IF NOT EXISTS devices_token_hash ON devices (token_hash);
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    applied_at TEXT,
    result_received_at TEXT,
    fetched_at TEXT,
    cancelled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS commands_status_created ON commands (status, created_at);
  CREATE INDEX IF NOT EXISTS commands_device_status ON commands (device_id, status, created_at);
  CREATE TABLE IF NOT EXISTS snapshot_meta (
    device_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    created_at TEXT,
    schema_version INTEGER,
    size_bytes INTEGER NOT NULL,
    uploaded_by TEXT
  );
`

/** kv key: device that inherits the single-device snapshot.sqlite (file move pending). */
export const LEGACY_SNAPSHOT_KEY = 'legacy_snapshot_device_id'

function columnsOf(db: DatabaseSync, table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
}

function stripAppPrefix(pairedBy: string) {
  return pairedBy.startsWith('app: ') ? pairedBy.slice(5) : pairedBy
}

/**
 * Upgrades a single-device server.db (devices without label, commands
 * without device_id, one snapshot_meta row) in one transaction. Existing
 * commands and the snapshot belong to the current active device afterwards.
 * Returns a short description for the startup log, or null if nothing to do.
 */
function migrateStore(db: DatabaseSync, file: string): string | null {
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  const hasDevices = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'devices'").get()
  if (version >= STORE_SCHEMA_VERSION || !hasDevices) {
    db.exec(SCHEMA_V2)
    db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`)
    return null
  }

  // Safety copy of the old layout, once (tiny: no business data in server.db).
  const backup = `${file}.pre-multidevice.bak`
  if (file !== ':memory:' && !fs.existsSync(backup)) {
    db.prepare('VACUUM INTO ?').run(backup)
  }

  const notes: string[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const deviceColumns = columnsOf(db, 'devices')
    if (!deviceColumns.has('label')) db.exec('ALTER TABLE devices ADD COLUMN label TEXT')
    if (!deviceColumns.has('device_name')) db.exec('ALTER TABLE devices ADD COLUMN device_name TEXT')
    for (const row of db.prepare('SELECT id, paired_by FROM devices WHERE label IS NULL OR device_name IS NULL').all() as Array<{
      id: string
      paired_by: string
    }>) {
      const name = stripAppPrefix(row.paired_by)
      db.prepare('UPDATE devices SET device_name = COALESCE(device_name, ?), label = COALESCE(label, ?) WHERE id = ?').run(name, name, row.id)
    }

    const active = db.prepare('SELECT id FROM devices WHERE revoked_at IS NULL ORDER BY paired_at DESC LIMIT 1').get() as
      | { id: string }
      | undefined
    const latest = db.prepare('SELECT id FROM devices ORDER BY paired_at DESC LIMIT 1').get() as { id: string } | undefined

    const hasCommands = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'commands'").get()
    if (hasCommands && !columnsOf(db, 'commands').has('device_id')) {
      const owner = active?.id ?? latest?.id ?? 'dev_legacy'
      db.exec(`
        CREATE TABLE commands_v2 (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          applied_at TEXT,
          result_received_at TEXT,
          fetched_at TEXT,
          cancelled_at TEXT
        );
      `)
      const moved = db
        .prepare(
          `INSERT INTO commands_v2 (id, device_id, type, payload_json, status, error, created_at, created_by, applied_at,
             result_received_at, fetched_at, cancelled_at)
           SELECT id, ?, type, payload_json, status, error, created_at, created_by, applied_at, result_received_at, fetched_at, cancelled_at
           FROM commands ORDER BY rowid`
        )
        .run(owner).changes
      db.exec('DROP TABLE commands; ALTER TABLE commands_v2 RENAME TO commands;')
      notes.push(`${moved} Aufträge → ${owner}`)
    }

    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'snapshot_meta'").get()
    if (hasMeta && columnsOf(db, 'snapshot_meta').has('id')) {
      const old = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1').get() as
        | { received_at: string; created_at: string | null; schema_version: number | null; size_bytes: number; device_id: string | null }
        | undefined
      db.exec('DROP TABLE snapshot_meta')
      db.exec(SCHEMA_V2)
      const known = old?.device_id ? db.prepare('SELECT id FROM devices WHERE id = ?').get(old.device_id) : undefined
      const owner = active?.id ?? (known ? old!.device_id : null) ?? latest?.id ?? null
      if (old && owner) {
        db.prepare(
          'INSERT INTO snapshot_meta (device_id, received_at, created_at, schema_version, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(owner, old.received_at, old.created_at, old.schema_version, old.size_bytes, old.device_id)
        notes.push(`Snapshot → ${owner}`)
      }
      // snapshot.sqlite is moved by the snapshot manager right after startup.
      if (owner) db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(LEGACY_SNAPSHOT_KEY, owner)
    }

    db.exec(SCHEMA_V2)
    db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return `server.db auf mehrere Geräte umgestellt (${notes.join(', ') || 'keine Daten'}); Sicherung: ${path.basename(backup)}`
}

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function generateDeviceToken() {
  return randomBytes(32).toString('base64url')
}

function mapCommand(row: RawCommand): StoredCommand {
  return {
    id: row.id,
    deviceId: row.device_id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    createdBy: row.created_by,
    status: row.status,
    error: row.error,
    appliedAt: row.applied_at,
    resultReceivedAt: row.result_received_at,
    fetchedAt: row.fetched_at,
    cancelledAt: row.cancelled_at,
  }
}

function mapDevice(row: RawDevice): DeviceRow {
  const deviceName = row.device_name ?? stripAppPrefix(row.paired_by)
  return {
    id: row.id,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    pairedBy: row.paired_by,
    label: row.label ?? deviceName,
    deviceName,
    revokedAt: row.revoked_at,
  }
}

const DEVICE_COLUMNS = 'id, label, device_name, paired_at, paired_by, last_seen_at, revoked_at'

export class DeviceLimitError extends Error {
  constructor(readonly max: number) {
    super('device_limit')
    this.name = 'DeviceLimitError'
  }
}

export function openStore(
  file: string,
  now: () => string = () => new Date().toISOString(),
  options: { log?: (message: string) => void } = {}
) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  const migrated = migrateStore(db, file)
  if (migrated) (options.log ?? console.log)(`[schockboard] ${migrated}`)

  function cancelPendingOf(deviceId: string, at: string, reason: string) {
    return Number(
      db
        .prepare("UPDATE commands SET status = 'cancelled', cancelled_at = ?, error = ? WHERE device_id = ? AND status = 'pending'")
        .run(at, reason, deviceId).changes
    )
  }

  const store = {
    db,
    close() {
      db.close()
    },

    // ---- devices ---------------------------------------------------------

    countActiveDevices() {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').get() as { n: number }).n)
    },

    /**
     * Registers a new, additional device. Returns the plain token once.
     * Throws DeviceLimitError when `maxDevices` active devices exist.
     */
    addDevice(input: { pairedBy: string; deviceName: string; maxDevices: number }) {
      const token = generateDeviceToken()
      const id = `dev_${randomUUID().replaceAll('-', '')}`
      const at = now()
      const name = input.deviceName.trim().slice(0, 80) || 'Gerät'
      db.exec('BEGIN IMMEDIATE')
      try {
        if (store.countActiveDevices() >= input.maxDevices) throw new DeviceLimitError(input.maxDevices)
        db.prepare('INSERT INTO devices (id, token_hash, paired_at, paired_by, label, device_name) VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          hashToken(token),
          at,
          input.pairedBy,
          name,
          name
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { id, token, pairedAt: at }
    },

    /** Self-enrollment of the app: every enrolling app becomes a new device (up to `maxDevices`). */
    enrollDevice(deviceName: string, maxDevices: number) {
      return store.addDevice({ pairedBy: `app: ${deviceName}`, deviceName, maxDevices })
    },

    /** Constant-time check of a bearer token against the active devices' hashes. */
    authenticateDevice(token: string): DeviceRow | null {
      const candidate = hashToken(token)
      const row = db
        .prepare(`SELECT ${DEVICE_COLUMNS}, token_hash FROM devices WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`)
        .get(candidate) as (RawDevice & { token_hash: Uint8Array }) | undefined
      const expected = row ? Buffer.from(row.token_hash) : Buffer.alloc(candidate.length)
      const matches = expected.length === candidate.length && timingSafeEqual(expected, candidate)
      if (!row || !matches) return null
      return mapDevice(row)
    },

    /** Blocks a device: its token stops working and its pending commands are cancelled. */
    revokeDevice(deviceId: string, reason = 'Gerät gesperrt') {
      const at = now()
      db.exec('BEGIN IMMEDIATE')
      try {
        const changed = Number(db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(at, deviceId).changes)
        const cancelled = changed > 0 ? cancelPendingOf(deviceId, at, reason) : 0
        db.exec('COMMIT')
        return { revoked: changed > 0, cancelled }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    /** Removes a blocked device with its command history and snapshot metadata. */
    deleteDevice(deviceId: string) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const changed = Number(db.prepare('DELETE FROM devices WHERE id = ? AND revoked_at IS NOT NULL').run(deviceId).changes)
        if (changed > 0) {
          db.prepare('DELETE FROM commands WHERE device_id = ?').run(deviceId)
          db.prepare('DELETE FROM snapshot_meta WHERE device_id = ?').run(deviceId)
        }
        db.exec('COMMIT')
        return changed > 0
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    renameDevice(deviceId: string, label: string) {
      return Number(db.prepare('UPDATE devices SET label = ? WHERE id = ?').run(label, deviceId).changes) > 0
    },

    touchDevice(deviceId: string) {
      db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now(), deviceId)
    },

    getDevice(deviceId: string): DeviceRow | null {
      const row = db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`).get(deviceId) as RawDevice | undefined
      return row ? mapDevice(row) : null
    },

    /** Active devices, oldest first (the first one is the default selection). */
    listActiveDevices(): DeviceRow[] {
      return (
        db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE revoked_at IS NULL ORDER BY paired_at ASC, rowid ASC`).all() as RawDevice[]
      ).map(mapDevice)
    },

    /** Default device for admin reads: the first active one. */
    getDefaultDevice(): DeviceRow | null {
      return store.listActiveDevices()[0] ?? null
    },

    /** Active first (oldest first), then blocked ones (newest block first). */
    listDevices(): DeviceSummary[] {
      const rows = db
        .prepare(
          `SELECT d.id, d.label, d.device_name, d.paired_at, d.paired_by, d.last_seen_at, d.revoked_at,
             m.received_at AS last_snapshot_at,
             (SELECT COUNT(*) FROM commands c WHERE c.device_id = d.id AND c.status = 'pending') AS pending
           FROM devices d LEFT JOIN snapshot_meta m ON m.device_id = d.id
           ORDER BY d.revoked_at IS NOT NULL, CASE WHEN d.revoked_at IS NULL THEN d.paired_at END ASC, d.revoked_at DESC`
        )
        .all() as Array<RawDevice & { last_snapshot_at: string | null; pending: number }>
      return rows.map((row) => {
        const device = mapDevice(row)
        return {
          id: device.id,
          label: device.label!,
          deviceName: device.deviceName!,
          pairedBy: device.pairedBy!,
          pairedAt: device.pairedAt,
          lastSeenAt: device.lastSeenAt,
          revokedAt: row.revoked_at,
          status: row.revoked_at ? 'blocked' : 'active',
          lastSnapshotAt: row.last_snapshot_at,
          pendingCommands: Number(row.pending),
        }
      })
    },

    // ---- snapshot metadata (per device) ----------------------------------

    recordSnapshot(deviceId: string, meta: Omit<SnapshotMeta, 'receivedAt' | 'deviceId'>) {
      const receivedAt = now()
      db.prepare(
        `INSERT INTO snapshot_meta (device_id, received_at, created_at, schema_version, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET received_at = excluded.received_at, created_at = excluded.created_at,
           schema_version = excluded.schema_version, size_bytes = excluded.size_bytes, uploaded_by = excluded.uploaded_by`
      ).run(deviceId, receivedAt, meta.createdAt, meta.schemaVersion, meta.sizeBytes, deviceId)
      return receivedAt
    },

    getSnapshotMeta(deviceId: string): SnapshotMeta | null {
      const row = db.prepare('SELECT * FROM snapshot_meta WHERE device_id = ?').get(deviceId) as
        | { received_at: string; created_at: string | null; schema_version: number | null; size_bytes: number; uploaded_by: string | null }
        | undefined
      return row
        ? {
            receivedAt: row.received_at,
            createdAt: row.created_at,
            schemaVersion: row.schema_version,
            sizeBytes: row.size_bytes,
            deviceId: row.uploaded_by,
          }
        : null
    },

    /** Device that should receive the old single-device snapshot.sqlite, until the file was moved. */
    pendingLegacySnapshotOwner(): string | null {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(LEGACY_SNAPSHOT_KEY) as { value: string } | undefined
      return row?.value ?? null
    },

    clearLegacySnapshotOwner() {
      db.prepare('DELETE FROM kv WHERE key = ?').run(LEGACY_SNAPSHOT_KEY)
    },

    // ---- commands --------------------------------------------------------

    createCommand(input: { deviceId: string; type: CommandType; payload: Record<string, unknown>; createdBy: string }): StoredCommand {
      const id = `cmd_${randomUUID().replaceAll('-', '')}`
      db.prepare(
        'INSERT INTO commands (id, device_id, type, payload_json, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, input.deviceId, input.type, JSON.stringify(input.payload), 'pending', now(), input.createdBy)
      return store.getCommand(id)!
    },

    getCommand(id: string): StoredCommand | null {
      const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as RawCommand | undefined
      return row ? mapCommand(row) : null
    },

    /** Newest first; `deviceId = null` lists every device. */
    listCommands(deviceId: string | null, limit = 500): StoredCommand[] {
      const rows = deviceId
        ? db.prepare('SELECT * FROM commands WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(deviceId, limit)
        : db.prepare('SELECT * FROM commands ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
      return (rows as RawCommand[]).map(mapCommand)
    },

    listPendingCommands(deviceId: string): StoredCommand[] {
      return (
        db
          .prepare("SELECT * FROM commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC, rowid ASC")
          .all(deviceId) as RawCommand[]
      ).map(mapCommand)
    },

    countPendingCommands(deviceId: string) {
      return Number(
        (db.prepare("SELECT COUNT(*) AS n FROM commands WHERE device_id = ? AND status = 'pending'").get(deviceId) as { n: number }).n
      )
    },

    /** Oldest first, at most `limit`, only this device's; marks them fetched (they stay pending until a result arrives). */
    fetchPendingForDevice(deviceId: string, limit = 100): RemoteCommand[] {
      const rows = db
        .prepare("SELECT * FROM commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT ?")
        .all(deviceId, limit) as RawCommand[]
      const at = now()
      const mark = db.prepare('UPDATE commands SET fetched_at = COALESCE(fetched_at, ?) WHERE id = ?')
      for (const row of rows) mark.run(at, row.id)
      return rows.map((row) => {
        const { id, type, payload, createdAt, createdBy } = mapCommand(row)
        return { id, type, payload, createdAt, createdBy }
      })
    },

    /** Deletes finished (non-pending) commands of one device, or of all devices with `null`; pending ones stay queued. */
    deleteFinishedCommands(deviceId: string | null) {
      return Number(
        (deviceId
          ? db.prepare("DELETE FROM commands WHERE status != 'pending' AND device_id = ?").run(deviceId)
          : db.prepare("DELETE FROM commands WHERE status != 'pending'").run()
        ).changes
      )
    },

    /** Retention: removes finished commands (all devices) whose last change is older than `days`. */
    purgeFinishedCommands(days: number) {
      const cutoff = new Date(Date.parse(now()) - days * 86_400_000).toISOString()
      return Number(
        db
          .prepare(
            "DELETE FROM commands WHERE status != 'pending' AND COALESCE(result_received_at, cancelled_at, applied_at, created_at) < ?"
          )
          .run(cutoff).changes
      )
    },

    /** Cancels a pending command. Returns false if it does not exist or is no longer pending. */
    cancelCommand(id: string) {
      const result = db
        .prepare("UPDATE commands SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'pending'")
        .run(now(), id)
      return Number(result.changes) > 0
    },

    /**
     * Stores results reported by `deviceId`. The device is the source of
     * truth, so a result also wins over a cancellation that raced with the
     * device's fetch. Results for unknown, finished or other devices'
     * commands are ignored.
     */
    applyResults(deviceId: string, results: CommandResult[]) {
      const at = now()
      const update = db.prepare(
        `UPDATE commands SET status = ?, error = ?, applied_at = ?, result_received_at = ?
         WHERE id = ? AND device_id = ? AND status IN ('pending', 'cancelled')`
      )
      let accepted = 0
      const ignored: string[] = []
      db.exec('BEGIN')
      try {
        for (const result of results) {
          const changes = Number(
            update.run(
              result.status,
              result.status === 'rejected' ? (result.error ?? 'Abgelehnt') : null,
              result.appliedAt,
              at,
              result.id,
              deviceId
            ).changes
          )
          if (changes > 0) accepted++
          else ignored.push(result.id)
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { accepted, ignored }
    },
  }
  return store
}

export type Store = ReturnType<typeof openStore>
