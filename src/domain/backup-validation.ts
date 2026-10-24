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
