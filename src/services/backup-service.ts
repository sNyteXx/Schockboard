import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { backupDatabaseSync, deserializeDatabaseSync } from 'expo-sqlite'

import { LATEST_SCHEMA_VERSION, ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { getSqlite } from '@/db/client'
import { findMissingSchemaObjects, validateSqliteBackupBytes, withRollbackJournalHeader } from '@/domain/backup-validation'

const CURRENT_MIGRATION = LATEST_SCHEMA_VERSION

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

const backupDirectory = () => new Directory(Paths.document, 'backups')
const backupName = /^[a-z0-9-]+\.sqlite$/i

export const BackupService = {
  validate: validateContent,
  saveLocal(reason: 'evening' | 'before-restore' | 'before-transfer') {
    ensureDatabaseReady()
    const directory = backupDirectory()
    directory.create({ idempotent: true, intermediates: true })
    const name = `${reason}-${new Date().toISOString().replace(/[^0-9]/g, '')}.sqlite`
    const file = new File(directory, name)
    const bytes = withRollbackJournalHeader(getSqlite().serializeSync())
    file.write(bytes)
    validateContent(file.bytesSync())
    // Keep the latest ten automatic states; safety copies survive until explicitly removed.
    if (reason === 'evening') {
      const automatic = directory.list().filter(entry => entry instanceof File && entry.name.startsWith('evening-')).sort((a, b) => b.name.localeCompare(a.name))
      automatic.slice(10).forEach(entry => entry.delete())
    }
    return name
  },
  listLocal() {
    const directory = backupDirectory()
    if (!directory.exists) return []
    return directory.list().filter((entry): entry is File => entry instanceof File && backupName.test(entry.name))
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
      .map(file => ({ name: file.name, size: file.size, at: new Date(file.modificationTime ?? 0).toISOString() }))
  },
  readLocal(name: string) {
    if (!backupName.test(name)) throw new Error('Ungültige Sicherung.')
    const bytes = new File(backupDirectory(), name).bytesSync()
    validateContent(bytes)
    return bytes
  },
  async shareLocal(name: string) {
    this.readLocal(name)
    if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen nicht verfügbar.')
    await Sharing.shareAsync(new File(backupDirectory(), name).uri, { mimeType: 'application/x-sqlite3' })
  },
  restoreLocal(name: string) {
    const bytes = this.readLocal(name)
    this.saveLocal('before-restore')
    this.restoreValidatedBackup(bytes)
  },
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
