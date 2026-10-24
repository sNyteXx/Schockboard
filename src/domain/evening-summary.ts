import { formatCurrency } from '@/domain/format'
import { calculateAbsenceChargeCents } from '@/domain/ledger'
import type { AbsencePenaltyMode, SessionDetail } from '@/domain/types'

/**
 * Pure building blocks for the "Abschluss" step of the evening assistant.
 * The preview for an open evening must charge absent regulars exactly like
 * closeSession() in src/db/queries.ts does, so the same inputs (present and
 * absent regulars from attendance, non-beer losses of present regulars) and
 * the same ledger helper are used here.
 */

export type SummaryAttendance = {
  playerId: string
  playerName: string
  isCore: boolean
  present: boolean
}

export type SummaryLoss = {
  playerId: string
  playerName: string
  amountCents: number
  isBeerRound: boolean
}

export type SummaryAbsence = {
  playerId: string
  playerName: string
  amountCents: number
}

export type EveningSummaryInput = {
  status: 'open' | 'closed'
  attendance: SummaryAttendance[]
  losses: SummaryLoss[]
  /** Absence charges already booked (only exist for closed evenings). */
  absences: SummaryAbsence[]
  absencePenaltyMode: AbsencePenaltyMode
}

export type EveningSummaryPlayer = {
  playerId: string
  playerName: string
  isCore: boolean
  present: boolean
  lossCount: number
  lossCents: number
  beerRoundCount: number
  beerRoundCents: number
  absenceCents: number
  totalCents: number
}

/**
 * Why absent regulars are not charged although some are absent.
 * - disabled: house rule "none"
 * - no-present-core: nobody of the regular round was present
 * - no-losses: present regulars did not lose anything (nothing to average)
 * - not-charged: closed evening without booked charges
 */
export type AbsenceSkipReason = 'disabled' | 'no-present-core' | 'no-losses' | 'not-charged' | null

export type EveningSummary = {
  isFinal: boolean
  /** Present players, the evening's ranking (most losses first). */
  ranking: EveningSummaryPlayer[]
  /** Absent regulars incl. their (projected or booked) charge. */
  absentCore: EveningSummaryPlayer[]
  /** Everyone with a non-zero amount or attendance, ranking first. */
  players: EveningSummaryPlayer[]
  presentCount: number
  presentCoreCount: number
  lossCount: number
  lossCents: number
  beerRoundCount: number
  beerRoundCents: number
  absenceCents: number
  totalCents: number
  /** Charge per absent regular for open evenings (0 when skipped). */
  absenceChargeCents: number
  absenceSkipReason: AbsenceSkipReason
  pechvogel: { playerIds: string[]; names: string[]; lossCount: number; lossCents: number } | null
}

function emptyPlayer(row: { playerId: string; playerName: string }, isCore: boolean, present: boolean): EveningSummaryPlayer {
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    isCore,
    present,
    lossCount: 0,
    lossCents: 0,
    beerRoundCount: 0,
    beerRoundCents: 0,
    absenceCents: 0,
    totalCents: 0,
  }
}

export function compareByLosses(left: EveningSummaryPlayer, right: EveningSummaryPlayer) {
  if (right.lossCount !== left.lossCount) return right.lossCount - left.lossCount
  if (right.lossCents !== left.lossCents) return right.lossCents - left.lossCents
  return left.playerName.localeCompare(right.playerName, 'de')
}

/** All players sharing the highest (non-zero) number of normal losses. */
export function findPechvogel(players: Array<Pick<EveningSummaryPlayer, 'playerId' | 'playerName' | 'lossCount' | 'lossCents'>>) {
  const maxCount = players.reduce((max, player) => Math.max(max, player.lossCount), 0)
  if (maxCount <= 0) return null
  const tied = players
    .filter((player) => player.lossCount === maxCount)
    .sort((left, right) => left.playerName.localeCompare(right.playerName, 'de'))
  return {
    playerIds: tied.map((player) => player.playerId),
    names: tied.map((player) => player.playerName),
    lossCount: maxCount,
    lossCents: Math.max(...tied.map((player) => player.lossCents)),
  }
}

