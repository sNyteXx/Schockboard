import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import {
  getAppSettings,
  getCashboxSummary,
  getDashboardSnapshot,
  getDebtSummaries,
  getHistoryEntries,
  getOpenSessionOverview,
  getSessionDetail,
  listPlayers,
  listSessionOverviews,
} from '@/db/queries'
import { formatCurrency } from '@/domain/format'
import type { HistoryEntry } from '@/domain/types'
import { COMMAND_TYPES, parseCommandPayload, type CommandType } from '@/remote/protocol'

import { requireAdmin, type AppEnv } from '../auth'
import type { ServerConfig } from '../config'
import type { SnapshotManager } from '../snapshot'
import { sqliteGet } from '../snapshot-client'
import { DeviceLimitError, type DeviceRow, type Store } from '../store'
import { ENTRY_TABLES, entryKindOf, entryNotes, getCashboxChart, getEveningsChart, getPlayersChart, type EntryKind } from '../charts'

const HISTORY_KINDS = ['all', 'loss', 'beerround', 'absence', 'payment', 'correction', 'withdrawal', 'audit'] as const

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

/**
 * Cash the web may still take out: the snapshot's cash on hand minus
 * withdrawals that are already queued (but not applied) for this device.
 */
function availableCash(pending: ReturnType<Store['listPendingCommands']>) {
  const queued = pending
    .filter((command) => command.type === 'cashbox.withdraw')
    .reduce((sum, command) => sum + Number(command.payload.amountCents ?? 0), 0)
  return getCashboxSummary().cashOnHandCents - queued
}

function cashLimitMessage(available: number) {
  return available > 0
    ? `In der Kasse sind laut letztem Datenstand nur ${formatCurrency(available)} (abzüglich beauftragter Entnahmen) – mehr kann nicht entnommen werden.`
    : 'Die Kasse ist laut letztem Datenstand leer (abzüglich beauftragter Entnahmen) – keine Entnahme möglich.'
}

