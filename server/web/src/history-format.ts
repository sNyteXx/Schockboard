import { formatCurrency, formatSignedCurrency } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'

import type { HistoryEntry, HistoryRow } from './api'
import type { Tone } from './components'
import type { IconName } from './icons'

export const KIND_LABELS: Record<HistoryEntry['kind'], string> = {
  loss: 'Verlust',
  beerround: 'Bierrunde',
  absence: 'Abwesenheit',
  payment: 'Zahlung',
  correction: 'Korrektur',
  withdrawal: 'Entnahme',
  audit: 'Protokoll',
}

export const KIND_ICONS: Record<HistoryEntry['kind'], IconName> = {
  loss: 'dice',
  beerround: 'beer',
  absence: 'person',
  payment: 'cash-in',
  correction: 'swap-vertical',
  withdrawal: 'cash-out',
  audit: 'document',
}

export const KIND_TONES: Record<HistoryEntry['kind'], Tone> = {
  loss: 'accent',
  beerround: 'info',
  absence: 'warning',
  payment: 'success',
  correction: 'default',
  withdrawal: 'danger',
  audit: 'default',
}

/**
 * Title, detail and amount of a history row – the app's wording
 * (describeHistoryEntry) plus withdrawals, which have no player.
 */
export function presentHistory(entry: HistoryRow) {
  if (entry.kind === 'withdrawal') {
    return {
      title: entry.note ?? entry.message,
      detail: ['aus der Kasse', entry.actorUsername ? `durch ${entry.actorUsername}` : null].filter(Boolean).join(' · '),
      amount: entry.amountCents !== null ? `−${formatCurrency(entry.amountCents)}` : '—',
      amountClass: 'withdrawal',
    }
  }
  const { title, detail } = describeHistoryEntry(entry, { hideSessionTitle: true, includeActor: true })
  const isAudit = entry.kind === 'audit'
  let amount = '—'
  let amountClass = ''
  if (entry.amountCents !== null) {
    if (entry.kind === 'payment') {
      amount = `+${formatCurrency(entry.amountCents)}`
      amountClass = 'credit'
    } else if (entry.kind === 'correction') {
      amount = formatSignedCurrency(entry.amountCents)
      amountClass = entry.amountCents > 0 ? 'debt' : 'credit'
    } else {
      amount = formatCurrency(entry.amountCents)
      amountClass = 'debt'
    }
  }
  return {
    title: isAudit ? title : entry.playerName ?? title,
    detail: isAudit
      ? detail
      : [KIND_LABELS[entry.kind], entry.note ?? (entry.kind === 'absence' ? entry.message.replace('Abwesenheitsdurchschnitt', 'Durchschnitt') : null)]
          .filter(Boolean)
          .join(' · '),
    amount,
    amountClass,
  }
}
