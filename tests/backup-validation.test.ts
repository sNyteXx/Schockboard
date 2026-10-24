import { describe, expect, it } from 'vitest'

import { validateSqliteBackupBytes } from '@/domain/backup-validation'

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
