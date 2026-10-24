import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { CommandResult, CommandType, RemoteCommand } from '@/remote/protocol'

/**
 * Server-side state in `server.db`: the paired device (token hash only),
 * the command queue and metadata of the latest snapshot. Never holds any
 * Schockboard business data — that only lives in the uploaded snapshot.
 */

export type CommandStatus = 'pending' | 'applied' | 'rejected' | 'cancelled'

export type StoredCommand = RemoteCommand & {
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
}

export type SnapshotMeta = {
  receivedAt: string
  createdAt: string | null
  schemaVersion: number | null
  sizeBytes: number
  deviceId: string | null
}

type RawCommand = {
  id: string
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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    token_hash BLOB NOT NULL,
    paired_at TEXT NOT NULL,
    paired_by TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
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
  CREATE TABLE IF NOT EXISTS snapshot_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    received_at TEXT NOT NULL,
    created_at TEXT,
    schema_version INTEGER,
    size_bytes INTEGER NOT NULL,
    device_id TEXT
  );
`

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function generateDeviceToken() {
  return randomBytes(32).toString('base64url')
}

function mapCommand(row: RawCommand): StoredCommand {
  return {
    id: row.id,
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

export function openStore(file: string, now: () => string = () => new Date().toISOString()) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)

  return {
    db,
    close() {
      db.close()
    },

    // ---- devices ---------------------------------------------------------

    /** Revokes every previous device and registers a new one. Returns the plain token once. */
    pairDevice(pairedBy: string) {
      const token = generateDeviceToken()
      const id = `dev_${randomUUID().replaceAll('-', '')}`
      const at = now()
      db.exec('BEGIN')
      try {
        db.prepare('UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL').run(at)
        db.prepare('INSERT INTO devices (id, token_hash, paired_at, paired_by) VALUES (?, ?, ?, ?)').run(
          id,
          hashToken(token),
          at,
          pairedBy
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { id, token, pairedAt: at }
    },

    /** Constant-time check of a bearer token against the active device's hash. */
    authenticateDevice(token: string): DeviceRow | null {
      const row = db
        .prepare('SELECT id, token_hash, paired_at, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY paired_at DESC LIMIT 1')
        .get() as { id: string; token_hash: Uint8Array; paired_at: string; last_seen_at: string | null } | undefined
      const candidate = hashToken(token)
      // Always compare, even without a device, so timing does not leak pairing state.
      const expected = row ? Buffer.from(row.token_hash) : Buffer.alloc(candidate.length)
      const matches = expected.length === candidate.length && timingSafeEqual(expected, candidate)
      if (!row || !matches) return null
      return { id: row.id, pairedAt: row.paired_at, lastSeenAt: row.last_seen_at }
    },

    // ---- automatic enrollment -------------------------------------------

    /**
     * The app enrolls itself without user interaction. That is only allowed
     * while no device was ever registered (first install) or during a short
     * window the admin opened in the web UI to replace the device.
     */
    enrollmentOpenUntil(): string | null {
      const everEnrolled = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n > 0
      if (!everEnrolled) return 'first-device'
      const row = db.prepare("SELECT value FROM kv WHERE key = 'enrollment_open_until'").get() as { value: string } | undefined
      return row && Date.parse(row.value) > Date.now() ? row.value : null
    },

    openEnrollment(minutes: number) {
      const until = new Date(Date.now() + minutes * 60_000).toISOString()
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('enrollment_open_until', ?)").run(until)
      return until
    },

    closeEnrollment() {
      db.prepare("DELETE FROM kv WHERE key = 'enrollment_open_until'").run()
    },

    /** Registers the calling app as the (only) device and closes enrollment again. */
    enrollDevice(deviceName: string) {
      if (!this.enrollmentOpenUntil()) return null
      const device = this.pairDevice(`app: ${deviceName}`)
      this.closeEnrollment()
      return device
    },

    revokeActiveDevice() {
      db.prepare('UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL').run(now())
    },

    touchDevice(deviceId: string) {
      db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now(), deviceId)
    },

    getActiveDevice(): DeviceRow | null {
      const row = db
        .prepare('SELECT id, paired_at, paired_by, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY paired_at DESC LIMIT 1')
        .get() as { id: string; paired_at: string; paired_by: string; last_seen_at: string | null } | undefined
      return row ? { id: row.id, pairedAt: row.paired_at, lastSeenAt: row.last_seen_at, pairedBy: row.paired_by } : null
    },

    // ---- snapshot metadata ----------------------------------------------

    recordSnapshot(meta: Omit<SnapshotMeta, 'receivedAt'>) {
      const receivedAt = now()
      db.prepare(
        `INSERT INTO snapshot_meta (id, received_at, created_at, schema_version, size_bytes, device_id)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET received_at = excluded.received_at, created_at = excluded.created_at,
           schema_version = excluded.schema_version, size_bytes = excluded.size_bytes, device_id = excluded.device_id`
      ).run(receivedAt, meta.createdAt, meta.schemaVersion, meta.sizeBytes, meta.deviceId)
      return receivedAt
    },

    getSnapshotMeta(): SnapshotMeta | null {
      const row = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1').get() as
        | { received_at: string; created_at: string | null; schema_version: number | null; size_bytes: number; device_id: string | null }
        | undefined
      return row
        ? {
            receivedAt: row.received_at,
            createdAt: row.created_at,
            schemaVersion: row.schema_version,
            sizeBytes: row.size_bytes,
            deviceId: row.device_id,
          }
        : null
    },

    // ---- commands --------------------------------------------------------

    createCommand(input: { type: CommandType; payload: Record<string, unknown>; createdBy: string }): StoredCommand {
      const id = `cmd_${randomUUID().replaceAll('-', '')}`
      db.prepare('INSERT INTO commands (id, type, payload_json, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        input.type,
        JSON.stringify(input.payload),
        'pending',
        now(),
        input.createdBy
      )
      return this.getCommand(id)!
    },

    getCommand(id: string): StoredCommand | null {
      const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as RawCommand | undefined
      return row ? mapCommand(row) : null
    },

    listCommands(limit = 500): StoredCommand[] {
      return (
        db.prepare('SELECT * FROM commands ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as RawCommand[]
      ).map(mapCommand)
    },

    listPendingCommands(): StoredCommand[] {
      return (
        db.prepare("SELECT * FROM commands WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC").all() as RawCommand[]
      ).map(mapCommand)
    },

    countPendingCommands() {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM commands WHERE status = 'pending'").get() as { n: number }).n)
    },

    /** Oldest first, at most `limit`; marks them as fetched (they stay pending until a result arrives). */
    fetchPendingForDevice(limit = 100): RemoteCommand[] {
      const rows = db
        .prepare("SELECT * FROM commands WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT ?")
        .all(limit) as RawCommand[]
      const at = now()
      const mark = db.prepare('UPDATE commands SET fetched_at = COALESCE(fetched_at, ?) WHERE id = ?')
      for (const row of rows) mark.run(at, row.id)
      return rows.map((row) => {
        const { id, type, payload, createdAt, createdBy } = mapCommand(row)
        return { id, type, payload, createdAt, createdBy }
      })
    },

    /** Deletes all finished (non-pending) commands; pending ones stay queued. */
    deleteFinishedCommands() {
      return Number(db.prepare("DELETE FROM commands WHERE status != 'pending'").run().changes)
    },

    /** Retention: removes finished commands whose last change is older than `days`. */
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
     * Stores device results. The device is the source of truth, so a result
     * also wins over a cancellation that raced with the device's fetch.
     * Results for already finished or unknown commands are ignored.
     */
    applyResults(results: CommandResult[]) {
      const at = now()
      const update = db.prepare(
        `UPDATE commands SET status = ?, error = ?, applied_at = ?, result_received_at = ?
         WHERE id = ? AND status IN ('pending', 'cancelled')`
      )
      let accepted = 0
      const ignored: string[] = []
      db.exec('BEGIN')
      try {
        for (const result of results) {
          const changes = Number(
            update.run(result.status, result.status === 'rejected' ? (result.error ?? 'Abgelehnt') : null, result.appliedAt, at, result.id)
              .changes
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
}

export type Store = ReturnType<typeof openStore>