export function buildEveningSummary(input: EveningSummaryInput): EveningSummary {
  const isFinal = input.status === 'closed'
  const byId = new Map<string, EveningSummaryPlayer>()

  for (const row of input.attendance) {
    byId.set(row.playerId, emptyPlayer(row, row.isCore, row.present))
  }

  for (const loss of input.losses) {
    let player = byId.get(loss.playerId)
    if (!player) {
      player = emptyPlayer(loss, false, true)
      byId.set(loss.playerId, player)
    }
    if (loss.isBeerRound) {
      player.beerRoundCount += 1
      player.beerRoundCents += loss.amountCents
    } else {
      player.lossCount += 1
      player.lossCents += loss.amountCents
    }
  }

  const presentCore = input.attendance.filter((row) => row.present && row.isCore)
  const absentCoreRows = input.attendance.filter((row) => !row.present && row.isCore)
  let absenceChargeCents = 0
  let absenceSkipReason: AbsenceSkipReason = null

  if (isFinal) {
    for (const absence of input.absences) {
      let player = byId.get(absence.playerId)
      if (!player) {
        player = emptyPlayer(absence, true, false)
        byId.set(absence.playerId, player)
      }
      player.absenceCents += absence.amountCents
    }
    const booked = input.absences.reduce((sum, row) => sum + row.amountCents, 0)
    if (absentCoreRows.length > 0 && booked === 0) absenceSkipReason = 'not-charged'
  } else if (absentCoreRows.length > 0) {
    const totalPresentCoreLossCents = presentCore.reduce((sum, row) => sum + (byId.get(row.playerId)?.lossCents ?? 0), 0)
    if (input.absencePenaltyMode === 'none') {
      absenceSkipReason = 'disabled'
    } else if (presentCore.length === 0) {
      absenceSkipReason = 'no-present-core'
    } else if (totalPresentCoreLossCents <= 0) {
      absenceSkipReason = 'no-losses'
    } else {
      absenceChargeCents = calculateAbsenceChargeCents({
        mode: input.absencePenaltyMode,
        totalPresentCoreLossCents,
        presentCoreCount: presentCore.length,
        absentCoreCount: absentCoreRows.length,
      })
      for (const row of absentCoreRows) {
        byId.get(row.playerId)!.absenceCents = absenceChargeCents
      }
    }
  }

  for (const player of byId.values()) {
    player.totalCents = player.lossCents + player.beerRoundCents + player.absenceCents
  }

  const all = [...byId.values()]
  const ranking = all.filter((player) => player.present).sort(compareByLosses)
  const absentCore = all
    .filter((player) => !player.present && (player.isCore || player.absenceCents > 0))
    .sort((left, right) => left.playerName.localeCompare(right.playerName, 'de'))
  const others = all.filter((player) => !player.present && !absentCore.includes(player) && player.totalCents > 0)
  const sum = (pick: (player: EveningSummaryPlayer) => number) => all.reduce((total, player) => total + pick(player), 0)
  const lossCents = sum((player) => player.lossCents)
  const beerRoundCents = sum((player) => player.beerRoundCents)
  const absenceCents = sum((player) => player.absenceCents)

  return {
    isFinal,
    ranking,
    absentCore,
    players: [...ranking, ...others, ...absentCore],
    presentCount: ranking.length,
    presentCoreCount: presentCore.length,
    lossCount: sum((player) => player.lossCount),
    lossCents,
    beerRoundCount: sum((player) => player.beerRoundCount),
    beerRoundCents,
    absenceCents,
    totalCents: lossCents + beerRoundCents + absenceCents,
    absenceChargeCents,
    absenceSkipReason,
    pechvogel: findPechvogel(all),
  }
}

/** Maps the session detail returned by getSessionDetail() to summary input. */
export function summaryInputFromDetail(detail: SessionDetail, absencePenaltyMode: AbsencePenaltyMode): EveningSummaryInput {
  return {
    status: detail.session.status,
    attendance: detail.attendance.map((row) => ({ playerId: row.playerId, playerName: row.playerName, isCore: row.isCore, present: row.present })),
    losses: detail.losses.map((loss) => ({ playerId: loss.playerId, playerName: loss.playerName, amountCents: loss.amountCents, isBeerRound: loss.isBeerRound })),
    absences: detail.absences.map((row) => ({ playerId: row.playerId, playerName: row.playerName, amountCents: row.amountCents })),
    absencePenaltyMode,
  }
}

export function describeAbsenceSkipReason(reason: AbsenceSkipReason) {
  switch (reason) {
    case 'disabled':
      return 'Abwesenheitszuschläge sind in den Hausregeln deaktiviert.'
    case 'no-present-core':
      return 'Kein Stammspieler anwesend – daher keine Zuschläge.'
    case 'no-losses':
      return 'Die anwesenden Stammspieler haben nichts verloren – daher keine Zuschläge.'
    case 'not-charged':
      return 'Für diesen Abend wurden keine Abwesenheitszuschläge gebucht.'
    default:
      return null
  }
}

/** Plain-text version of the result card, used for sharing. */
export function formatEveningSummaryText(summary: EveningSummary, meta: { title: string; dateLabel: string }) {
  const lines: string[] = [`🎲 ${meta.title} – ${meta.dateLabel}`, '']

  if (summary.pechvogel) {
    lines.push(`Pechvogel des Abends: ${summary.pechvogel.names.join(' & ')} (${summary.pechvogel.lossCount} ${summary.pechvogel.lossCount === 1 ? 'Verlust' : 'Verluste'})`, '')
  }

  if (summary.ranking.length) {
    lines.push('Am Tisch:')
    summary.ranking.forEach((player, index) => {
      const beer = player.beerRoundCount ? ` + ${player.beerRoundCount}× 🍺` : ''
      lines.push(`${index + 1}. ${player.playerName}: ${player.lossCount}× verloren${beer} – ${formatCurrency(player.totalCents)}`)
    })
    lines.push('')
  }

  const charged = summary.absentCore.filter((player) => player.absenceCents > 0)
  if (charged.length) {
    lines.push('Abwesend:')
    for (const player of charged) lines.push(`• ${player.playerName}: ${formatCurrency(player.absenceCents)}`)
    lines.push('')
  }

  lines.push(`Verluste: ${summary.lossCount} (${formatCurrency(summary.lossCents)})`)
  if (summary.beerRoundCount) lines.push(`Bierrunden: ${summary.beerRoundCount} (${formatCurrency(summary.beerRoundCents)})`)
  if (summary.absenceCents) lines.push(`Abwesenheit: ${formatCurrency(summary.absenceCents)}`)
  lines.push(`Gesamt: ${formatCurrency(summary.totalCents)}`)
  lines.push('', '– Schockboard')

  return lines.join('\n')
}
