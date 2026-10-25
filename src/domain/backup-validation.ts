const SQLITE_HEADER = 'SQLite format 3\0'
const MAX_BACKUP_BYTES = 150 * 1024 * 1024

/** Reject unrelated or unexpectedly huge documents before SQLite opens them. */
export function validateSqliteBackupBytes(bytes: Uint8Array) {
  if (bytes.length < 100 || bytes.length > MAX_BACKUP_BYTES) {
    throw new Error('Keine gültige SQLite-Sicherung oder Datei zu groß (max. 150 MB).')
  }
  for (let index = 0; index < SQLITE_HEADER.length; index++) {
    if (bytes[index] !== SQLITE_HEADER.charCodeAt(index)) {
      throw new Error('Diese Datei ist keine SQLite-Datenbank.')
    }
  }
}

/**
 * `serialize()` of a WAL database keeps the WAL marker (bytes 18/19 = 2) in
 * the header. Such an image cannot be opened via `deserialize()` because an
 * in-memory database has no WAL file, so switch the copy to rollback-journal
 * mode (1) first. Returns a new array; the input stays untouched.
 */
export function withRollbackJournalHeader(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes)
  if (copy.length >= 20 && copy[18] === 2 && copy[19] === 2) {
    copy[18] = 1
    copy[19] = 1
  }
  return copy
}

/** Every table and view the current schema queries directly. */
export const REQUIRED_BACKUP_TABLES = [
  'schema_migrations',
  'players',
  'auth_accounts',
  'app_settings',
  'sessions',
  'session_attendance',
  'loss_entries',
  'absence_charges',
  'payments',
  'corrections',
  'audit_events',
] as const

export const REQUIRED_BACKUP_VIEWS = ['v_player_debts', 'v_session_totals', 'v_cashbox'] as const

/** Names missing from a backup's sqlite_master listing. */
export function findMissingSchemaObjects(objects: Array<{ name: string; type: string }>) {
  const tables = new Set(objects.filter((row) => row.type === 'table').map((row) => row.name))
  const views = new Set(objects.filter((row) => row.type === 'view').map((row) => row.name))
  return [
    ...REQUIRED_BACKUP_TABLES.filter((name) => !tables.has(name)),
    ...REQUIRED_BACKUP_VIEWS.filter((name) => !views.has(name)),
  ]
}
