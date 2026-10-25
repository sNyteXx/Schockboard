import * as SecureStore from 'expo-secure-store'
import { fetch } from 'expo/fetch'
import { getSqlite } from '@/db/client'
import { LATEST_SCHEMA_VERSION } from '@/db/bootstrap'
import { withRollbackJournalHeader } from '@/domain/backup-validation'
import { BackupService } from '@/services/backup-service'
import { RemoteConfigStore } from './config'
import { HandoffStore } from './handoff'
import type { ConnectionState, Invitation, RoundState, RoundCommandType, TransferState } from './collaboration-protocol'

export class ConnectionError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function deviceRequest(path: string, options: { method?: string; body?: unknown; bytes?: Uint8Array } = {}) {
  const config = await RemoteConfigStore.get()
  if (!config) throw new Error('Gerät noch nicht angemeldet. Bitte zuerst synchronisieren.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.bytes ? 120_000 : 20_000)
  try {
    const response = await fetch(`${config.server}/api/device${path}`, {
      method: options.method ?? 'GET', signal: controller.signal,
      headers: { Authorization: `Bearer ${config.token}`, ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.bytes ? { 'Content-Type': 'application/vnd.sqlite3', 'X-Schockboard-Schema': String(LATEST_SCHEMA_VERSION), 'X-Snapshot-Created-At': new Date().toISOString() } : {}) },
      body: options.bytes ? new Uint8Array(options.bytes).buffer : options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null
      throw new ConnectionError(error?.message ?? `Verbindung fehlgeschlagen (${response.status}).`, response.status)
    }
    return response
  } finally { clearTimeout(timer) }
}
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return (await deviceRequest(`/connect${path}`, { method, body })).json() as Promise<T>
}

export type PendingRoundBooking = { requestId: string; type: RoundCommandType; payload: Record<string, unknown> }
const PENDING_BOOKING_KEY = 'schockboard.round.pending'

export const Connections = {
  async pendingBooking(): Promise<PendingRoundBooking | null> {
    const raw = await SecureStore.getItemAsync(PENDING_BOOKING_KEY)
    return raw ? JSON.parse(raw) as PendingRoundBooking : null
  },
  async savePendingBooking(booking: PendingRoundBooking | null) {
    if (booking) await SecureStore.setItemAsync(PENDING_BOOKING_KEY, JSON.stringify(booking))
    else await SecureStore.deleteItemAsync(PENDING_BOOKING_KEY)
  },
  async state() { const state = await json<ConnectionState>(''); await RemoteConfigStore.setLinkedHost(state.host?.deviceId ?? null); return state },
  round: () => json<RoundState>('/round'),
  invite: (purpose: 'join' | 'transfer') => json<Invitation>('/invite', 'POST', { purpose }),
  claim: (code: string) => json<{ purpose: 'join' | 'transfer'; state: ConnectionState }>('/claim', 'POST', { code }),
  setRole: (guest: string, role: 'viewer' | 'operator') => json(`/members/${encodeURIComponent(guest)}`, 'PATCH', { role }),
  remove: (guest: string) => json(`/members/${encodeURIComponent(guest)}`, 'DELETE'),
  leave: () => json('/leave', 'POST'),
  book: (requestId: string, type: RoundCommandType, payload: unknown) => json<{ id: string; status: string }>('/round/commands', 'POST', { requestId, type, payload }),
  async prepareTransfer() {
    await HandoffStore.set({ kind: 'source' })
    const state = await this.state()
    if (!state.transfer) {
      BackupService.saveLocal('before-transfer')
      await deviceRequest('/snapshot', { method: 'PUT', bytes: withRollbackJournalHeader(getSqlite().serializeSync()) })
    }
    const invitation = await json<Invitation>('/prepare-transfer', 'POST')
    await HandoffStore.set({ kind: 'source', id: (await this.state()).transfer!.id })
    return invitation
  },
  async receiveTransfer(id: string) {
    const existing = await HandoffStore.get()
    const backup = existing?.kind === 'receiver' && existing.id === id ? existing.backup! : BackupService.saveLocal('before-transfer')
    await HandoffStore.set({ kind: 'receiver', id, backup })
    const transfer = await json<TransferState>(`/transfers/${encodeURIComponent(id)}`)
    // A completed confirmation may have been lost on the network.
    if (transfer.status === 'completed') { await HandoffStore.set(null); await RemoteConfigStore.clearUploadedFingerprint(); return }
    if (transfer.status !== 'claimed') throw new Error('Umzug nicht mehr aktiv. Bitte abbrechen und die Sicherheitskopie wiederherstellen.')
    const bytes = new Uint8Array(await (await deviceRequest(`/connect/transfers/${encodeURIComponent(id)}/snapshot`)).arrayBuffer())
    BackupService.restoreValidatedBackup(bytes)
    await deviceRequest('/snapshot', { method: 'PUT', bytes })
    await json(`/transfers/${encodeURIComponent(id)}/complete`, 'POST')
    await RemoteConfigStore.clearUploadedFingerprint()
    await HandoffStore.set(null)
  },
  async cancelTransfer() {
    const state = await this.state(), pending = await HandoffStore.get()
    if (pending?.kind === 'receiver' && pending.id) {
      const transfer = await json<TransferState>(`/transfers/${encodeURIComponent(pending.id)}`)
      if (transfer.status === 'completed') throw new Error('Umzug bereits bestätigt. Bitte Übertragung fortsetzen, um den Abschluss zu prüfen.')
      if (!pending.backup) throw new Error('Sicherheitskopie fehlt. Umzug nicht abgebrochen.')
      BackupService.restoreValidatedBackup(BackupService.readLocal(pending.backup))
      await deviceRequest('/snapshot', { method: 'PUT', bytes: withRollbackJournalHeader(getSqlite().serializeSync()) })
    }
    if (state.transfer) {
      if (state.transfer.status === 'completed') throw new Error('Umzug abgeschlossen. Dieses Gerät bleibt Zuschauer.')
      await json(`/transfers/${encodeURIComponent(state.transfer.id)}/cancel`, 'POST')
    }
    await HandoffStore.set(null)
    await RemoteConfigStore.clearUploadedFingerprint()
  },
}