/** Plausibility checks against the latest snapshot. The device re-validates when applying. */
function checkAgainstSnapshot(type: CommandType, payload: Record<string, unknown>, store: Store, deviceId: string) {
  const pending = () => store.listPendingCommands(deviceId)
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
      const queued = pending()
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
      if (pendingDeleteOf('loss', String(payload.entryId), pending())) {
        throw new CommandCheckError('Für diesen Eintrag ist bereits eine Löschung beauftragt.')
      }
      return
    }
    case 'entry.delete': {
      const kind = payload.kind as EntryKind
      requireEntry(kind, String(payload.entryId))
      if (pendingDeleteOf(kind, String(payload.entryId), pending())) {
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
        if (kind === 'withdrawal' && payload.amountCents <= 0) throw new CommandCheckError('Entnahme muss größer 0 sein.')
        if (kind !== 'correction' && payload.amountCents < 0) throw new CommandCheckError('Betrag darf nicht negativ sein.')
        if (kind === 'withdrawal') {
          const current = sqliteGet<{ amount_cents: number }>('SELECT amount_cents FROM cashbox_withdrawals WHERE id = $id', {
            $id: String(payload.entryId),
          })
          const increase = payload.amountCents - (current?.amount_cents ?? 0)
          const available = availableCash(pending())
          if (increase > 0 && increase > available) throw new CommandCheckError(cashLimitMessage(available))
        }
      }
      if (kind === 'correction' && payload.note !== undefined && !payload.note) {
        throw new CommandCheckError('Korrekturen brauchen einen Grund.')
      }
      if (kind === 'withdrawal' && payload.note !== undefined && !payload.note) {
        throw new CommandCheckError('Entnahmen brauchen einen Verwendungszweck.')
      }
      if (pendingDeleteOf(kind, String(payload.entryId), pending())) {
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
      const queued = pending()
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
    case 'cashbox.withdraw': {
      const amount = Number(payload.amountCents)
      if (!Number.isInteger(amount) || amount <= 0) throw new CommandCheckError('Entnahme muss größer 0 sein.')
      if (typeof payload.note !== 'string' || !payload.note.trim()) {
        throw new CommandCheckError('Bitte angeben, wofür das Geld entnommen wird.')
      }
      const available = availableCash(pending())
      if (amount > available) throw new CommandCheckError(cashLimitMessage(available))
      return
    }
    case 'session.delete': {
      if (!sessionRow(String(payload.sessionId))) throw new CommandCheckError('Spielabend existiert nicht (im letzten Datenstand).')
      const duplicate = pending()
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
function pendingDeleteOf(kind: EntryKind, entryId: string, pending: ReturnType<Store['listPendingCommands']>) {
  return pending.some(
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

const DEVICE_HEADER = 'x-schockboard-device'

const labelSchema = z.object({ label: z.string().trim().min(1).max(60) })
const revokeSchema = z.object({ replacedBy: z.string().min(1).max(80).optional() }).optional()

type DeviceChoice = { device: DeviceRow } | { error: 'device_not_found' } | { device: null }

export function adminRoutes(deps: { config: ServerConfig; store: Store; snapshots: SnapshotManager }) {
  const { config, store, snapshots } = deps
  const app = new Hono<AppEnv>()

  /**
   * Device the request is about: `?device=<id>` or `X-Schockboard-Device`,
   * else the first active device. Unknown or blocked ids are a 404.
   */
  function chooseDevice(c: Context<AppEnv>): DeviceChoice {
    const requested = (c.req.query('device') ?? c.req.header(DEVICE_HEADER) ?? '').trim()
    if (!requested) return { device: store.getDefaultDevice() }
    const device = store.getDevice(requested)
    if (!device || device.revokedAt) return { error: 'device_not_found' }
    return { device }
  }

  const deviceNotFound = (c: Context) => c.json({ error: 'device_not_found', message: 'Gerät unbekannt oder gesperrt.' }, 404)

  /** Resolves the device or answers 404/409 itself. */
  function requireDevice(c: Context<AppEnv>): DeviceRow | Response {
    const choice = chooseDevice(c)
    if ('error' in choice) return deviceNotFound(c)
    if (!choice.device) return c.json({ error: 'no_snapshot', message: 'Noch kein Gerät verbunden.' }, 409)
    return choice.device
  }

  app.use('*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }))
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/me', (c) => c.json({ email: c.get('adminEmail'), role: c.get('role'), devNoAuth: config.devNoAuth }))

  // Device management is admin-only; managers handle data and overrides (and may list devices).
  app.use('/device/*', requireAdmin)
  app.use('/devices/*', async (c, next) => (c.req.method === 'GET' ? next() : requireAdmin(c, next)))

  app.get('/status', (c) => {
    const choice = chooseDevice(c)
    if ('error' in choice) return deviceNotFound(c)
    const device = choice.device
    const snapshot = device ? store.getSnapshotMeta(device.id) : null
    const devices = store.listDevices()
    return c.json({
      paired: device !== null,
      deviceId: device?.id ?? null,
      label: device?.label ?? null,
      /** Legacy: 'app: <enrolled name>'. */
      deviceLabel: device?.pairedBy ?? null,
      deviceName: device?.deviceName ?? null,
      pairedAt: device?.pairedAt ?? null,
      lastSeenAt: device?.lastSeenAt ?? null,
      lastSnapshotAt: snapshot?.receivedAt ?? null,
      snapshotCreatedAt: snapshot?.createdAt ?? null,
      schemaVersion: snapshot?.schemaVersion ?? null,
      snapshotSizeBytes: snapshot?.sizeBytes ?? null,
      // Only for a snapshot migrated from the single-device layout that another (old) device uploaded.
      snapshotFromPreviousDevice: Boolean(device && snapshot?.deviceId && snapshot.deviceId !== device.id),
      pendingCommands: device ? store.countPendingCommands(device.id) : 0,
      publicOrigin: config.publicOrigin,
      maxDevices: config.maxDevices,
      activeDevices: devices.filter((entry) => entry.status === 'active').length,
      devices,
    })
  })

  // ---- device management -------------------------------------------------

  app.get('/devices', (c) => c.json(store.listDevices()))

  /** Kasse/offen and the running evening of every active device with a snapshot (status strip). */
  app.get('/devices/cashbox', (c) =>
    c.json(
      store.listActiveDevices().map((device) => {
        if (!snapshots.has(device.id)) return { deviceId: device.id, label: device.label, cashbox: null, cashboxLabel: null, openSession: null }
        return snapshots.withDevice(device.id, () => ({
          deviceId: device.id,
          label: device.label,
          cashbox: getCashboxSummary(),
          cashboxLabel: getAppSettings().cashboxLabel,
          openSession: getOpenSessionOverview(),
        }))
      })
    )
  )

  app.patch('/devices/:id', async (c) => {
    const parsed = labelSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_request', message: 'Name: 1–60 Zeichen.' }, 400)
    if (!store.renameDevice(c.req.param('id'), parsed.data.label)) return c.json({ error: 'not_found' }, 404)
    return c.json(store.listDevices().find((device) => device.id === c.req.param('id')))
  })

  /**
   * Blocks a device: token invalid, pending commands cancelled. With
   * `replacedBy`, that (active) device takes over the blocked one's name.
   * A blocked app may enroll itself again – as a new device.
   */
  app.post('/devices/:id/revoke', async (c) => {
    const id = c.req.param('id')
    const body = revokeSchema.safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) return c.json({ error: 'invalid_request' }, 400)
    const device = store.getDevice(id)
    if (!device) return c.json({ error: 'not_found' }, 404)
    const replacedBy = body.data?.replacedBy
    if (replacedBy) {
      const successor = store.getDevice(replacedBy)
      if (!successor || successor.revokedAt || successor.id === id) {
        return c.json({ error: 'invalid_request', message: 'Ersatzgerät unbekannt oder gesperrt.' }, 400)
      }
    }
    const result = store.revokeDevice(id, replacedBy ? 'Gerät ersetzt' : 'Gerät gesperrt')
    if (replacedBy && result.revoked && device.label) store.renameDevice(replacedBy, device.label)
    return c.json({ ok: true as const, ...result })
  })

  /** Removes a blocked device from the list incl. its snapshot and command history. */
  app.delete('/devices/:id', (c) => {
    const id = c.req.param('id')
    const device = store.getDevice(id)
    if (!device) return c.json({ error: 'not_found' }, 404)
    if (!device.revokedAt) return c.json({ error: 'device_active', message: 'Nur gesperrte Geräte können entfernt werden.' }, 409)
    store.deleteDevice(id)
    snapshots.remove(id)
    return c.json({ ok: true as const })
  })

  // Manual fallback (tests, scripted setups): adds a device; the app normally enrolls itself.
  app.post('/device/pair', (c) => {
    try {
      const { id, token, pairedAt } = store.addDevice({ pairedBy: c.get('adminEmail'), deviceName: 'Manuell gekoppelt', maxDevices: config.maxDevices })
      return c.json({ deviceId: id, token, pairedAt, server: config.publicOrigin })
    } catch (error) {
      if (error instanceof DeviceLimitError) return c.json({ error: 'device_limit', message: `Höchstens ${error.max} aktive Geräte.` }, 403)
      throw error
    }
  })

  /** Legacy: blocks the selected (default: first active) device. */
  app.post('/device/revoke', (c) => {
    const choice = chooseDevice(c)
    if ('error' in choice) return deviceNotFound(c)
    const result = choice.device ? store.revokeDevice(choice.device.id) : { revoked: false, cancelled: 0 }
    return c.json({ ok: true as const, ...result })
  })

  // ---- reads from the selected device's latest snapshot (the app's own queries) -----------

  /** Runs a synchronous read with the selected device's snapshot as the app database. */
  const read = <T>(handler: (c: Context<AppEnv>) => T) => (c: Context<AppEnv>) => {
    const device = requireDevice(c)
    if (device instanceof Response) return device
    if (!snapshots.has(device.id)) return noSnapshot(c)
    const result = snapshots.withDevice(device.id, () => handler(c))
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

  // ---- command queue (per device) -----------------------------------------

  /** `?device=all` lists every device's commands. */
  app.get('/commands', (c) => {
    if (c.req.query('device') === 'all') return c.json(store.listCommands(null))
    const device = requireDevice(c)
    if (device instanceof Response) return device.status === 409 ? c.json([]) : device
    return c.json(store.listCommands(device.id))
  })

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

    const device = requireDevice(c)
    if (device instanceof Response) return device
    if (!snapshots.has(device.id)) return noSnapshot(c)
    try {
      snapshots.withDevice(device.id, () => checkAgainstSnapshot(request.data.type, payload, store, device.id))
    } catch (error) {
      if (error instanceof CommandCheckError) {
        return c.json({ error: 'command_rejected', message: error.message }, 422)
      }
      throw error
    }

    const command = store.createCommand({ deviceId: device.id, type: request.data.type, payload, createdBy: c.get('adminEmail') })
    return c.json(command, 201)
  })

  /**
   * Clears the command history of the selected device (`?device=all`: of every
   * device): finished commands are deleted, pending ones stay.
   */
  app.delete('/commands', (c) => {
    if (c.req.query('device') === 'all') return c.json({ ok: true as const, deleted: store.deleteFinishedCommands(null) })
    const choice = chooseDevice(c)
    if ('error' in choice) return deviceNotFound(c)
    return c.json({ ok: true as const, deleted: choice.device ? store.deleteFinishedCommands(choice.device.id) : 0 })
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
