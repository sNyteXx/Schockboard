import { playerColor } from '@/theme/tokens'

import type { CashboxChart, PlayerChartRow } from '../api'
import type { LineSeries } from './LineChart'

const time = (iso: string) => new Date(iso).getTime()

/**
 * Debt line per player in the player's identity colour (same as the app).
 * Archived players and players beyond the first eight start hidden.
 */
export function playerDebtSeries(players: PlayerChartRow[]) {
  const series: LineSeries[] = []
  const hidden: string[] = []
  const active = players.filter((player) => player.timeline.length > 0)
  // Biggest current balances first so the default selection is the interesting one.
  const ranked = [...active].sort((a, b) => Math.abs(b.totals.openDebtCents) - Math.abs(a.totals.openDebtCents))
  const visible = new Set(ranked.filter((player) => !player.isArchived).slice(0, 8).map((player) => player.playerId))
  for (const player of active) {
    series.push({
      id: player.playerId,
      label: player.playerName,
      color: playerColor(player.playerId),
      points: player.timeline.map((point) => ({ t: time(point.at), v: point.debtCents, note: point.label })),
    })
    if (!visible.has(player.playerId)) hidden.push(player.playerId)
  }
  return { series, hidden }
}

/**
 * Outstanding debt (sum of positive balances) and credit (sum of negative
 * balances) after every booking event, oldest first – the KPI sparklines.
 */
export function balanceTotals(players: PlayerChartRow[]) {
  const events = players
    .flatMap((player) => player.timeline.map((point) => ({ playerId: player.playerId, t: time(point.at), delta: point.deltaCents })))
    .sort((a, b) => a.t - b.t)
  const balances = new Map<string, number>()
  const outstanding: number[] = [0]
  const credit: number[] = [0]
  for (const event of events) {
    balances.set(event.playerId, (balances.get(event.playerId) ?? 0) + event.delta)
    let owed = 0
    let ahead = 0
    for (const value of balances.values()) {
      if (value > 0) owed += value
      else ahead -= value
    }
    outstanding.push(owed)
    credit.push(ahead)
  }
  return { outstanding, credit }
}

/** Sum of all players' open debt after every booking event, oldest first. */
export function totalDebtValues(players: PlayerChartRow[]) {
  return balanceTotals(players).outstanding.slice(1)
}

const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`

/** Cash on hand over time (payments − withdrawals). */
export function cashboxSeries(cashbox: CashboxChart, color: string): LineSeries {
  return {
    id: 'cashbox',
    label: 'Kassenstand',
    color,
    points: cashbox.events.map((event) => ({
      t: time(event.at),
      v: event.cashOnHandCents,
      note: event.kind === 'payment' ? `${event.playerName ?? 'Zahlung'}: +${euro(event.amountCents)}` : `Entnahme: −${euro(event.amountCents)} · ${event.note ?? ''}`,
    })),
  }
}

/** Cumulative payments (without withdrawals) – the second line of the cash chart. */
export function paymentsSeries(cashbox: CashboxChart, color: string): LineSeries {
  return {
    id: 'payments',
    label: 'Eingezahlt',
    color,
    dashed: true,
    points: cashbox.payments.map((payment) => ({ t: time(payment.at), v: payment.cumulativeCents, note: `${payment.playerName}: +${euro(payment.amountCents)}` })),
  }
}

/**
 * Crops step series to start at `from`: earlier points collapse into one
 * carried-over point at `from` (the value the line had at that moment).
 */
export function cropSeries(series: LineSeries[], from: number | null): LineSeries[] {
  if (from === null) return series
  return series.map((entry) => {
    const before = entry.points.filter((point) => point.t < from)
    const after = entry.points.filter((point) => point.t >= from)
    const carried = before.length > 0 ? [{ t: from, v: before[before.length - 1].v }] : []
    return { ...entry, points: [...carried, ...after] }
  })
}
