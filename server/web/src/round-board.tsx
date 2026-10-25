import { useEffect } from 'react'
import { roundBoard } from '@/domain/round-board'
import type { RoundState } from '@/remote/collaboration-protocol'
import { playerColor } from '@/theme/tokens'
import { Avatar, Badge, Card, EmptyState, Notice, relativeTime, StatTile } from './components'
import { useApi } from './state'

export function ConnectedRoundBoard() {
  const state = useApi<RoundState>('/connect/round')
  useEffect(() => { const timer = setInterval(state.reload, 5000); return () => clearInterval(timer) }, [])
  const round = state.data
  if (!round) return state.error ? <Notice tone="danger">{state.error.message}</Notice> : <p className="muted">Gemeinsame Runde wird geladen…</p>
  const board = roundBoard(round)
  return <div className="stack span-12">
    <Card tone="hero" title={round.session?.session.title ?? 'Bereit für den nächsten Abend'} eyebrow="Gemeinsame Runde" icon="dice" actions={<Badge tone="accent">{round.role === 'operator' ? 'Bedienung' : 'Zuschauer'}</Badge>}>
      <p className="muted">{round.hostLabel} · Stand {relativeTime(round.receivedAt)}</p>
      <div className="stat-grid round-stats"><StatTile label="Dabei" value={board.present} /><StatTile label="Verluste" value={board.losses} tone="accent" /><StatTile label="Bierrunden" value={board.beers} /></div>
    </Card>
    {round.session ? <div className="round-player-grid">{board.players.map(player => <Card key={player.playerId} className={player.losses > 0 && player.losses === board.maxLosses ? 'round-player leader' : 'round-player'}>
      <Avatar id={player.playerId} name={player.playerName} size={40} muted={!player.present} />
      <h3>{player.playerName}</h3><div className="round-score">{player.losses}</div>
      <p className="muted">{player.losses === 1 ? 'Verlust' : 'Verluste'} · {player.beers} {player.beers === 1 ? 'Bierrunde' : 'Bierrunden'}</p>
      <div className="round-bar"><span style={{ width: `${board.maxLosses ? player.losses / board.maxLosses * 100 : 0}%`, background: playerColor(player.playerId) }} /></div>
      {!player.present ? <Badge>Heute nicht dabei</Badge> : player.losses > 0 && player.losses === board.maxLosses ? <Badge tone="warning">Pechvogel</Badge> : null}
    </Card>)}</div> : <EmptyState icon="dice" title="Noch kein laufender Abend" text="Sobald der Spieltisch startet und synchronisiert, erscheint die Runde hier." />}
    <Card title="Trophäen eurer Runde" icon="star" actions={<Badge tone="accent">{board.awards.length}</Badge>}>
      {board.awards.length ? <ul className="list round-awards">{board.awards.slice(0, 8).map(award => <li className="list-row" key={`${award.playerId}:${award.id}`}><Avatar id={award.playerId} name={award.playerName} /><div className="list-main"><strong>{award.title}</strong><p className="muted">{award.playerName}</p></div></li>)}</ul> : <p className="muted">Die ersten Trophäen werden nach abgeschlossenen Spielabenden freigeschaltet.</p>}
    </Card>
  </div>
}
