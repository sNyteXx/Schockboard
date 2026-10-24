import { fetch } from 'expo/fetch'

import { LATEST_SCHEMA_VERSION, ensureDatabaseReady } from '@/db/bootstrap'
import { getSqlite, sqliteGet } from '@/db/client'
import { withRollbackJournalHeader } from '@/domain/backup-validation'
import { applyRemoteCommands, getUnreportedResults, markResultsReported } from '@/remote/executor'
import { RemoteConfigStore, type RemoteConfig } from '@/remote/config'
import { deviceCommandsResponseSchema } from '@/remote/protocol'
import { AuthService } from '@/services/auth-service'

const REQUEST_TIMEOUT_MS = 20_000

export type SyncOutcome =
  | { status: 'not-paired' }
  | { status: 'ok'; applied: number; uploaded: boolean; at: string }
  | { status: 'error'; message: string; at: string }

let running: Promise<SyncOutcome> | null = null
let lastOutcome: SyncOutcome | null = null
const listeners = new Set<(outcome: SyncOutcome) => void>()

async function request(config: RemoteConfig, path: string, init: { method?: string; body?: string | ArrayBuffer; headers?: Record<string, string> } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.server}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { Authorization: `Bearer ${config.token}`, ...init.headers },
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Gerät ist nicht mehr gekoppelt (Token abgelehnt).')
    }
    if (!response.ok) throw new Error(`Server antwortet mit ${response.status}.`)
    return response
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cheap change marker: practically every write leaves an audit event, and the
 * remaining ones bump an updated_at column.
 */
function localFingerprint() {
  const row = sqliteGet<{ fp: string }>(`
    SELECT
      (SELECT COUNT(*) || '/' || IFNULL(MAX(created_at), '') FROM audit_events) || '|' ||
      (SELECT IFNULL(MAX(updated_at), '') FROM players) || '|' ||
      (SELECT IFNULL(MAX(updated_at), '') FROM sessions) || '|' ||
      (SELECT IFNULL(MAX(updated_at), '') FROM app_settings) || '|' ||
      (SELECT COUNT(*) FROM loss_entries) || '/' || (SELECT COUNT(*) FROM payments) || '/' || (SELECT COUNT(*) FROM corrections)
      AS fp
  `)
  return row?.fp ?? ''
}

async function uploadSnapshotIfChanged(config: RemoteConfig) {
  const fingerprint = localFingerprint()
  if (fingerprint === (await RemoteConfigStore.getUploadedFingerprint())) return false

  // withRollbackJournalHeader returns a fresh, offset-free copy, so its
  // buffer is exactly the image.
  const image = withRollbackJournalHeader(getSqlite().serializeSync()).buffer as ArrayBuffer
  await request(config, '/api/device/snapshot', {
    method: 'PUT',
    body: image,
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'X-Schockboard-Schema': String(LATEST_SCHEMA_VERSION),
      'X-Snapshot-Created-At': new Date().toISOString(),
    },
  })
  await RemoteConfigStore.setUploadedFingerprint(fingerprint)
  return true
}

async function runSync(): Promise<SyncOutcome> {
  const config = await RemoteConfigStore.get()
  if (!config) return { status: 'not-paired' }

  ensureDatabaseReady()
  const account = await AuthService.ensureLocalAccount()
  if (!account) throw new Error('Kein lokales Konto vorhanden.')
  const actor = { accountId: account.id, username: account.username }

  // 1. pull and apply queued web commands
  const commandsResponse = await request(config, '/api/device/commands')
  const { commands } = deviceCommandsResponseSchema.parse(await commandsResponse.json())
  const applied = applyRemoteCommands(commands, actor)

  // 2. acknowledge outcomes (also retries results a previous run could not send)
  const results = getUnreportedResults()
  if (results.length > 0) {
    await request(config, '/api/device/commands/results', {
      method: 'POST',
      body: JSON.stringify({ results }),
      headers: { 'Content-Type': 'application/json' },
    })
    markResultsReported(results.map((result) => result.id))
  }

  // 3. publish the resulting state
  const uploaded = await uploadSnapshotIfChanged(config)
  return { status: 'ok', applied, uploaded, at: new Date().toISOString() }
}

export const SyncEngine = {
  /** Runs one sync round; concurrent callers share the in-flight round. */
  syncNow(): Promise<SyncOutcome> {
    if (!running) {
      running = runSync()
        .catch((error): SyncOutcome => ({
          status: 'error',
          message: error instanceof Error ? error.message : 'Sync fehlgeschlagen.',
          at: new Date().toISOString(),
        }))
        .then((outcome) => {
          lastOutcome = outcome
          for (const listener of listeners) listener(outcome)
          return outcome
        })
        .finally(() => {
          running = null
        })
    }
    return running
  },
  getLastOutcome() {
    return lastOutcome
  },
  subscribe(listener: (outcome: SyncOutcome) => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** Checks a pairing link against the server before storing it. */
  async pair(server: string, token: string) {
    const config = { server, token, pairedAt: new Date().toISOString() }
    await request(config, '/api/device/ping')
    await RemoteConfigStore.set(config)
    return this.syncNow()
  },
  async unpair() {
    await RemoteConfigStore.clear()
    lastOutcome = { status: 'not-paired' }
  },
}
