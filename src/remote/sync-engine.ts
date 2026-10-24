import { fetch } from 'expo/fetch'

import { LATEST_SCHEMA_VERSION, ensureDatabaseReady } from '@/db/bootstrap'
import { getSqlite, sqliteGet } from '@/db/client'
import { withRollbackJournalHeader } from '@/domain/backup-validation'
import { applyRemoteCommands, getUnreportedResults, markResultsReported } from '@/remote/executor'
import { RemoteConfigStore, getDeviceName, getRemoteServer, type RemoteConfig } from '@/remote/config'
import { deviceCommandsResponseSchema, enrollResponseSchema } from '@/remote/protocol'
import { AuthService } from '@/services/auth-service'

const REQUEST_TIMEOUT_MS = 20_000
// The snapshot is the whole database: allow ~1 MB per 10 s on slow networks.
const uploadTimeoutMs = (bytes: number) => Math.max(60_000, Math.ceil(bytes / 100_000) * 1_000)
// After failures wait 1, 2, 4 … up to 15 minutes before the next attempt.
const MAX_BACKOFF_MS = 15 * 60_000
// While the server refuses new devices, ask again at most this often.
const ENROLL_RETRY_MS = 15 * 60_000

class DeviceRejectedError extends Error {}

export type SyncOutcome =
  | { status: 'not-paired' }
  | { status: 'ok'; applied: number; uploaded: boolean; at: string }
  | { status: 'error'; message: string; at: string }

let running: Promise<SyncOutcome> | null = null
let lastOutcome: SyncOutcome | null = null
const listeners = new Set<(outcome: SyncOutcome) => void>()

let failures = 0
let nextAttemptAt = 0
let tokenWasRejected = false

async function request(
  config: RemoteConfig,
  path: string,
  init: { method?: string; body?: string | ArrayBuffer; headers?: Record<string, string>; timeoutMs?: number } = {}
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.server}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}), ...init.headers },
      signal: controller.signal,
    })
    if (response.status === 401) throw new DeviceRejectedError('Token vom Server abgelehnt.')
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

/** An empty database (fresh install or "App zurücksetzen") must never replace the server copy. */
function hasAnyData() {
  const row = sqliteGet<{ n: number }>('SELECT (SELECT COUNT(*) FROM players) + (SELECT COUNT(*) FROM sessions) AS n')
  return (row?.n ?? 0) > 0
}

async function uploadSnapshotIfChanged(config: RemoteConfig) {
  if (!hasAnyData()) return false
  const fingerprint = localFingerprint()
  if (fingerprint === (await RemoteConfigStore.getUploadedFingerprint())) return false

  // withRollbackJournalHeader returns a fresh, offset-free copy, so its
  // buffer is exactly the image.
  const image = withRollbackJournalHeader(getSqlite().serializeSync()).buffer as ArrayBuffer
  await request(config, '/api/device/snapshot', {
    method: 'PUT',
    body: image,
    timeoutMs: uploadTimeoutMs(image.byteLength),
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'X-Schockboard-Schema': String(LATEST_SCHEMA_VERSION),
      'X-Snapshot-Created-At': new Date().toISOString(),
    },
  })
  await RemoteConfigStore.setUploadedFingerprint(fingerprint)
  return true
}

/**
 * No pairing UI: the app registers itself with the built-in server. The
 * server only accepts that for its very first device or inside a short
 * window opened by the admin, so a stranger's install is turned away.
 */
async function ensureEnrolled(): Promise<RemoteConfig | null> {
  const existing = await RemoteConfigStore.get()
  if (existing) return existing

  const now = Date.now()
  if (now - (await RemoteConfigStore.getLastEnrollAttempt()) < ENROLL_RETRY_MS) return null
  await RemoteConfigStore.setLastEnrollAttempt(now)

  const server = getRemoteServer()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${server}/api/device/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: getDeviceName() }),
      signal: controller.signal,
    })
    if (response.status === 403) return null // enrollment closed: stay local-only
    if (!response.ok) throw new Error(`Anmeldung am Server fehlgeschlagen (${response.status}).`)
    const { token } = enrollResponseSchema.parse(await response.json())
    const config = { server, token, pairedAt: new Date().toISOString() }
    await RemoteConfigStore.set(config)
    return config
  } finally {
    clearTimeout(timer)
  }
}

async function runSync(): Promise<SyncOutcome> {
  const config = await ensureEnrolled()
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
    if (!running && Date.now() < nextAttemptAt && lastOutcome) return Promise.resolve(lastOutcome)
    if (!running) {
      running = runSync()
        .catch(async (error): Promise<SyncOutcome> => {
          // Revoked or replaced on the server: forget the token so the app
          // can enroll again once the admin allows a new device.
          tokenWasRejected = error instanceof DeviceRejectedError
          if (tokenWasRejected) await RemoteConfigStore.clear()
          return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Sync fehlgeschlagen.',
            at: new Date().toISOString(),
          }
        })
        .then((outcome) => {
          // A rejected token is not a network problem: re-enrollment has its own throttle.
          failures = outcome.status === 'error' && !tokenWasRejected ? failures + 1 : 0
          tokenWasRejected = false
          nextAttemptAt = failures ? Date.now() + Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (failures - 1)) : 0
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
}
