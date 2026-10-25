import type { RoundState } from '@/remote/collaboration-protocol'

/** Uses only the shared round's public fields, never the guest's local ledger. */
export function roundBoard(round: RoundState) {
  const counts = new Map<string, { losses: number; beers: number }>()
  for (const loss of round.session?.losses ?? []) {
    const count = counts.get(loss.playerId) ?? { losses: 0, beers: 0 }
    if (loss.isBeerRound) count.beers++
    else count.losses++
    counts.set(loss.playerId, count)
  }
  const players = (round.session?.attendance ?? []).map(player => ({ ...player, ...(counts.get(player.playerId) ?? { losses: 0, beers: 0 }) }))
    .sort((a, b) => Number(b.present) - Number(a.present) || b.losses - a.losses || a.playerName.localeCompare(b.playerName, 'de'))
  const losses = [...counts.values()].reduce((sum, row) => sum + row.losses, 0)
  const beers = [...counts.values()].reduce((sum, row) => sum + row.beers, 0)
  return { players, losses, beers, present: players.filter(player => player.present).length,
    maxLosses: Math.max(0, ...players.map(player => player.losses)),
    awards: round.achievements.filter(award => award.unlockedAt).sort((a, b) => b.unlockedAt!.localeCompare(a.unlockedAt!)),
  }
}
