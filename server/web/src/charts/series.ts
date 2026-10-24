import type { CashboxChart, PlayerChartRow } from '../api'
import type { LineSeries } from './LineChart'
import { OTHER_COLOR, SERIES_COLORS } from './scale'

const time = (iso: string) => new Date(iso).getTime()

/**
 * Debt line per player. Colours follow the player (alphabetical slot among
 * all players), never the current rank; players past slot 8 share a dashed
 * neutral line and start hidden, as do archived players.
 */
export function playerDebtSeries(players: PlayerChartRow[]) {
  const series: LineSeries[] = []
  const hidden: string[] = []
  players.forEach((player, index) => {
    if (player.timeline.length === 0) return
    const overflow = index >= SERIES_COLORS.length
    series.push({
      id: player.playerId,
      label: player.playerName,
      color: overflow ? OTHER_COLOR : SERIES_COLORS[index],
      dashed: overflow,
      points: player.timeline.map((point) => ({ t: time(point.at), v: point.debtCents, note: point.label })),
    })
    if (overflow || player.isArchived) hidden.push(player.playerId)
  })
  return { series, hidden }
}

/** Sum of all players' open debt after every booking event, oldest first. */
export function totalDebtValues(players: PlayerChartRow[]) {
  const events = players.flatMap((player) => player.timeline).sort((a, b) => time(a.at) - time(b.at))
  let total = 0
  return events.map((event) => (total += event.deltaCents))
}

export function cashboxSeries(cashbox: CashboxChart, color: string): LineSeries {
  return {
    id: 'cashbox',
    label: 'Eingezahlt (kumuliert)',
    color,
    points: cashbox.payments.map((payment) => ({ t: time(payment.at), v: payment.cumulativeCents, note: `${payment.playerName}: +${(payment.amountCents / 100).toFixed(2).replace('.', ',')} €` })),
  }
}
