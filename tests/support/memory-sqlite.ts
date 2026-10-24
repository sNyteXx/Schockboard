import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Minimal stand-in for the expo-sqlite sync API used by src/db/client.ts,
 * backed by Node's built-in SQLite so queries run against a real engine.
 */
type Params = Record<string, unknown>

function bind(params: Params = {}) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value ?? null])
  ) as Record<string, string | number | null>
}

export function createMemoryDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
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
    closeSync() {
      db.close()
    },
    /** Same contract as expo-sqlite's serializeSync: the database file image. */
    serializeSync() {
      const dir = mkdtempSync(join(tmpdir(), 'sb-serialize-'))
      try {
        const file = join(dir, 'image.sqlite')
        db.exec(`VACUUM INTO '${file}'`)
        return new Uint8Array(readFileSync(file))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    withTransactionSync(task: () => void) {
      // expo-sqlite does not support nesting either; fail loudly if we do.
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
  }
}

export type MemoryDatabase = ReturnType<typeof createMemoryDatabase>

export const memory = { current: createMemoryDatabase() }

export const clientMock = {
  getSqlite: () => memory.current,
  openScratchDatabase: () => createMemoryDatabase(),
  sqliteRun: (source: string, params: Params = {}) => memory.current.runSync(source, params),
  sqliteGet: <T>(source: string, params: Params = {}) => memory.current.getFirstSync<T>(source, params),
  sqliteAll: <T>(source: string, params: Params = {}) => memory.current.getAllSync<T>(source, params),
}

export const cryptoMock = { randomUUID }
