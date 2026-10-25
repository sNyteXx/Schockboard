import { View } from 'react-native'
import { PlayerAvatar } from '@/components/avatar'
import { KeepAwakeWhileLive } from '@/components/live-mode'
import { AppText, Badge, Card, CardHeader, EmptyState, Grid, StatTile } from '@/components/ui'
import { roundBoard } from '@/domain/round-board'
import { formatDateTime } from '@/domain/format'
import type { RoundState } from '@/remote/collaboration-protocol'
import { colors, playerColor, radius, spacing } from '@/theme/tokens'

export function RoundBoard({ round, actions }: { round: RoundState; actions?: React.ReactNode }) {
  const board = roundBoard(round)
  return <View style={{ gap: spacing.md }}>
    {round.session ? <KeepAwakeWhileLive /> : null}
    <Card tone="hero">
      <CardHeader overline="GEMEINSAME RUNDE" title={round.session?.session.title ?? 'Bereit für den nächsten Abend'} icon="dice-outline" aside={<Badge tone="accent">{round.role === 'operator' ? 'Bedienung' : 'Zuschauer'}</Badge>} />
      <AppText variant="caption" tone="muted">{round.hostLabel} · Stand {round.receivedAt ? formatDateTime(round.receivedAt) : 'noch nicht empfangen'}</AppText>
      <Grid columns={{ compact: 3, medium: 3, expanded: 3 }}>
        <StatTile label="Dabei" value={String(board.present)} />
        <StatTile label="Verluste" value={String(board.losses)} tone="accent" />
        <StatTile label="Bierrunden" value={String(board.beers)} />
      </Grid>
      {actions}
    </Card>
    {round.session ? <Grid columns={{ compact: 2, medium: 3, expanded: 4 }}>
      {board.players.map(player => <Card key={player.playerId} animated={false} tone={player.losses > 0 && player.losses === board.maxLosses ? 'accent' : 'default'} style={{ flexGrow: 1 }}>
        <PlayerAvatar id={player.playerId} name={player.playerName} size={40} muted={!player.present} />
        <AppText variant="subheading" numberOfLines={2}>{player.playerName}</AppText>
        <AppText variant="scoreboard" tone={player.present ? 'default' : 'muted'}>{player.losses}</AppText>
        <AppText variant="caption" tone="muted">{player.losses === 1 ? 'Verlust' : 'Verluste'} · {player.beers} {player.beers === 1 ? 'Bierrunde' : 'Bierrunden'}</AppText>
        <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSoft, overflow: 'hidden' }}><View style={{ height: 4, width: `${board.maxLosses ? player.losses / board.maxLosses * 100 : 0}%`, backgroundColor: playerColor(player.playerId) }} /></View>
        {!player.present ? <Badge>Heute nicht dabei</Badge> : player.losses > 0 && player.losses === board.maxLosses ? <Badge tone="warning">Pechvogel</Badge> : null}
      </Card>)}
    </Grid> : <EmptyState icon="moon-outline" title="Noch kein laufender Abend">Sobald der Spieltisch startet und synchronisiert, erscheint die Runde hier.</EmptyState>}
    <Card><CardHeader title="Trophäen eurer Runde" icon="trophy-outline" aside={<Badge tone="accent">{board.awards.length}</Badge>} />
      {board.awards.length ? board.awards.slice(0, 8).map(award => <View key={`${award.playerId}:${award.id}`} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <PlayerAvatar id={award.playerId} name={award.playerName} size={32} />
        <View style={{ flex: 1 }}><AppText variant="label" tone="accent">{award.title}</AppText><AppText variant="caption" tone="muted">{award.playerName}</AppText></View>
      </View>) : <AppText tone="muted">Die ersten Trophäen werden nach abgeschlossenen Spielabenden freigeschaltet.</AppText>}
    </Card>
  </View>
}
