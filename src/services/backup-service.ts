import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { backupDatabaseSync, deserializeDatabaseSync } from 'expo-sqlite'

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { getSqlite } from '@/db/client'
import { findMissingSchemaObjects, validateSqliteBackupBytes, withRollbackJournalHeader } from '@/domain/backup-validation'

const CURRENT_MIGRATION = 6

/** Opens a serialized database image in memory, tolerating WAL headers. */
function openImage(bytes: Uint8Array) {
  return deserializeDatabaseSync(withRollbackJournalHeader(bytes))
}

function validateContent(bytes: Uint8Array) {
  validateSqliteBackupBytes(bytes)
  const source = openImage(bytes)
  try {
    const integrity = source.getFirstSync<{ integrity_check: string }>('PRAGMA integrity_check')
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('SQLite-Integritätsprüfung fehlgeschlagen.')
    }

    const objects = source.getAllSync<{ name: string; type: string }>(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')"
    )
    if (!objects.some((row) => row.name === 'players') || !objects.some((row) => row.name === 'schema_migrations')) {
      throw new Error('Die Sicherung gehört nicht zu Schockboard.')
    }

    const version = source.getFirstSync<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')?.version ?? 0
    if (version < 1 || version > CURRENT_MIGRATION) {
      throw new Error('Diese Sicherungsversion ist nicht kompatibel.')
    }

    // Older backups get missing columns from migrations, but every base table
    // and view is created by migration 1 and must be present.
    const missing = findMissingSchemaObjects(objects)
    if (missing.length > 0) {
      throw new Error(`Die Sicherung ist unvollständig (fehlt: ${missing.join(', ')}).`)
    }

    if (source.getFirstSync('PRAGMA foreign_key_check')) {
      throw new Error('Die Sicherung enthält ungültige Verknüpfungen.')
    }
  } finally {
    source.closeSync()
  }
}

/** Fails loudly if the restored database cannot serve the app's core reads. */
function smokeTestRestoredDatabase() {
  const db = getSqlite()
  db.getAllSync('SELECT * FROM v_player_debts LIMIT 1')
  db.getAllSync('SELECT * FROM v_session_totals LIMIT 1')
  db.getAllSync('SELECT * FROM v_cashbox LIMIT 1')
  db.getAllSync('SELECT id, view_mode, theme_id, absence_penalty_mode FROM app_settings LIMIT 1')
  db.getAllSync('SELECT id, is_beer_round FROM loss_entries LIMIT 1')
  db.getAllSync('SELECT id FROM auth_accounts LIMIT 1')
}

function copyInto(source: Uint8Array) {
  const image = openImage(source)
  try {
    backupDatabaseSync({ sourceDatabase: image, destDatabase: getSqlite() })
  } finally {
    image.closeSync()
  }
  getSqlite().execSync('PRAGMA journal_mode = WAL;')
  resetBootstrapFlag()
  ensureDatabaseReady() // forward-only migration to the current schema
}

export const BackupService = {
  async shareBackup() {
    ensureDatabaseReady()
    if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const destination = new File(Paths.cache, `schockboard-backup-${timestamp}.sqlite`)
    destination.create({ overwrite: true })
    // Store as a regular rollback-journal file so any SQLite tool can open it.
    destination.write(withRollbackJournalHeader(getSqlite().serializeSync()))
    await Sharing.shareAsync(destination.uri, {
      mimeType: 'application/x-sqlite3',
      dialogTitle: 'Schockboard-Sicherung an einem sicheren Ort speichern',
    })
  },

  async pickAndValidateBackup(): Promise<Uint8Array | null> {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
    if (result.canceled || !result.assets.length) return null
    const selectedFile = new File(result.assets[0].uri)
    const bytes = await selectedFile.bytes()
    validateContent(bytes)
    return bytes
  },

  restoreValidatedBackup(bytes: Uint8Array) {
    validateContent(bytes)
    const previousState = getSqlite().serializeSync()

    try {
      copyInto(bytes)
      smokeTestRestoredDatabase()
    } catch (error) {
      // Roll back to the in-memory snapshot of the old database.
      copyInto(previousState)
      throw error
    }
  },
}
