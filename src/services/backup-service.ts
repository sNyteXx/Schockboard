import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { backupDatabaseSync, deserializeDatabaseSync } from 'expo-sqlite'

import { ensureDatabaseReady, resetBootstrapFlag } from '@/db/bootstrap'
import { getSqlite } from '@/db/client'
import { validateSqliteBackupBytes } from '@/domain/backup-validation'

const CURRENT_MIGRATION = 6

function validateContent(bytes: Uint8Array) {
  validateSqliteBackupBytes(bytes)
  const source = deserializeDatabaseSync(bytes)
  try {
    const integrity = source.getFirstSync<{ integrity_check: string }>('PRAGMA integrity_check')
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('SQLite-Integritätsprüfung fehlgeschlagen.')
    }

    const required = ['schema_migrations', 'players', 'sessions', 'loss_entries', 'payments', 'app_settings']
    const existing = new Set(source.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name))
    if (required.some((name) => !existing.has(name))) {
      throw new Error('Die Sicherung gehört nicht zu Schockboard.')
    }

    const version = source.getFirstSync<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')?.version ?? 0
    if (version < 1 || version > CURRENT_MIGRATION) {
      throw new Error('Diese Sicherungsversion ist nicht kompatibel.')
    }
  } finally {
    source.closeSync()
  }
}

export const BackupService = {
  async shareBackup() {
    ensureDatabaseReady()
    if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const destination = new File(Paths.cache, `schockboard-backup-${timestamp}.sqlite`)
    destination.create({ overwrite: true })
    destination.write(getSqlite().serializeSync())
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
    const destination = getSqlite()
    const previousState = destination.serializeSync()
    let replacement = deserializeDatabaseSync(bytes)

    try {
      backupDatabaseSync({ sourceDatabase: replacement, destDatabase: destination })
      resetBootstrapFlag()
      ensureDatabaseReady() // forward-only migration to the current schema
    } catch (error) {
      // Best-effort rollback from an in-memory snapshot of the old database.
      const original = deserializeDatabaseSync(previousState)
      try {
        backupDatabaseSync({ sourceDatabase: original, destDatabase: destination })
        resetBootstrapFlag()
        ensureDatabaseReady()
      } finally {
        original.closeSync()
      }
      throw error
    } finally {
      replacement.closeSync()
    }
  },
}
