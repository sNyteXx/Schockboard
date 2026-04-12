import type { HistoryEntry } from '@/domain/types'

function joinParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ')
}

function translateAuditEvent(eventType: string) {
  const labels: Record<string, string> = {
    'attendance.toggled': 'Anwesenheit geändert',
    'beerround.logged': 'Bierrunde eingetragen',
    'correction.recorded': 'Korrektur eingetragen',
    'loss.logged': 'Verlust eingetragen',
    'payment.recorded': 'Zahlung eingetragen',
    'player.core_created': 'Stammspieler angelegt',
    'player.guest_created': 'Gast angelegt',
    'player.updated': 'Spielerstatus geändert',
    'player.deleted': 'Spieler gelöscht',
    'session.closed': 'Spielabend abgeschlossen',
    'session.created': 'Spielabend angelegt',
    'session.guest_added': 'Gast hinzugefügt',
    'session.stake_updated': 'Einsatz geändert',
    'settings.updated': 'Einstellungen geändert',
  }

  return labels[eventType] ?? eventType.replaceAll('.', ' ')
}

function normalizeMessage(entry: HistoryEntry) {
  if (entry.kind === 'absence') {
    return entry.message.replace('Abwesenheitsdurchschnitt', 'Durchschnitt')
  }

  if (entry.kind === 'loss' && entry.message === 'Verlust geloggt') {
    return null
  }

  if (entry.kind === 'beerround' && entry.message === 'Bierrunde') {
    return null
  }

  if (entry.kind === 'payment' && entry.message === 'Zahlung in die Kasse') {
    return null
  }

  return entry.message
}

export function describeHistoryEntry(
  entry: HistoryEntry,
  options: {
    hideSessionTitle?: boolean
    includeActor?: boolean
  } = {}
) {
  const sessionTitle = options.hideSessionTitle ? null : entry.sessionTitle
  const actor = options.includeActor && entry.actorUsername ? `durch ${entry.actorUsername}` : null
  const normalizedMessage = normalizeMessage(entry)

  switch (entry.kind) {
    case 'loss':
      return {
        title: 'Verlust',
        detail: joinParts([entry.playerName, normalizedMessage, sessionTitle]),
      }
    case 'beerround':
      return {
        title: '🍺 Bierrunde',
        detail: joinParts([entry.playerName, normalizedMessage, sessionTitle]),
      }
    case 'absence':
      return {
        title: 'Abwesenheit',
        detail: joinParts([entry.playerName, normalizedMessage, sessionTitle]),
      }
    case 'payment':
      return {
        title: 'Zahlung',
        detail: joinParts([entry.playerName, normalizedMessage, sessionTitle]),
      }
    case 'correction':
      return {
        title: 'Korrektur',
        detail: joinParts([entry.playerName, normalizedMessage, sessionTitle]),
      }
    case 'audit':
      return {
        title: translateAuditEvent(entry.message),
        detail: joinParts([sessionTitle, actor]),
      }
    default:
      return {
        title: entry.playerName ?? entry.message,
        detail: joinParts([normalizedMessage, sessionTitle, actor]),
      }
  }
}
