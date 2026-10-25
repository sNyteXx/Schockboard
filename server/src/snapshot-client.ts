import { DatabaseSync } from 'node:sqlite'

/**
 * Server implementation of the app's `@/db/client` module (expo-sqlite sync
 * API subset), backed by `node:sqlite`. The app's query layer
 * (src/db/queries.ts) runs unchanged against whichever database is active —
 * normally the working copy of one device's latest snapshot, selected for the
 * duration of a (synchronous) admin request via `withSelectedDatabase`.
 */
type Params = Record<string, unknown>
type Bindable = string | number | bigint | null | Uint8Array

function bind(params: Params = {}) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : (value ?? null)])
  ) as Record<string, Bindable>
}

export type SqliteAdapter = ReturnType<typeof wrapDatabase>

export function wrapDatabase(db: DatabaseSync) {
  let depth = 0
  return {
    raw: db,
    execSync(source: string) {
      db.exec(source)
    },
    runSync(source: string, params?: Params) {
      const result = db.prepare(source).run(bind(params))
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    },
    getFirstSync<T>(source: string, params?: Params) {
      return (db.prepare(source).get(bind(params)) ?? null) as T | null
    },
    getAllSync<T>(source: string, params?: Params) {
      return db.prepare(source).all(bind(params)) as T[]
    },
    withTransactionSync(task: () => void) {
      if (depth > 0) throw new Error('nested transaction')
      depth++
      db.exec('BEGIN')
      try {
        task()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        depth--
      }
    },
    closeSync() {
      db.close()
    },
  }
}

/** Throw-away in-memory database (the app builds its reference schema with it). */
export function openScratchDatabase() {
  return wrapDatabase(new DatabaseSync(':memory:'))
}

let active: SqliteAdapter | null = null

/** Swaps the database the app queries run against. Returns the previous one. */
export function setActiveDatabase(db: DatabaseSync | null) {
  const previous = active
  active = db ? wrapDatabase(db) : null
  return previous
}

/**
 * Runs `task` synchronously with `adapter` as the active database and
 * restores the previous selection afterwards (also on errors). Node runs
 * synchronous code to completion, so no other request can observe the
 * selection. Async tasks are refused: an await would leak the selection.
 */
export function withSelectedDatabase<T>(adapter: SqliteAdapter, task: () => T): T {
  const previous = active
  active = adapter
  try {
    const result = task()
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      throw new Error('withSelectedDatabase: task must be synchronous')
    }
    return result
  } finally {
    active = previous
  }
}

export function hasActiveDatabase() {
  return active !== null
}

export function getActiveRawDatabase() {
  return active?.raw ?? null
}

export class NoSnapshotError extends Error {
  constructor() {
    super('no_snapshot')
    this.name = 'NoSnapshotError'
  }
}

export function getSqlite() {
  if (!active) throw new NoSnapshotError()
  return active
}

export function sqliteRun(source: string, params: Params = {}) {
  return getSqlite().runSync(source, params)
}

export function sqliteGet<T>(source: string, params: Params = {}) {
  return getSqlite().getFirstSync<T>(source, params)
}

export function sqliteAll<T>(source: string, params: Params = {}) {
  return getSqlite().getAllSync<T>(source, params)
}
