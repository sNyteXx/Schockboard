import { DatabaseSync } from 'node:sqlite'

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import {
  addBeerRoundEntry,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  getSessionDetail,
  recordCorrection,
  recordPayment,
  toggleAttendance,
} from '@/db/queries'

import { getActiveRawDatabase, setActiveDatabase } from '../src/snapshot-client'

const actor = { accountId: 'acc_demo', username: 'Demo' }

export type DemoIds = {
  players: Record<'anna' | 'ben' | 'cem' | 'dana', string>
  closedSessionId: string
  openSessionId: string
}

/**
 * Builds a realistic Schockboard database with the app's own write queries
 * and exports it as a standalone SQLite image (VACUUM INTO). Restores the
 * previously active database afterwards.
 */
export function buildDemoSnapshot(outFile: string, options: { wal?: boolean } = {}): DemoIds {
  const previous = getActiveRawDatabase()
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  setActiveDatabase(db)
  resetBootstrapFlag()
  try {
    ensureDatabaseReady()
    db.exec(
      "INSERT INTO auth_accounts (id, username, password_hash, password_salt, created_at, updated_at) VALUES ('acc_demo', 'Demo', '-', '-', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')"
    )
    const players = {
      anna: createPlayer({ actor, name: 'Anna', isCore: true }),
      ben: createPlayer({ actor, name: 'Ben', isCore: true }),
      cem: createPlayer({ actor, name: 'Cem', isCore: true }),
      dana: createPlayer({ actor, name: 'Dana', isCore: true }),
    }

    const closedSessionId = createSession({ actor, title: 'Freitag', notes: null, stakeCents: 100 })
    toggleAttendance({ actor, sessionId: closedSessionId, playerId: players.dana })
    addLossEntry({ actor, sessionId: closedSessionId, playerId: players.anna, note: null })
    addLossEntry({ actor, sessionId: closedSessionId, playerId: players.anna, note: null })
    addLossEntry({ actor, sessionId: closedSessionId, playerId: players.ben, note: null })
    addBeerRoundEntry({ actor, sessionId: closedSessionId, playerId: players.cem, amountCents: 600, note: null })
    closeSession({ actor, sessionId: closedSessionId })

    recordPayment({ actor, playerId: players.anna, amountCents: 200, note: 'Bar' })
    recordCorrection({ actor, playerId: players.ben, amountCents: -50, reason: 'Rundungsfehler' })

    const openSessionId = createSession({ actor, title: 'Samstag', notes: 'Heimspiel', stakeCents: 50 })
    addLossEntry({ actor, sessionId: openSessionId, playerId: players.cem, note: null })
    addLossEntry({ actor, sessionId: openSessionId, playerId: players.dana, note: null })
    if (!getSessionDetail(openSessionId)) throw new Error('demo session missing')

    if (options.wal) {
      // Mimic a device image serialized from a WAL database (header bytes 18/19 = 2).
      db.exec(`VACUUM INTO '${outFile.replaceAll("'", "''")}'`)
      const file = new DatabaseSync(outFile)
      file.exec('PRAGMA journal_mode = WAL;')
      file.close()
    } else {
      db.exec(`VACUUM INTO '${outFile.replaceAll("'", "''")}'`)
    }
    return { players, closedSessionId, openSessionId }
  } finally {
    db.close()
    setActiveDatabase(previous)
    resetBootstrapFlag()
  }
}
