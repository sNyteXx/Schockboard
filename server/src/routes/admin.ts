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

import { requireAdmin, type AppEnv } from '../auth'
import type { ServerConfig } from '../config'
import { hasActiveDatabase, sqliteGet } from '../snapshot-client'
import type { Store } from '../store'
import { ENTRY_TABLES, entryKindOf, entryNotes, getCashboxChart, getEveningsChart, getPlayersChart, type EntryKind } from '../charts'

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
      // An override now: closed evenings are fine too, the device just deletes the entry.
      const session = sessionRow(String(payload.sessionId))
      if (!session) throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      const entry = sqliteGet<{ id: string }>(
        'SELECT id FROM loss_entries WHERE id = $id AND session_id = $sessionId AND player_id = $playerId',
        { $id: String(payload.entryId), $sessionId: session.id, $playerId: String(payload.playerId) }
      )
      if (!entry) throw new CommandCheckError('Eintrag existiert nicht (mehr) in diesem Spielabend.')
      if (pendingDeleteOf('loss', String(payload.entryId), store)) {
        throw new CommandCheckError('Für diesen Eintrag ist bereits eine Löschung beauftragt.')
      }
      return
    }
    case 'entry.delete': {
      const kind = payload.kind as EntryKind
      requireEntry(kind, String(payload.entryId))
      if (pendingDeleteOf(kind, String(payload.entryId), store)) {
        throw new CommandCheckError('Für diese Buchung ist bereits eine Löschung beauftragt.')
      }
      return
    }
    case 'entry.update': {
      const kind = payload.kind as EntryKind
      requireEntry(kind, String(payload.entryId))
      if (payload.amountCents === undefined && payload.note === undefined) {
        throw new CommandCheckError('Keine Änderung angegeben (Betrag oder Notiz).')
      }
      if (typeof payload.amountCents === 'number') {
        if (kind === 'correction' && payload.amountCents === 0) throw new CommandCheckError('Korrektur darf nicht 0 sein.')
        if (kind !== 'correction' && payload.amountCents < 0) throw new CommandCheckError('Betrag darf nicht negativ sein.')
      }
      if (kind === 'correction' && payload.note !== undefined && !payload.note) {
        throw new CommandCheckError('Korrekturen brauchen einen Grund.')
      }
      if (pendingDeleteOf(kind, String(payload.entryId), store)) {
        throw new CommandCheckError('Diese Buchung wird bereits gelöscht.')
      }
      return
    }
    case 'player.rename': {
      requirePlayer(payload.playerId)
      const name = String(payload.name).toLowerCase()
      const taken = sqliteGet<{ id: string }>('SELECT id FROM players WHERE lower(name) = $name AND id != $id LIMIT 1', {
        $name: name,
        $id: String(payload.playerId),
      })
      const queued = store
        .listPendingCommands()
        .some(
          (command) =>
            (command.type === 'player.create' || (command.type === 'player.rename' && command.payload.playerId !== payload.playerId)) &&
            String(command.payload.name).toLowerCase() === name
        )
      if (taken || queued) throw new CommandCheckError('Ein anderer Spieler heißt bereits so (oder ist so beauftragt).')
      return
    }
    case 'session.update': {
      if (!sessionRow(String(payload.sessionId))) throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      if (payload.title === undefined && payload.stakeCents === undefined) throw new CommandCheckError('Keine Änderung angegeben.')
      return
    }
    case 'audit.delete': {
      const auditIds = [...new Set(payload.auditIds as string[])]
      const params = Object.fromEntries(auditIds.map((auditId, index) => [`$a${index}`, auditId]))
      const found = sqliteGet<{ n: number }>(
        `SELECT COUNT(*) AS n FROM audit_events WHERE id IN (${auditIds.map((_, index) => `$a${index}`).join(', ')})`,
        params
      )
      if ((found?.n ?? 0) !== auditIds.length) {
        throw new CommandCheckError('Mindestens ein Protokolleintrag existiert nicht (mehr) im letzten Datenstand.')
      }
      return
    }
    case 'audit.purge': {
      const count = typeof payload.before === 'string'
        ? sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events WHERE created_at < $before', { $before: payload.before })
        : sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')
      if (!count?.n) throw new CommandCheckError('Keine passenden Protokolleinträge im letzten Datenstand.')
      return
    }
    case 'session.delete': {
      if (!sessionRow(String(payload.sessionId))) throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      const duplicate = store
        .listPendingCommands()
        .some((command) => command.type === 'session.delete' && command.payload.sessionId === payload.sessionId)
      if (duplicate) throw new CommandCheckError('Für diesen Abend ist bereits eine Löschung beauftragt.')
      return
    }
  }
}

