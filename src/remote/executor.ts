import { getSqlite, sqliteAll, sqliteGet, sqliteRun } from '@/db/client'
import {
  createAuditEvent,
  createPlayer,
  deleteLastLossUnsafe,
  recordCorrection,
  recordPayment,
  updateAppSettings,
  updatePlayerFlags,
} from '@/db/queries'
import { nowIso } from '@/domain/utils'
import { parseCommandPayload, type CommandResult, type RemoteCommand } from '@/remote/protocol'

type Actor = { accountId: string; username: string }

/** Runs one command through the regular domain functions. */
function dispatch(command: RemoteCommand, actor: Actor) {
  switch (command.type) {
    case 'correction.record': {
      const payload = parseCommandPayload(command.type, command.payload)
      recordCorrection({ actor, ...payload, reason: `${payload.reason} (Web)`, sessionId: payload.sessionId ?? null })
      return
    }
    case 'payment.record': {
      const payload = parseCommandPayload(command.type, command.payload)
      recordPayment({ actor, ...payload, note: payload.note ?? null })
      return
    }
    case 'player.create': {
      const payload = parseCommandPayload(command.type, command.payload)
      createPlayer({ actor, ...payload })
      return
    }
    case 'player.update': {
      const payload = parseCommandPayload(command.type, command.payload)
      updatePlayerFlags({ actor, ...payload })
      return
    }
    case 'settings.update': {
      const payload = parseCommandPayload(command.type, command.payload)
      updateAppSettings({ actor, ...payload })
      return
    }
    case 'loss.void': {
      const payload = parseCommandPayload(command.type, command.payload)
      deleteLastLossUnsafe({ actor, ...payload })
      return
    }
  }
}

function recordInbox(command: RemoteCommand, status: CommandResult['status'], error: string | null) {
  sqliteRun(
    `
      INSERT OR IGNORE INTO remote_inbox (command_id, type, created_by, status, error, applied_at, reported)
      VALUES ($id, $type, $createdBy, $status, $error, $appliedAt, 0)
    `,
    {
      $id: command.id,
      $type: command.type,
      $createdBy: command.createdBy,
      $status: status,
      $error: error,
      $appliedAt: nowIso(),
    }
  )
}

function apply(command: RemoteCommand, actor: Actor) {
  dispatch(command, actor)
  createAuditEvent({
    actorAccountId: actor.accountId,
    eventType: 'remote.command_applied',
    entityType: 'remote_command',
    entityId: command.id,
    payload: { type: command.type, createdBy: command.createdBy, payload: command.payload },
  })
  recordInbox(command, 'applied', null)
}

/**
 * Applies commands in order. Each command is applied at most once: its id is
 * stored in remote_inbox together with the outcome, in the same transaction
 * as the change itself where possible.
 *
 * @returns number of commands that changed local data
 */
export function applyRemoteCommands(commands: RemoteCommand[], actor: Actor) {
  let changed = 0

  for (const command of commands) {
    const seen = sqliteGet<{ command_id: string }>('SELECT command_id FROM remote_inbox WHERE command_id = $id', { $id: command.id })
    if (seen) continue

    try {
      // Change, audit event and inbox row commit together or not at all.
      getSqlite().withTransactionSync(() => apply(command, actor))
      changed++
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
      recordInbox(command, 'rejected', message.slice(0, 500))
    }
  }

  return changed
}

export function getUnreportedResults(): CommandResult[] {
  return sqliteAll<{ command_id: string; status: CommandResult['status']; error: string | null; applied_at: string }>(
    'SELECT command_id, status, error, applied_at FROM remote_inbox WHERE reported = 0 ORDER BY applied_at LIMIT 200'
  ).map((row) => ({ id: row.command_id, status: row.status, error: row.error, appliedAt: row.applied_at }))
}

export function markResultsReported(ids: string[]) {
  for (const id of ids) {
    sqliteRun('UPDATE remote_inbox SET reported = 1 WHERE command_id = $id', { $id: id })
  }
}
