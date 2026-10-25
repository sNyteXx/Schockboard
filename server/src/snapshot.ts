import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { findMissingSchemaObjects, withRollbackJournalHeader } from '@/domain/backup-validation'

import {
  getActiveRawDatabase,
  NoSnapshotError,
  setActiveDatabase,
  withSelectedDatabase,
  wrapDatabase,
  type SqliteAdapter,
} from './snapshot-client'

const SQLITE_HEADER = 'SQLite format 3\0'

export class SnapshotValidationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400
  ) {
    super(message)
    this.name = 'SnapshotValidationError'
  }
}

export function assertSqliteImage(bytes: Uint8Array, maxBytes: number) {
  if (bytes.length > maxBytes) {
    throw new SnapshotValidationError(`Snapshot zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`, 413)
  }
  if (bytes.length < 512) {
    throw new SnapshotValidationError('Snapshot ist zu klein für eine SQLite-Datenbank.')
  }
  for (let index = 0; index < SQLITE_HEADER.length; index++) {
    if (bytes[index] !== SQLITE_HEADER.charCodeAt(index)) {
      throw new SnapshotValidationError('Snapshot ist keine SQLite-Datenbank.')
    }
  }
}

function removeQuietly(file: string) {
  for (const candidate of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) {
    fs.rmSync(candidate, { force: true })
  }
}

function writeFileAtomic(target: string, bytes: Uint8Array) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  const fd = fs.openSync(temp, 'w', 0o600)
  try {
    fs.writeSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temp, target)
}

/** Opens a SQLite file and checks it looks like a Schockboard database. */
function inspectDatabase(file: string) {
  const db = new DatabaseSync(file)
  try {
    const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    const verdict = check ? Object.values(check)[0] : null
    if (verdict !== 'ok') {
      throw new SnapshotValidationError('Snapshot ist beschädigt (quick_check fehlgeschlagen).')
    }
    const objects = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')").all() as Array<{
      name: string
      type: string
    }>
    const missing = findMissingSchemaObjects(objects)
    if (missing.length > 0) {
      throw new SnapshotValidationError(`Snapshot unvollständig, es fehlt: ${missing.join(', ')}`)
    }
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }
    return { schemaVersion: row.version ?? null }
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error
    throw new SnapshotValidationError(`Snapshot konnte nicht gelesen werden: ${(error as Error).message}`)
  } finally {
    db.close()
  }
}

const DEVICE_ID = /^dev_[A-Za-z0-9_-]{1,64}$/

function assertDeviceId(deviceId: string) {
  if (!DEVICE_ID.test(deviceId)) throw new Error(`invalid device id: ${deviceId}`)
}

type OpenSnapshot = { adapter: SqliteAdapter; bootstrapped: boolean }

/**
 * Owns one snapshot per device under `DATA_DIR/snapshots/`:
 * `<deviceId>.sqlite` (raw image exactly as uploaded) and
 * `<deviceId>-work.sqlite` (a private working copy the app queries run on).
 * The working copy may be touched by the app's idempotent bootstrap; it is
 * rebuilt from the raw image on each upload and on first use after startup,
 * and nothing in it ever travels back to the device.
 *
 * Opened working copies are cached per device. `withDevice` selects one for
 * the app queries for the duration of a synchronous callback.
 */
