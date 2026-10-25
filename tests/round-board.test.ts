import { describe, expect, it } from 'vitest'
import { roundBoard } from '@/domain/round-board'
import type { RoundState } from '@/remote/collaboration-protocol'

const base: RoundState = { hostLabel: 'Tisch', role: 'viewer', receivedAt: null, session: null, balances: [], achievements: [], commands: [] }

describe('shared round board', () => {
  it('separates beer rounds, includes absent players and preserves tied scores', () => {
    const board = roundBoard({ ...base, session: {
      session: { id: 's', title: 'Freitag' },
      attendance: [
        { playerId: 'a', playerName: 'Anna', present: true },
        { playerId: 'b', playerName: 'Ben', present: true },
        { playerId: 'c', playerName: 'Cem', present: false },
      ],
      losses: [
        { playerId: 'a', isBeerRound: false }, { playerId: 'a', isBeerRound: true },
        { playerId: 'b', isBeerRound: false }, { playerId: 'c', isBeerRound: false },
        { playerId: 'c', isBeerRound: false },
      ],
    } })
    expect(board).toMatchObject({ present: 2, losses: 4, beers: 1, maxLosses: 2 })
    expect(board.players.map(p => [p.playerName, p.losses, p.beers, p.present])).toEqual([
      ['Anna', 1, 1, true], ['Ben', 1, 0, true], ['Cem', 2, 0, false],
    ])
  })
  it('handles no running evening without borrowing local data', () => {
    expect(roundBoard(base)).toEqual({ players: [], losses: 0, beers: 0, present: 0, maxLosses: 0, awards: [] })
  })
})
