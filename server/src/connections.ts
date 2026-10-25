import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import QRCode from 'qrcode'

import { getDebtSummaries, getOpenSessionOverview, getSessionDetail } from '@/db/queries'
import { getStatsRawData } from '@/db/stats-queries'
import { buildAchievements } from '@/domain/achievements'
import { claimSchema, inviteSchema, memberRoleSchema, roundCommandSchema, type ConnectionState, type TransferState } from '@/remote/collaboration-protocol'
import { parseCommandPayload } from '@/remote/protocol'
import { requireAdmin, type AppEnv } from './auth'
import type { ServerConfig } from './config'
import type { SnapshotManager } from './snapshot'
import type { Store } from './store'
import { checkAgainstSnapshot } from './routes/admin'

export function initializeConnections(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS round_members (guest_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer');
    CREATE INDEX IF NOT EXISTS round_members_host ON round_members(host_id);
    CREATE TABLE IF NOT EXISTS round_invites (id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, host_id TEXT NOT NULL,
      purpose TEXT NOT NULL, expires_at TEXT NOT NULL, guest_id TEXT, transfer_id TEXT);
    CREATE TABLE IF NOT EXISTS device_transfers (id TEXT PRIMARY KEY, host_id TEXT NOT NULL, guest_id TEXT,
      status TEXT NOT NULL, expires_at TEXT NOT NULL, digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transfer_requests (host_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS round_requests (guest_id TEXT NOT NULL, request_id TEXT NOT NULL, command_id TEXT NOT NULL,
      request_json TEXT NOT NULL, PRIMARY KEY(guest_id, request_id));
    CREATE TABLE IF NOT EXISTS admin_requests (actor TEXT NOT NULL, request_id TEXT NOT NULL, command_id TEXT NOT NULL,
      request_json TEXT NOT NULL, PRIMARY KEY(actor, request_id));
  `)
}

type Transfer = TransferState & { digest: string }
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

export function outgoingTransfer(store: Store, host: string): Transfer | null {
  return store.db.prepare("SELECT id, host_id AS hostId, guest_id AS guestId, status, expires_at AS expiresAt, digest FROM device_transfers WHERE host_id = ? AND status != 'cancelled' ORDER BY rowid DESC LIMIT 1").get(host) as Transfer | undefined ?? null
}

export function connectionState(store: Store, deviceId: string): ConnectionState {
  const member = store.db.prepare('SELECT host_id, role FROM round_members WHERE guest_id = ?').get(deviceId) as { host_id: string; role: 'viewer' | 'operator' } | undefined
  const host = member ? store.getDevice(member.host_id) : null
  const incoming = store.db.prepare("SELECT id, host_id AS hostId, guest_id AS guestId, status, expires_at AS expiresAt FROM device_transfers WHERE guest_id = ? AND status = 'claimed' ORDER BY rowid DESC LIMIT 1").get(deviceId) as TransferState | undefined
  const transfer = outgoingTransfer(store, deviceId) ?? incoming ?? null
  const members = store.db.prepare('SELECT guest_id AS deviceId, role FROM round_members WHERE host_id = ?').all(deviceId) as Array<{ deviceId: string; role: 'viewer' | 'operator' }>
  return {
    deviceId, label: store.getDevice(deviceId)?.label ?? 'Gerät',
    host: host && !host.revokedAt ? { deviceId: host.id, label: host.label ?? 'Spieltisch', role: member!.role, lastSeenAt: host.lastSeenAt } : null,
    members: members.flatMap(member => { const device = store.getDevice(member.deviceId); return device && !device.revokedAt ? [{ ...member, label: device.label ?? 'Gerät', lastSeenAt: device.lastSeenAt }] : [] }),
    transfer: transfer ? { id: transfer.id, hostId: transfer.hostId, guestId: transfer.guestId, status: transfer.status, expiresAt: transfer.expiresAt } : null,
    pendingTransferRequest: Boolean(store.db.prepare('SELECT 1 FROM transfer_requests WHERE host_id = ?').get(deviceId)),
  }
}

export function connectionRoutes(deps: { store: Store; snapshots: SnapshotManager; config: ServerConfig }, admin: boolean) {
  const { store, snapshots } = deps
  const db = store.db
  const app = new Hono<AppEnv>()
  app.use('*', bodyLimit({ maxSize: 16 * 1024 }))
  app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store') })
  if (admin) app.use('*', requireAdmin)
  function deviceId(c: import('hono').Context<AppEnv>) {
    const id = admin ? c.req.query('device') ?? c.req.header('x-schockboard-device') ?? store.getDefaultDevice()?.id : c.get('device').id
    if (!id || !store.getDevice(id) || store.getDevice(id)?.revokedAt) return null
    return id
  }
  const bad = (c: import('hono').Context<AppEnv>, message: string, status: 400 | 403 | 404 | 409 = 409) => c.json({ error: 'connection_error', message }, status)
  const transferById = (id: string) => db.prepare('SELECT id, host_id AS hostId, guest_id AS guestId, status, expires_at AS expiresAt, digest FROM device_transfers WHERE id = ?').get(id) as Transfer | undefined

  async function invite(host: string, purpose: 'join' | 'transfer') {
    const transfer = outgoingTransfer(store, host)
    if ((store.getSnapshotMeta(host)?.schemaVersion ?? 0) < 10) throw new Error('Diese Funktion benötigt Schockboard Next auf dem Spieltisch. Alte Daten zuerst per Sicherung importieren.')
    if (purpose === 'transfer' && transfer?.status !== 'waiting') throw new Error('Umzug zuerst auf dem Quellgerät vorbereiten.')
    if (purpose === 'join' && transfer) throw new Error('Während eines Umzugs ist keine Kopplung möglich.')
    if (db.prepare('SELECT 1 FROM round_members WHERE guest_id = ?').get(host)) throw new Error('Ein verbundenes Gerät kann keine weitere Runde freigeben.')
    if (!snapshots.has(host)) throw new Error('Zuerst den Datenstand synchronisieren.')
    const id = randomUUID(), code = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    db.prepare('DELETE FROM round_invites WHERE host_id = ? AND purpose = ? AND guest_id IS NULL').run(host, purpose)
    db.prepare('INSERT INTO round_invites (id, code_hash, host_id, purpose, expires_at, transfer_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, hash(code), host, purpose, expiresAt, purpose === 'transfer' ? transfer!.id : null)
    const url = `schockboard-next://connect?code=${code}`
    return { id, purpose, url, expiresAt, svg: await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 280 }) }
  }

  app.get('/', c => { const id = deviceId(c); return id ? c.json(connectionState(store, id)) : bad(c, 'Gerät unbekannt.', 404) })
  app.post('/invite', async c => {
    const id = deviceId(c), parsed = inviteSchema.safeParse(await c.req.json().catch(() => null))
    if (!id || !parsed.success) return bad(c, 'Ungültige Einladung.', 400)
    try { return c.json(await invite(id, parsed.data.purpose)) } catch (error) { return bad(c, (error as Error).message) }
  })
  app.post('/request-transfer', c => {
    const id = deviceId(c)
    if (!id || outgoingTransfer(store, id)) return bad(c, 'Umzug bereits aktiv.')
    if ((store.getSnapshotMeta(id)?.schemaVersion ?? 0) < 10) return bad(c, 'Der Umzug benötigt Schockboard Next auf dem Quellgerät. Aus der alten App bitte eine Sicherung exportieren.')
    db.prepare('INSERT OR IGNORE INTO transfer_requests(host_id) VALUES (?)').run(id)
    return c.json({ ok: true })
  })
  // Only the source app can acknowledge that its local ledger is frozen.
  if (!admin) app.post('/prepare-transfer', async c => {
    const id = deviceId(c)!
    if ((store.getSnapshotMeta(id)?.schemaVersion ?? 0) < 10) return bad(c, 'Schockboard Next erforderlich.')
    if (db.prepare('SELECT 1 FROM round_members WHERE guest_id = ?').get(id)) return bad(c, 'Zuerst die gekoppelte Runde verlassen.')
    if (!snapshots.has(id) || store.countPendingCommands(id)) return bad(c, 'Zuerst alle ausstehenden Aufträge synchronisieren.')
    if (!outgoingTransfer(store, id)) {
      db.prepare('INSERT INTO device_transfers (id, host_id, status, expires_at, digest) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(), id, 'waiting', new Date(Date.now() + 5 * 60_000).toISOString(), hash(fs.readFileSync(snapshots.rawFile(id))))
    }
    db.prepare('DELETE FROM transfer_requests WHERE host_id = ?').run(id)
    try { return c.json(await invite(id, 'transfer')) } catch (error) { return bad(c, (error as Error).message) }
  })

  if (!admin) app.post('/claim', async c => {
    const guest = deviceId(c)!, parsed = claimSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Ungültiger Einmalcode.', 400)
    const row = db.prepare('SELECT * FROM round_invites WHERE code_hash = ?').get(hash(parsed.data.code)) as { host_id: string; purpose: string; expires_at: string; guest_id: string | null; transfer_id: string | null } | undefined
    if (!row || (row.guest_id && row.guest_id !== guest) || (!row.guest_id && Date.parse(row.expires_at) < Date.now())) return bad(c, 'Einladung abgelaufen oder bereits verwendet.', 403)
    if (row.host_id === guest || store.getDevice(row.host_id)?.revokedAt || !store.getDevice(row.host_id)) return bad(c, 'Ungültiges Quellgerät.', 403)
    if (row.guest_id === guest) {
      const existing = connectionState(store, guest)
      const transfer = row.transfer_id ? transferById(row.transfer_id) : null
      if ((row.purpose === 'join' && existing.host?.deviceId === row.host_id) || (row.purpose === 'transfer' && transfer?.guestId === guest && ['claimed', 'completed'].includes(transfer.status))) return c.json({ purpose: row.purpose, state: existing })
      return bad(c, 'Diese Einladung wurde bereits verwendet.', 403)
    }
    if (db.prepare('SELECT 1 FROM round_members WHERE guest_id = ?').get(row.host_id)) return bad(c, 'Der Spieltisch führt diese Runde nicht mehr.', 403)
    const incoming = connectionState(store, guest)
    if (incoming.transfer || incoming.members.length) return bad(c, 'Dieses Gerät ist bereits an einem Umzug beteiligt oder führt eine gekoppelte Runde.')
    if (row.purpose === 'join') {
      if (outgoingTransfer(store, row.host_id)) return bad(c, 'Auf dem Spieltisch läuft ein Umzug.')
      if (incoming.host && incoming.host.deviceId !== row.host_id) return bad(c, 'Zuerst die bisherige Runde verlassen.')
      db.prepare("INSERT OR IGNORE INTO round_members(guest_id, host_id, role) VALUES (?, ?, 'viewer')").run(guest, row.host_id)
    } else {
      if (incoming.host) return bad(c, 'Zuerst die gekoppelte Runde verlassen.')
      if (store.countPendingCommands(guest)) return bad(c, 'Auf dem Zielgerät zuerst alle ausstehenden Aufträge synchronisieren.')
      const transfer = transferById(row.transfer_id!)
      if (!transfer || !['waiting', 'claimed'].includes(transfer.status) || (transfer.guestId && transfer.guestId !== guest)) return bad(c, 'Umzug nicht verfügbar.')
      db.prepare("UPDATE device_transfers SET guest_id = ?, status = 'claimed' WHERE id = ?").run(guest, transfer.id)
    }
    db.prepare('UPDATE round_invites SET guest_id = ? WHERE code_hash = ?').run(guest, hash(parsed.data.code))
    return c.json({ purpose: row.purpose, state: connectionState(store, guest) })
  })

  app.patch('/members/:guest', async c => {
    const host = deviceId(c), parsed = memberRoleSchema.safeParse(await c.req.json().catch(() => null))
    if (!host || !parsed.success || outgoingTransfer(store, host)) return bad(c, 'Berechtigung kann nicht geändert werden.', 400)
    const changed = db.prepare('UPDATE round_members SET role = ? WHERE host_id = ? AND guest_id = ?').run(parsed.data.role, host, c.req.param('guest')).changes
    if (!changed) return bad(c, 'Gerät gehört nicht zu dieser Runde.', 404)
    if (parsed.data.role === 'viewer') cancelMemberCommands(host, c.req.param('guest'))
    return c.json({ ok: true })
  })
  function cancelMemberCommands(host: string, guest: string) {
    for (const command of store.listPendingCommands(host)) if (command.createdBy === `device:${guest}`) store.cancelCommand(command.id)
  }
  app.delete('/members/:guest', c => {
    const host = deviceId(c), guest = c.req.param('guest')
    if (!host) return bad(c, 'Gerät unbekannt.', 404)
    cancelMemberCommands(host, guest)
    db.prepare('DELETE FROM round_members WHERE host_id = ? AND guest_id = ?').run(host, guest)
    return c.json({ ok: true })
  })
  if (!admin) app.post('/leave', c => {
    const guest = deviceId(c)!, host = connectionState(store, guest).host
    if (host) cancelMemberCommands(host.deviceId, guest)
    db.prepare('DELETE FROM round_members WHERE guest_id = ?').run(guest)
    return c.json({ ok: true })
  })
  app.get('/transfers/:id', c => {
    const transfer = transferById(c.req.param('id')), device = deviceId(c)
    if (!transfer || (transfer.hostId !== device && transfer.guestId !== device)) return bad(c, 'Kein Zugriff auf diesen Umzug.', 403)
    const { digest, ...state } = transfer
    return c.json(state)
  })
  app.post('/transfers/:id/cancel', c => {
    const device = deviceId(c), transfer = transferById(c.req.param('id'))
    // Once another device imports, only that recipient can abort after restoring its previous backup.
    if (!transfer || transfer.status === 'completed' || (transfer.status === 'claimed' ? transfer.guestId !== device : transfer.hostId !== device)) return bad(c, 'Dieser Umzug kann hier nicht abgebrochen werden.', 403)
    db.prepare("UPDATE device_transfers SET status = 'cancelled' WHERE id = ?").run(transfer.id)
    return c.json({ ok: true })
  })
  app.get('/round', c => {
    const guest = deviceId(c)
    if (!guest) return bad(c, 'Gerät unbekannt.', 404)
    const state = connectionState(store, guest), host = state.host
    if (!host) return bad(c, 'Noch keiner Runde beigetreten.', 403)
    if (!snapshots.has(host.deviceId)) return bad(c, 'Noch kein Datenstand verfügbar.')
    return c.json(snapshots.withDevice(host.deviceId, () => {
      const session = getOpenSessionOverview()
      const detail = session ? getSessionDetail(session.id) : null
      return { hostLabel: host.label, role: host.role, receivedAt: store.getSnapshotMeta(host.deviceId)?.receivedAt ?? null,
        session: detail ? {
          session: { id: detail.session.id, title: detail.session.title },
          attendance: detail.attendance.map(({ playerId, playerName, present }) => ({ playerId, playerName, present })),
          losses: detail.losses.map(({ playerId, isBeerRound }) => ({ playerId, isBeerRound })),
        } : null,
        balances: host.role === 'operator' ? getDebtSummaries() : [],
        achievements: buildAchievements(getStatsRawData()),
        commands: store.listCommands(host.deviceId, 100).filter(command => command.createdBy === `device:${guest}`).map(({ id, type, status, error }) => ({ id, type, status, error })),
      }
    }))
  })

  if (!admin) {
    app.get('/transfers/:id/snapshot', c => {
      const transfer = transferById(c.req.param('id'))
      if (!transfer || transfer.guestId !== deviceId(c) || transfer.status !== 'claimed') return bad(c, 'Kein Zugriff auf diesen Umzug.', 403)
      c.header('Content-Type', 'application/vnd.sqlite3')
      return c.body(new Uint8Array(fs.readFileSync(snapshots.rawFile(transfer.hostId))))
    })
    app.post('/transfers/:id/complete', c => {
      const transfer = transferById(c.req.param('id')), guest = deviceId(c)!
      if (!transfer || transfer.guestId !== guest) return bad(c, 'Kein Zugriff auf diesen Umzug.', 403)
      if (transfer.status === 'completed') return c.json({ ok: true })
      if (transfer.status !== 'claimed' || !snapshots.has(guest) || hash(fs.readFileSync(snapshots.rawFile(guest))) !== transfer.digest) return bad(c, 'Übertragener Datenstand noch nicht vollständig bestätigt.')
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare("UPDATE device_transfers SET status = 'completed' WHERE id = ?").run(transfer.id)
        db.prepare('UPDATE round_members SET host_id = ? WHERE host_id = ?').run(guest, transfer.hostId)
        db.prepare("INSERT OR REPLACE INTO round_members (guest_id, host_id, role) VALUES (?, ?, 'viewer')").run(transfer.hostId, guest)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return c.json({ ok: true })
    })
    app.post('/round/commands', async c => {
      const guest = deviceId(c)!, parsed = roundCommandSchema.safeParse(await c.req.json().catch(() => null))
      const host = connectionState(store, guest).host
      if (!parsed.success) return bad(c, 'Ungültige Buchung.', 400)
      const { requestId, type } = parsed.data
      let payload: Record<string, unknown>
      try { payload = parseCommandPayload(type, parsed.data.payload) } catch { return bad(c, 'Ungültige Buchung.', 400) }
      const previous = db.prepare('SELECT command_id, request_json FROM round_requests WHERE guest_id = ? AND request_id = ?').get(guest, requestId) as { command_id: string; request_json: string } | undefined
      if (previous) {
        const original = JSON.parse(previous.request_json)
        return original.type === type && JSON.stringify(original.payload) === JSON.stringify(payload)
          ? c.json({ id: previous.command_id, status: store.getCommand(previous.command_id)?.status ?? 'completed' })
          : bad(c, 'Buchungskennung schon verwendet.')
      }
      if (!host || host.role !== 'operator') return bad(c, 'Bedienrechte müssen am Spieltisch freigegeben werden.', 403)
      const requestJson = JSON.stringify({ host: host.deviceId, type, payload })
      if (outgoingTransfer(store, host.deviceId)) return bad(c, 'Der Spieltisch wird gerade übertragen.')
      if (store.countPendingCommands(host.deviceId) >= 100) return bad(c, 'Zu viele offene Aufträge. Bitte zuerst den Spieltisch synchronisieren.')
      try { snapshots.withDevice(host.deviceId, () => checkAgainstSnapshot(type, payload, store, host.deviceId)) } catch (error) { return bad(c, (error as Error).message, 400) }
      db.exec('BEGIN IMMEDIATE')
      try {
        const command = store.createCommand({ deviceId: host.deviceId, type, payload, createdBy: `device:${guest}` })
        db.prepare('INSERT INTO round_requests(guest_id, request_id, command_id, request_json) VALUES (?, ?, ?, ?)').run(guest, requestId, command.id, requestJson)
        db.exec('COMMIT')
        return c.json({ id: command.id, status: command.status })
      } catch (error) { db.exec('ROLLBACK'); throw error }
    })
  }
  return app
}