export function createSnapshotManager(dataDir: string) {
  const dir = path.join(dataDir, 'snapshots')
  const cache = new Map<string, OpenSnapshot>()

  const rawFile = (deviceId: string) => {
    assertDeviceId(deviceId)
    return path.join(dir, `${deviceId}.sqlite`)
  }
  const workFile = (deviceId: string) => {
    assertDeviceId(deviceId)
    return path.join(dir, `${deviceId}-work.sqlite`)
  }

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true })
  }

  function closeCached(deviceId: string) {
    const entry = cache.get(deviceId)
    cache.delete(deviceId)
    if (getActiveRawDatabase() === entry?.adapter.raw) setActiveDatabase(null)
    try {
      entry?.adapter.closeSync()
    } catch {
      // already closed
    }
  }

  function openWork(deviceId: string, file: string) {
    const db = new DatabaseSync(file)
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
    const entry: OpenSnapshot = { adapter: wrapDatabase(db), bootstrapped: false }
    cache.set(deviceId, entry)
    return entry
  }

  /** Cached working copy; rebuilt from the raw image on first use. */
  function open(deviceId: string): OpenSnapshot | null {
    const cached = cache.get(deviceId)
    if (cached) return cached
    const raw = rawFile(deviceId)
    if (!fs.existsSync(raw)) return null
    const work = workFile(deviceId)
    removeQuietly(work)
    writeFileAtomic(work, withRollbackJournalHeader(fs.readFileSync(raw)))
    return openWork(deviceId, work)
  }

  return {
    dir,
    rawFile,
    workFile,

    has(deviceId: string) {
      return cache.has(deviceId) || fs.existsSync(rawFile(deviceId))
    },

    /**
     * Runs `task` with the device's working copy as the database for the
     * app queries (`getSqlite()`). Throws NoSnapshotError without one.
     */
    withDevice<T>(deviceId: string, task: () => T): T {
      const entry = open(deviceId)
      if (!entry) throw new NoSnapshotError()
      return withSelectedDatabase(entry.adapter, () => {
        if (!entry.bootstrapped) {
          // The app's bootstrap flag is global; run it once per opened copy.
          resetBootstrapFlag()
          ensureDatabaseReady()
          entry.bootstrapped = true
        }
        return task()
      })
    },

    /**
     * Validates and installs a new image for one device. Throws
     * SnapshotValidationError without touching the current snapshot if the
     * upload is unusable.
     */
    install(deviceId: string, bytes: Uint8Array, maxBytes: number) {
      assertSqliteImage(bytes, maxBytes)
      ensureDir()
      const workBytes = withRollbackJournalHeader(bytes)
      const candidate = path.join(dir, `${deviceId}-candidate.${process.pid}.${Date.now()}.sqlite`)
      try {
        writeFileAtomic(candidate, workBytes)
        const info = inspectDatabase(candidate)

        writeFileAtomic(rawFile(deviceId), bytes)
        closeCached(deviceId)
        removeQuietly(workFile(deviceId))
        fs.renameSync(candidate, workFile(deviceId))
        openWork(deviceId, workFile(deviceId))
        return info
      } finally {
        removeQuietly(candidate)
      }
    },

    /** Deletes a device's snapshot files (removed devices). */
    remove(deviceId: string) {
      closeCached(deviceId)
      removeQuietly(rawFile(deviceId))
      removeQuietly(workFile(deviceId))
    },

    /**
     * Single-device layout → per device: moves `DATA_DIR/snapshot.sqlite` to
     * `snapshots/<deviceId>.sqlite` (rename, byte-identical) and drops the old
     * working copy. Idempotent; never overwrites an existing per-device image.
     */
    migrateLegacy(deviceId: string | null): 'moved' | 'kept' | 'none' {
      const legacyRaw = path.join(dataDir, 'snapshot.sqlite')
      const legacyWork = path.join(dataDir, 'snapshot-work.sqlite')
      if (!fs.existsSync(legacyRaw)) {
        removeQuietly(legacyWork)
        return 'none'
      }
      if (!deviceId) return 'kept'
      ensureDir()
      const target = rawFile(deviceId)
      if (fs.existsSync(target)) return 'kept'
      fs.renameSync(legacyRaw, target)
      removeQuietly(legacyWork)
      return 'moved'
    },

    close() {
      for (const deviceId of [...cache.keys()]) closeCached(deviceId)
      setActiveDatabase(null)
      resetBootstrapFlag()
    },
  }
}

export type SnapshotManager = ReturnType<typeof createSnapshotManager>
