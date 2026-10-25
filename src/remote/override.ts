import { sqliteGet, sqliteRun } from '@/db/client'
import { nowIso } from '@/domain/utils'
import type { CommandPayload } from '@/remote/protocol'

/**
 * Direct edits for the admin web ("Übermacht"). They bypass the regular
 * booking functions on purpose: no audit events, no storno receipts, and
 * closed evenings can be revised. Callers run them inside a transaction.
 */

const TABLES = {
  loss: { table: 'loss_entries', note: 'note' },
  payment: { table: 'payments', note: 'note' },
  correction: { table: 'corrections', note: 'reason' },
  absence: { table: 'absence_charges', note: 'note' },
  withdrawal: { table: 'cashbox_withdrawals', note: 'note' },
} as const

type Kind = keyof typeof TABLES

function requireRow(kind: Kind, entryId: string) {
  const { table } = TABLES[kind]
  const row = sqliteGet<{ id: string }>(`SELECT id FROM ${table} WHERE id = $id`, { $id: entryId })
  if (!row) throw new Error('Buchung nicht gefunden (bereits gelöscht?).')
}

export function deleteEntry(input: CommandPayload<'entry.delete'>) {
  requireRow(input.kind, input.entryId)
  sqliteRun(`DELETE FROM ${TABLES[input.kind].table} WHERE id = $id`, { $id: input.entryId })
}

export function updateEntry(input: CommandPayload<'entry.update'>) {
  requireRow(input.kind, input.entryId)
  const { table, note } = TABLES[input.kind]

  if (input.amountCents !== undefined) {
    if (input.kind === 'withdrawal' && input.amountCents <= 0) throw new Error('Entnahme muss größer 0 sein.')
    if (input.kind === 'correction' ? input.amountCents === 0 : input.amountCents < 0) {
      throw new Error(input.kind === 'correction' ? 'Korrektur darf nicht 0 sein.' : 'Betrag darf nicht negativ sein.')
    }
    sqliteRun(`UPDATE ${table} SET amount_cents = $amount WHERE id = $id`, { $id: input.entryId, $amount: input.amountCents })
  }
  if (input.note !== undefined) {
    if ((input.kind === 'correction' || input.kind === 'withdrawal') && !input.note) throw new Error('Bitte einen Grund angeben.')
    sqliteRun(`UPDATE ${table} SET ${note} = $note WHERE id = $id`, { $id: input.entryId, $note: input.note })
  }
}

export function renamePlayer(input: CommandPayload<'player.rename'>) {
  const taken = sqliteGet<{ id: string }>('SELECT id FROM players WHERE lower(name) = lower($name) AND id != $id', {
    $name: input.name,
    $id: input.playerId,
  })
  if (taken) throw new Error(`Es gibt bereits einen Spieler „${input.name}“.`)
  const result = sqliteRun('UPDATE players SET name = $name, updated_at = $now WHERE id = $id', {
    $id: input.playerId,
    $name: input.name,
    $now: nowIso(),
  })
  if (!result.changes) throw new Error('Spieler nicht gefunden.')
}

export function updateSession(input: CommandPayload<'session.update'>) {
  const exists = sqliteGet<{ id: string }>('SELECT id FROM sessions WHERE id = $id', { $id: input.sessionId })
  if (!exists) throw new Error('Spielabend nicht gefunden.')
  if (input.title !== undefined) {
    sqliteRun('UPDATE sessions SET title = $title, updated_at = $now WHERE id = $id', { $id: input.sessionId, $title: input.title, $now: nowIso() })
  }
  if (input.stakeCents !== undefined) {
    sqliteRun('UPDATE sessions SET stake_cents = $stake, updated_at = $now WHERE id = $id', {
      $id: input.sessionId,
      $stake: input.stakeCents,
      $now: nowIso(),
    })
  }
}

export function deleteSession(input: CommandPayload<'session.delete'>) {
  // loss_entries, absence_charges and attendance cascade; payments/corrections keep their rows.
  const result = sqliteRun('DELETE FROM sessions WHERE id = $id', { $id: input.sessionId })
  if (!result.changes) throw new Error('Spielabend nicht gefunden.')
}

export function deleteAuditEntries(input: CommandPayload<'audit.delete'>) {
  for (const auditId of input.auditIds) {
    sqliteRun('DELETE FROM audit_events WHERE id = $id', { $id: auditId })
  }
}

export function purgeAudit(input: CommandPayload<'audit.purge'>) {
  if (input.before) {
    sqliteRun('DELETE FROM audit_events WHERE created_at < $before', { $before: input.before })
  } else {
    sqliteRun('DELETE FROM audit_events')
  }
}
