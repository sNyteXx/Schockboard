import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { commandResultsRequestSchema, deviceCommandsResponseSchema, enrollRequestSchema, PROTOCOL_VERSION } from '@/remote/protocol'

import { connectionRoutes, outgoingTransfer } from '../connections'
import { createDeviceAuth, type AppEnv } from '../auth'
import type { ServerConfig } from '../config'
import { rateLimit } from '../rate-limit'
import { SnapshotValidationError, type SnapshotManager } from '../snapshot'
import { DeviceLimitError, type Store } from '../store'

const SNAPSHOT_CONTENT_TYPES = new Set(['application/vnd.sqlite3', 'application/x-sqlite3', 'application/octet-stream'])

function tooLarge(message: string) {
  return (c: { json: (body: unknown, status: 413) => Response }) => c.json({ error: 'payload_too_large', message }, 413)
}

export function deviceRoutes(deps: { config: ServerConfig; store: Store; snapshots: SnapshotManager }) {
  const { config, store, snapshots } = deps
  const app = new Hono<AppEnv>()

  app.use('*', rateLimit({ limit: config.deviceRateLimitPerMinute, windowMs: 60_000 }))

  // Unauthenticated by design: every app enrolls itself on first start and
  // becomes a new, independent device (its own ledger), up to MAX_DEVICES
  // active devices. Strictly rate-limited per client IP (CF-Connecting-IP).
  app.post(
    '/enroll',
    rateLimit({ limit: config.enrollLimitPerMinute, windowMs: 60_000 }),
    rateLimit({ limit: config.enrollLimitPerDay, windowMs: 86_400_000 }),
    bodyLimit({ maxSize: 4 * 1024, onError: tooLarge('Anfrage zu groß.') }),
    async (c) => {
      const parsed = enrollRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)
      try {
        const device = store.enrollDevice(parsed.data.deviceName, config.maxDevices)
        return c.json({ token: device.token, deviceId: device.id })
      } catch (error) {
        if (error instanceof DeviceLimitError) {
          return c.json({ error: 'device_limit', message: `Höchstens ${error.max} aktive Geräte.` }, 403)
        }
        throw error
      }
    }
  )

  app.use('*', createDeviceAuth(store))

  app.route('/connect', connectionRoutes(deps, false))

  app.get('/ping', (c) => c.json({ ok: true as const }))

  app.get('/commands', (c) => {
    const body = deviceCommandsResponseSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      commands: outgoingTransfer(store, c.get('device').id) ? [] : store.fetchPendingForDevice(c.get('device').id, 100),
    })
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  app.post(
    '/commands/results',
    bodyLimit({ maxSize: 256 * 1024, onError: tooLarge('Ergebnisliste zu groß.') }),
    async (c) => {
      let json: unknown
      try {
        json = await c.req.json()
      } catch {
        return c.json({ error: 'invalid_json' }, 400)
      }
      const parsed = commandResultsRequestSchema.safeParse(json)
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 10) }, 400)
      }
      const { accepted, ignored } = store.applyResults(c.get('device').id, parsed.data.results)
      return c.json({ ok: true as const, accepted, ignored })
    }
  )

  app.put(
    '/snapshot',
    bodyLimit({
      maxSize: config.maxSnapshotBytes,
      onError: tooLarge(`Snapshot zu groß (max. ${Math.round(config.maxSnapshotBytes / 1024 / 1024)} MB).`),
    }),
    async (c) => {
      const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!SNAPSHOT_CONTENT_TYPES.has(contentType)) {
        return c.json({ error: 'unsupported_media_type', message: 'Erwartet application/vnd.sqlite3.' }, 415)
      }

      const schemaHeader = c.req.header('x-schockboard-schema')
      const schemaVersion = schemaHeader && /^\d{1,6}$/.test(schemaHeader) ? Number(schemaHeader) : null
      const createdHeader = c.req.header('x-snapshot-created-at')
      const createdAt = createdHeader && !Number.isNaN(Date.parse(createdHeader)) ? new Date(createdHeader).toISOString() : null

      const bytes = new Uint8Array(await c.req.arrayBuffer())
      try {
        const deviceId = c.get('device').id
        if (outgoingTransfer(store, deviceId)) return c.json({ error: 'transfer_locked', message: 'Quellgerät für den Umzug gesperrt.' }, 409)
        const info = snapshots.install(deviceId, bytes, config.maxSnapshotBytes)
        const receivedAt = store.recordSnapshot(deviceId, {
          createdAt,
          schemaVersion: schemaVersion ?? info.schemaVersion,
          sizeBytes: bytes.length,
        })
        return c.json({ ok: true as const, receivedAt, sizeBytes: bytes.length, schemaVersion: schemaVersion ?? info.schemaVersion })
      } catch (error) {
        if (error instanceof SnapshotValidationError) {
          return c.json({ error: 'invalid_snapshot', message: error.message }, error.status)
        }
        throw error
      }
    }
  )

  return app
}
