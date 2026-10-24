import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import {
  getAppSettings,
  getCashboxSummary,
  getDashboardSnapshot,
  getDebtSummaries,
  getHistoryEntries,
  getSessionDetail,
  listPlayers,
  listSessionOverviews,
} from '@/db/queries'
import type { HistoryEntry } from '@/domain/types'
import { COMMAND_TYPES, parseCommandPayload, type CommandType } from '@/remote/protocol'

import type { AppEnv } from '../auth'
import type { ServerConfig } from '../config'
import { hasActiveDatabase, sqliteGet } from '../snapshot-client'
import type { Store } from '../store'

const HISTORY_KINDS = ['all', 'loss', 'beerround', 'absence', 'payment', 'correction', 'audit'] as const

const commandRequestSchema = z.object({
  type: z.enum(COMMAND_TYPES as [CommandType, ...CommandType[]]),
  payload: z.unknown(),
})

const historyQuerySchema = z.object({
  playerId: z.string().min(1).max(80).optional(),
  sessionId: z.string().min(1).max(80).optional(),
  kind: z.enum(HISTORY_KINDS).optional(),
  includeAudit: z.enum(['0', '1', 'true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
})

class CommandCheckError extends Error {}

function noSnapshot(c: Context) {
  return c.json({ error: 'no_snapshot', message: 'Noch kein Datenstand vom Gerät empfangen.' }, 409)
}

function playerExists(playerId: string) {
  return sqliteGet<{ id: string; is_archived: number }>('SELECT id, is_archived FROM players WHERE id = $id', { $id: playerId })
}

function sessionRow(sessionId: string) {
  return sqliteGet<{ id: string; status: string }>('SELECT id, status FROM sessions WHERE id = $id', { $id: sessionId })
}

/** Plausibility checks against the latest snapshot. The device re-validates when applying. */
function checkAgainstSnapshot(type: CommandType, payload: Record<string, unknown>, store: Store) {
  const requirePlayer = (playerId: unknown) => {
    if (typeof playerId !== 'string' || !playerExists(playerId)) {
      throw new CommandCheckError('Spieler existiert nicht (im letzten Datenstand).')
    }
  }

  switch (type) {
    case 'correction.record': {
      requirePlayer(payload.playerId)
      if (typeof payload.sessionId === 'string' && !sessionRow(payload.sessionId)) {
        throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      }
      return
    }
    case 'payment.record':
      requirePlayer(payload.playerId)
      return
    case 'player.update': {
      requirePlayer(payload.playerId)
      if (payload.isCore === undefined && payload.isArchived === undefined) {
        throw new CommandCheckError('Keine Änderung angegeben.')
      }
      return
    }
    case 'player.create': {
      const name = String(payload.name).toLowerCase()
      const existing = sqliteGet<{ id: string }>('SELECT id FROM players WHERE lower(name) = $name LIMIT 1', { $name: name })
      const queued = store
        .listPendingCommands()
        .some((command) => command.type === 'player.create' && String(command.payload.name).toLowerCase() === name)
      if (existing || queued) {
        throw new CommandCheckError('Ein Spieler mit diesem Namen existiert bereits oder ist schon beauftragt.')
      }
      return
    }
    case 'settings.update':
      return
    case 'loss.void': {
      const session = sessionRow(String(payload.sessionId))
      if (!session) throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      if (session.status !== 'open') throw new CommandCheckError('Nur Einträge offener Spielabende können storniert werden.')
      const entry = sqliteGet<{ id: string }>(
        'SELECT id FROM loss_entries WHERE id = $id AND session_id = $sessionId AND player_id = $playerId',
        { $id: String(payload.entryId), $sessionId: session.id, $playerId: String(payload.playerId) }
      )
      if (!entry) throw new CommandCheckError('Eintrag existiert nicht (mehr) in diesem Spielabend.')
      const duplicate = store
        .listPendingCommands()
        .some((command) => command.type === 'loss.void' && command.payload.entryId === payload.entryId)
      if (duplicate) throw new CommandCheckError('Für diesen Eintrag ist bereits eine Stornierung beauftragt.')
      return
    }
  }
}

export function adminRoutes(deps: { config: ServerConfig; store: Store }) {
  const { config, store } = deps
  const app = new Hono<AppEnv>()

  app.use('*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }))
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/me', (c) => c.json({ email: c.get('adminEmail'), devNoAuth: config.devNoAuth }))

  app.get('/status', (c) => {
    const device = store.getActiveDevice()
    const snapshot = store.getSnapshotMeta()
    return c.json({
      paired: device !== null,
      pairedAt: device?.pairedAt ?? null,
      deviceLabel: device?.pairedBy ?? null,
      enrollmentOpenUntil: store.enrollmentOpenUntil(),
      lastSeenAt: device?.lastSeenAt ?? null,
      lastSnapshotAt: snapshot?.receivedAt ?? null,
      snapshotCreatedAt: snapshot?.createdAt ?? null,
      schemaVersion: snapshot?.schemaVersion ?? null,
      snapshotSizeBytes: snapshot?.sizeBytes ?? null,
      pendingCommands: store.countPendingCommands(),
      publicOrigin: config.publicOrigin,
    })
  })

  // Manual fallback (tests, scripted setups); the app normally enrolls itself.
  app.post('/device/pair', (c) => {
    const { token, pairedAt } = store.pairDevice(c.get('adminEmail'))
    return c.json({ token, pairedAt, server: config.publicOrigin })
  })

  /** Lets a new or reinstalled app enroll itself within the next minutes. */
  app.post('/device/enrollment', (c) => c.json({ enrollmentOpenUntil: store.openEnrollment(10) }))

  app.delete('/device/enrollment', (c) => {
    store.closeEnrollment()
    return c.json({ ok: true as const })
  })

  app.post('/device/revoke', (c) => {
    store.revokeActiveDevice()
    return c.json({ ok: true as const })
  })

  // ---- reads from the latest snapshot (the app's own queries) -----------

  const read = <T>(handler: (c: Context<AppEnv>) => T) => (c: Context<AppEnv>) => {
    if (!hasActiveDatabase()) return noSnapshot(c)
    const result = handler(c)
    if (result instanceof Response) return result
    return c.json(result as object)
  }

  app.get('/dashboard', read(() => getDashboardSnapshot()))
  app.get('/debts', read(() => getDebtSummaries()))
  app.get('/cashbox', read(() => getCashboxSummary()))
  app.get('/settings', read(() => getAppSettings()))
  app.get('/players', read(() => listPlayers()))
  app.get('/sessions', read(() => listSessionOverviews()))
  app.get(
    '/sessions/:id',
    read((c) => {
      const detail = getSessionDetail(c.req.param('id') ?? '')
      return detail ?? c.json({ error: 'not_found' }, 404)
    })
  )
  app.get(
    '/history',
    read((c) => {
      const parsed = historyQuerySchema.safeParse(c.req.query())
      if (!parsed.success) return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
      const { playerId, sessionId, kind, includeAudit, limit } = parsed.data
      const entries: HistoryEntry[] = getHistoryEntries({
        playerId,
        sessionId,
        kind,
        includeAudit: includeAudit === '1' || includeAudit === 'true',
      })
      return entries.slice(0, limit ?? 500)
    })
  )

  // ---- command queue -----------------------------------------------------

  app.get('/commands', (c) => c.json(store.listCommands()))

  app.post('/commands', async (c) => {
    let json: unknown
    try {
      json = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const request = commandRequestSchema.safeParse(json)
    if (!request.success) {
      return c.json({ error: 'invalid_command', message: 'Unbekannter Auftragstyp.', issues: request.error.issues }, 400)
    }

    let payload: Record<string, unknown>
    try {
      payload = parseCommandPayload(request.data.type, request.data.payload) as Record<string, unknown>
    } catch (error) {
      const issues = error instanceof z.ZodError ? error.issues : []
      return c.json(
        { error: 'invalid_payload', message: issues[0]?.message ?? 'Ungültige Angaben.', issues },
        400
      )
    }

    if (!hasActiveDatabase()) return noSnapshot(c)
    try {
      checkAgainstSnapshot(request.data.type, payload, store)
    } catch (error) {
      if (error instanceof CommandCheckError) {
        return c.json({ error: 'command_rejected', message: error.message }, 422)
      }
      throw error
    }

    const command = store.createCommand({ type: request.data.type, payload, createdBy: c.get('adminEmail') })
    return c.json(command, 201)
  })

  app.delete('/commands/:id', (c) => {
    const id = c.req.param('id')
    const existing = store.getCommand(id)
    if (!existing) return c.json({ error: 'not_found' }, 404)
    if (!store.cancelCommand(id)) {
      return c.json({ error: 'not_pending', message: 'Nur ausstehende Aufträge können storniert werden.' }, 409)
    }
    return c.json(store.getCommand(id))
  })

  return app
}