function requireEntry(kind: EntryKind, entryId: string) {
  const entry = ENTRY_TABLES[kind] ? sqliteGet<{ id: string }>(`SELECT id FROM ${ENTRY_TABLES[kind].table} WHERE id = $id`, { $id: entryId }) : null
  if (!entry) throw new CommandCheckError('Buchung existiert nicht (mehr) im letzten Datenstand.')
}

/** A pending delete of the booking, via entry.delete or (for losses) loss.void. */
function pendingDeleteOf(kind: EntryKind, entryId: string, store: Store) {
  return store
    .listPendingCommands()
    .some(
      (command) =>
        command.payload.entryId === entryId &&
        ((command.type === 'entry.delete' && command.payload.kind === kind) || (kind === 'loss' && command.type === 'loss.void'))
    )
}

/** Adds the booking address (entry.* kind) and the raw note to history rows for the override UI. */
function withEntryRefs(entries: HistoryEntry[]) {
  const ids = new Map<EntryKind, string[]>()
  for (const entry of entries) {
    const kind = entryKindOf(entry.kind)
    if (kind) ids.set(kind, [...(ids.get(kind) ?? []), entry.id])
  }
  const notes = new Map([...ids].map(([kind, list]) => [kind, entryNotes(kind, list)]))
  return entries.map((entry) => {
    const entryKind = entryKindOf(entry.kind)
    return { ...entry, entryKind, note: entryKind ? (notes.get(entryKind)?.get(entry.id) ?? null) : null }
  })
}

export function adminRoutes(deps: { config: ServerConfig; store: Store }) {
  const { config, store } = deps
  const app = new Hono<AppEnv>()

  app.use('*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }))
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/me', (c) => c.json({ email: c.get('adminEmail'), role: c.get('role'), devNoAuth: config.devNoAuth }))

  // Device management is admin-only; managers handle data and overrides.
  app.use('/device/*', requireAdmin)

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

  app.get(
    '/dashboard',
    read(() => {
      const dashboard = getDashboardSnapshot()
      return { ...dashboard, recentHistory: withEntryRefs(dashboard.recentHistory) }
    })
  )
  app.get('/debts', read(() => getDebtSummaries()))
  app.get('/cashbox', read(() => getCashboxSummary()))
  app.get('/settings', read(() => getAppSettings()))
  app.get('/players', read(() => listPlayers()))
  app.get('/sessions', read(() => listSessionOverviews()))
  app.get(
    '/sessions/:id',
    read((c) => {
      const detail = getSessionDetail(c.req.param('id') ?? '')
      if (!detail) return c.json({ error: 'not_found' }, 404)
      return { ...detail, timeline: withEntryRefs(detail.timeline) }
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
      return withEntryRefs(entries.slice(0, limit ?? 500))
    })
  )

  // ---- chart read models (plain SQL on the snapshot) ---------------------

  app.get(
    '/charts/evenings',
    read((c) => {
      const season = c.req.query('season') ?? 'all'
      if (season !== 'all' && !/^\d{4}$/.test(season)) {
        return c.json({ error: 'invalid_query', message: 'season muss YYYY oder all sein.' }, 400)
      }
      return getEveningsChart(season)
    })
  )
  app.get('/charts/players', read(() => getPlayersChart()))
  app.get('/charts/cashbox', read(() => getCashboxChart()))

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

  /** Clears the command history: every finished command is deleted, pending ones stay. */
  app.delete('/commands', (c) => c.json({ ok: true as const, deleted: store.deleteFinishedCommands() }))

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
