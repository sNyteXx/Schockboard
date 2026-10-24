import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { resetBootstrapFlag } from '@/db/bootstrap'
import { findMissingSchemaObjects, withRollbackJournalHeader } from '@/domain/backup-validation'

import { getActiveRawDatabase, setActiveDatabase } from './snapshot-client'

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

/**
 * Owns `snapshot.sqlite` (raw image exactly as uploaded) and
 * `snapshot-work.sqlite` (a private working copy the app queries run on).
 * The working copy may be touched by the app's idempotent bootstrap; it is
 * rebuilt from the raw image on each upload and on startup, and nothing in
 * it ever travels back to the device.
 */
export function createSnapshotManager(dataDir: string) {
  const rawFile = path.join(dataDir, 'snapshot.sqlite')
  const workFile = path.join(dataDir, 'snapshot-work.sqlite')

  function activate(file: string) {
    const db = new DatabaseSync(file)
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
    const previous = getActiveRawDatabase()
    setActiveDatabase(db)
    resetBootstrapFlag()
    if (previous && previous !== db) {
      try {
        previous.close()
      } catch {
        // already closed
      }
    }
  }

  function deactivate() {
    const previous = getActiveRawDatabase()
    setActiveDatabase(null)
    resetBootstrapFlag()
    previous?.close()
  }

  return {
    rawFile,
    workFile,

    /** Rebuilds the working copy from the stored raw image (startup). */
    loadExisting() {
      if (!fs.existsSync(rawFile)) return false
      const bytes = fs.readFileSync(rawFile)
      deactivate()
      removeQuietly(workFile)
      writeFileAtomic(workFile, withRollbackJournalHeader(bytes))
      activate(workFile)
      return true
    },

    /**
     * Validates and installs a new image. Throws SnapshotValidationError
     * without touching the current snapshot if the upload is unusable.
     */
    install(bytes: Uint8Array, maxBytes: number) {
      assertSqliteImage(bytes, maxBytes)
      const workBytes = withRollbackJournalHeader(bytes)

      const candidate = path.join(dataDir, `snapshot-candidate.${process.pid}.${Date.now()}.sqlite`)
      try {
        writeFileAtomic(candidate, workBytes)
        const info = inspectDatabase(candidate)

        writeFileAtomic(rawFile, bytes)
        deactivate()
        removeQuietly(workFile)
        fs.renameSync(candidate, workFile)
        activate(workFile)
        return info
      } finally {
        removeQuietly(candidate)
      }
    },

    close() {
      deactivate()
    },
  }
}

export type SnapshotManager = ReturnType<typeof createSnapshotManager>
