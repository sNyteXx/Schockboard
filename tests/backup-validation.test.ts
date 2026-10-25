import { describe, expect, it } from 'vitest'

import {
  REQUIRED_BACKUP_TABLES,
  findMissingSchemaObjects,
  validateSqliteBackupBytes,
  withRollbackJournalHeader,
} from '@/domain/backup-validation'

describe('SQLite backup validation', () => {
  const validHeader = new Uint8Array(100)
  for (const [index, char] of [...'SQLite format 3\0'].entries()) validHeader[index] = char.charCodeAt(0)

  it('accepts a plausible SQLite file header', () => {
    expect(() => validateSqliteBackupBytes(validHeader)).not.toThrow()
  })

  it('rejects unrelated files', () => {
    expect(() => validateSqliteBackupBytes(new Uint8Array(100))).toThrow('keine SQLite-Datenbank')
  })

  it('rejects truncated files', () => {
    expect(() => validateSqliteBackupBytes(validHeader.slice(0, 20))).toThrow('Keine gültige')
  })
})

describe('backup image helpers', () => {
  it('switches WAL headers to rollback-journal mode without mutating the input', () => {
    const wal = new Uint8Array(100)
    wal[18] = 2
    wal[19] = 2
    const fixed = withRollbackJournalHeader(wal)
    expect([fixed[18], fixed[19]]).toEqual([1, 1])
    expect([wal[18], wal[19]]).toEqual([2, 2])
  })

  it('reports every missing table and view', () => {
    const objects = [
      ...REQUIRED_BACKUP_TABLES.filter((name) => name !== 'auth_accounts').map((name) => ({ name, type: 'table' })),
      { name: 'v_cashbox', type: 'view' },
    ]
    expect(findMissingSchemaObjects(objects)).toEqual(['auth_accounts', 'v_player_debts', 'v_session_totals'])
  })
})
