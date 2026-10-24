import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'

import { BrandHero } from '@/components/brand'
import { PlayerBoard, type BoardPlayer } from '@/components/player-board'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Select,
  Stack,
  StatCard,
} from '@/components/ui'
import { formatCurrency, formatDateTime } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'
import { cleanOptionalText, parseEuroToCents } from '@/domain/utils'
import { Feedback } from '@/services/haptics'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { useRuntime } from '@/providers/runtime-provider'
import { SessionService } from '@/services/session-service'
import { colors, radius, spacing } from '@/theme/tokens'

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const { isWide, isTablet } = useDeviceLayout()
  const detail = useAsyncResource(() => SessionService.getSessionDetail(id), [runtime.dataVersion, id])
  const [stake, setStake] = useState('1,00')
  const [guestName, setGuestName] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [note, setNote] = useState('')
  const [beerAmount, setBeerAmount] = useState('5,00')
  const [beerPlayerId, setBeerPlayerId] = useState('')
  const [beerNote, setBeerNote] = useState('')
  const [showMore, setShowMore] = useState(false)

  const sessionStake = detail.data?.session.stakeCents
  useEffect(() => {
    if (sessionStake !== undefined) setStake((sessionStake / 100).toFixed(2).replace('.', ','))
  }, [sessionStake])

  useEffect(() => {
    if (!detail.data) return
    const available = detail.data.availablePresentPlayers
    setPlayerId((previous) => available.some((player) => player.id === previous) ? previous : available[0]?.id ?? '')
    setBeerPlayerId((previous) => available.some((player) => player.id === previous) ? previous : available[0]?.id ?? '')
  }, [detail.data])

  if (detail.loading && !detail.data || !runtime.account) {
    return <Screen><ActivityIndicator color={colors.accentStrong} size="large" /></Screen>
  }

  if (detail.error) {
    return <Screen><Card><Notice type="error" message={detail.error.message} /><Button onPress={detail.reload}>Erneut versuchen</Button></Card></Screen>
  }

  if (!detail.data) {
    return <Screen><Card><EmptyState>Spielabend nicht gefunden.</EmptyState></Card></Screen>
  }

  const session = detail.data.session
  const isClosed = session.status === 'closed'
  const isAdvanced = runtime.viewMode === 'advanced'
  const presentCoreCount = detail.data.attendance.filter((row) => row.present && row.isCore).length
  const absentCoreCount = detail.data.attendance.filter((row) => !row.present && row.isCore).length
  const normalLosses = detail.data.losses.filter((loss) => !loss.isBeerRound)
  const totalTodayCents = detail.data.losses.reduce((total, loss) => total + loss.amountCents, 0)
  const players: BoardPlayer[] = detail.data.availablePresentPlayers.map((player) => {
    const playerLosses = normalLosses.filter((loss) => loss.playerId === player.id)
    return {
      id: player.id,
      name: player.name,
      isCore: player.isCore,
      lossCount: playerLosses.length,
      todayCents: detail.data!.losses.filter((loss) => loss.playerId === player.id).reduce((total, loss) => total + loss.amountCents, 0),
    }
  })

  const actor = { accountId: runtime.account.id, username: runtime.account.username }

  function showError(error: unknown, fallback: string) {
    Feedback.error()
    runtime.setFlash({ type: 'error', message: error instanceof Error ? error.message : fallback })
  }

  function handleStakeUpdate() {
    try {
      SessionService.updateSessionStake({ actor, sessionId: session.id, stakeCents: parseEuroToCents(stake) })
      runtime.bumpDataVersion()
      runtime.setFlash({ type: 'success', message: 'Einsatz aktualisiert.' })
    } catch (error) {
      showError(error, 'Einsatz konnte nicht aktualisiert werden.')
    }
  }

  function closeSession() {
    try {
      const result = SessionService.closeSession({ actor, sessionId: session.id })
      Feedback.success()
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message: result.reason === 'disabled'
          ? 'Spielabend abgeschlossen – automatische Abwesenheitsbeträge sind deaktiviert.'
          : result.reason === 'no-present-core'
            ? 'Spielabend abgeschlossen – keine Zuschläge ohne anwesende Stammspieler.'
            : 'Spielabend abgeschlossen.',
      })
    } catch (error) {
      showError(error, 'Spielabend konnte nicht abgeschlossen werden.')
    }
  }

  function confirmClose() {
    Alert.alert(
      'Spielabend abschließen?',
      `${normalLosses.length} Verluste und ${detail.data!.losses.length - normalLosses.length} Bierrunden wurden erfasst. ` +
      `${absentCoreCount} Stammspieler sind abwesend. Je nach Hausregel können beim Abschluss Zuschläge entstehen. ` +
      'Danach können keine Buchungen mehr vorgenommen werden.',
      [
        { text: 'Weiterspielen', style: 'cancel' },
        { text: 'Abschließen', style: 'destructive', onPress: closeSession },
      ],
    )
  }

  function handleGuest() {
    try {
      SessionService.addGuestToSession({ actor, sessionId: session.id, name: guestName.trim() })
      runtime.bumpDataVersion()
      setGuestName('')
    } catch (error) {
      showError(error, 'Gast konnte nicht hinzugefügt werden.')
    }
  }

  function recordLoss(targetPlayerId: string, entryNote: string | null) {
    try {
      const entryId = SessionService.addLossEntry({ actor, sessionId: session.id, playerId: targetPlayerId, note: entryNote })
      runtime.bumpDataVersion()
      runtime.scheduleUndo({ type: 'loss', sessionId: session.id, playerId: targetPlayerId, entryId, label: 'Verlust gebucht' })
      setNote('')
    } catch (error) {
      showError(error, 'Verlust konnte nicht gebucht werden.')
    }
  }

  function removeLastLoss(targetPlayerId: string) {
    try {
      SessionService.deleteLastLoss({ actor, sessionId: session.id, playerId: targetPlayerId })
      runtime.bumpDataVersion()
      runtime.cancelUndo()
      runtime.setFlash({ type: 'success', message: 'Letzter Verlust storniert.' })
    } catch (error) {
      showError(error, 'Verlust konnte nicht storniert werden.')
    }
  }

  function toggleAttendance(targetPlayerId: string) {
    try {
      SessionService.toggleAttendance({ actor, sessionId: session.id, playerId: targetPlayerId })
      runtime.bumpDataVersion()
    } catch (error) {
      showError(error, 'Anwesenheit konnte nicht geändert werden.')
    }
  }

  function recordBeerRound() {
    try {
      const entryId = SessionService.addBeerRoundEntry({
        actor, sessionId: session.id, playerId: beerPlayerId,
        amountCents: parseEuroToCents(beerAmount), note: cleanOptionalText(beerNote),
      })
      runtime.bumpDataVersion()
      setBeerNote('')
      runtime.scheduleUndo({ type: 'beerround', sessionId: session.id, playerId: beerPlayerId, entryId, label: 'Bierrunde gebucht' })
    } catch (error) {
      showError(error, 'Bierrunde konnte nicht gebucht werden.')
    }
  }

  const presentCount = detail.data.attendance.filter((row) => row.present).length
  const timeline = detail.data.timeline.filter((entry) => entry.kind === 'loss' || entry.kind === 'beerround' || entry.kind === 'correction')

  return (
    <Screen>
      <Stack>
        {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

        <BrandHero
          themeId={runtime.themeId}
          title={session.title}
          subtitle={`Seit ${formatDateTime(session.startedAt)}${session.closedAt ? ` · Ende ${formatDateTime(session.closedAt)}` : ''}`}
          aside={<Badge tone={isClosed ? 'default' : 'success'}>{isClosed ? 'ABGESCHLOSSEN' : '● LIVE'}</Badge>}
        />

        {isTablet ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><StatCard label="Am Tisch" value={`${presentCount}`} hint="Spieler anwesend" /></View>
            <View style={{ flex: 1 }}><StatCard label="Verluste" value={`${normalLosses.length}`} hint={`${formatCurrency(session.stakeCents)} je Verlust`} /></View>
            <View style={{ flex: 1 }}><StatCard label="Heute gebucht" value={formatCurrency(totalTodayCents)} hint="Inklusive Bierrunden" /></View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <CompactMetric label="SPIELER" value={`${presentCount}`} />
            <CompactMetric label="VERLUSTE" value={`${normalLosses.length}`} />
            <CompactMetric label="BETRAG" value={formatCurrency(totalTodayCents)} />
          </View>
        )}

        <View style={{ flexDirection: isWide ? 'row' : 'column', alignItems: 'stretch', gap: spacing.md }}>
          <View style={{ flex: isWide ? 1.75 : undefined, minWidth: 0, gap: spacing.md }}>
            <Card>
              <PlayerBoard
                players={players}
                stakeCents={session.stakeCents}
                isClosed={isClosed}
                onAdd={(targetId) => recordLoss(targetId, null)}
                onRemove={removeLastLoss}
              />
            </Card>

            {!isClosed ? (
              <Button tone="secondary" onPress={() => setShowMore((value) => !value)}>
                {showMore ? 'Erweiterte Buchung schließen' : '⚙ Einsatz und erweiterte Buchung'}
              </Button>
            ) : null}

            {!isClosed && showMore ? (
              <Card>
                <SectionTitle eyebrow="Spielabend" title="Einsatz und Details" />
                <Field label="Einsatz pro Verlust (€)">
                  <Input value={stake} onChangeText={setStake} keyboardType="decimal-pad" />
                </Field>
                <Button tone="secondary" onPress={handleStakeUpdate}>Einsatz speichern</Button>
                {isAdvanced && players.length > 0 ? (
                  <Stack>
                    <SectionTitle eyebrow="Buchung" title="Verlust mit Notiz" />
                    <Field label="Spieler">
                      <Select selectedValue={playerId} onValueChange={setPlayerId} items={players.map((player) => ({ value: player.id, label: player.name }))} />
                    </Field>
                    <Field label="Notiz">
                      <Input value={note} onChangeText={setNote} placeholder="Schock Aus, General …" />
                    </Field>
                    <Button onPress={() => recordLoss(playerId, cleanOptionalText(note))}>Verlust mit Notiz buchen</Button>
                  </Stack>
                ) : null}
              </Card>
            ) : null}
          </View>

          <View style={{ flex: isWide ? 1 : undefined, minWidth: 0, gap: spacing.md }}>
            <Card>
              <SectionTitle eyebrow="Aufstellung" title="Wer spielt mit?" aside={<Badge>{presentCount} / {detail.data.attendance.length}</Badge>} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {detail.data.attendance.map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.playerName}: ${row.present ? 'anwesend' : 'abwesend'}`}
                    accessibilityState={{ disabled: isClosed, selected: row.present }}
                    disabled={isClosed}
                    onPress={() => toggleAttendance(row.playerId)}
                    style={({ pressed }) => ({
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: row.present ? colors.accent : colors.border,
                      backgroundColor: row.present ? colors.surfaceSoft : colors.bgElevated,
                      paddingVertical: 10,
                      paddingHorizontal: spacing.sm,
                      opacity: pressed ? 0.65 : row.present ? 1 : 0.65,
                      minHeight: 46,
                      justifyContent: 'center',
                    })}
                  >
                    <Text style={{ color: row.present ? colors.text : colors.muted, fontSize: 13, fontWeight: '800' }}>
                      {row.present ? '●' : '○'} {row.playerName}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {!isClosed ? (
                <View style={{ gap: spacing.sm }}>
                  <Field label="Gast spontan hinzufügen">
                    <Input value={guestName} onChangeText={setGuestName} placeholder="Name des Gasts" returnKeyType="done" />
                  </Field>
                  <Button tone="secondary" onPress={handleGuest} disabled={!guestName.trim()}>＋ Gast hinzufügen</Button>
                </View>
              ) : null}
            </Card>

            {!isClosed && players.length > 0 ? (
              <Card>
                <SectionTitle eyebrow="Sonderposten" title="Bierrunde" aside={<Badge tone="warning">🍺</Badge>} />
                <Field label="Spieler">
                  <Select selectedValue={beerPlayerId} onValueChange={setBeerPlayerId} items={players.map((player) => ({ label: player.name, value: player.id }))} />
                </Field>
                <Field label="Betrag (€)">
                  <Input value={beerAmount} onChangeText={setBeerAmount} keyboardType="decimal-pad" />
                </Field>
                {isAdvanced ? (
                  <Field label="Notiz"><Input value={beerNote} onChangeText={setBeerNote} placeholder="Optional" /></Field>
                ) : null}
                <Button onPress={recordBeerRound}>Bierrunde buchen</Button>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Bierrunden fließen nicht in den Abwesenheitsdurchschnitt ein.</Text>
              </Card>
            ) : null}

            <Card>
              <SectionTitle eyebrow="Live-Feed" title="Letzte Buchungen" />
              {timeline.length ? (
                <Stack>
                  {timeline.slice(0, isWide ? 6 : 10).map((entry) => (
                    <ListRow
                      key={entry.id}
                      title={`${entry.kind === 'beerround' ? '🍺 ' : entry.kind === 'correction' ? '↩ ' : ''}${entry.playerName ?? 'System'}`}
                      detail={entry.message}
                      value={entry.amountCents !== null ? formatCurrency(Math.abs(entry.amountCents)) : undefined}
                    />
                  ))}
                </Stack>
              ) : <EmptyState>Noch keine Buchungen.</EmptyState>}
            </Card>
          </View>
        </View>

        {!isClosed ? (
          <Card>
            <SectionTitle eyebrow="Abschluss" title="Spielabend beenden" aside={<Badge tone="warning">{absentCoreCount} abwesend</Badge>} />
            <Text style={{ color: colors.muted, lineHeight: 21 }}>
              Beim Abschluss werden die vereinbarten Zuschläge für abwesende Stammspieler berechnet. Ein Bestätigungsdialog zeigt dir die Folgen vorher an.
            </Text>
            {presentCoreCount === 0 ? <EmptyState>Aktuell ist kein Stammspieler anwesend – daher entstehen keine automatischen Abwesenheitszuschläge.</EmptyState> : null}
            <Button tone="secondary" onPress={confirmClose}>Spielabend abschließen</Button>
          </Card>
        ) : null}

        <Card>
          <SectionTitle eyebrow="Abrechnung" title="Abwesenheit und Zuschläge" />
          {detail.data.absences.length ? (
            <Stack>
              {detail.data.absences.map((entry) => (
                <ListRow key={entry.id} title={entry.playerName} detail={isAdvanced ? entry.note : undefined} value={formatCurrency(entry.amountCents)} />
              ))}
            </Stack>
          ) : (
            <EmptyState>{isClosed ? 'Für diesen Abend wurden keine Abwesenheitszuschläge gebucht.' : 'Die endgültigen Zuschläge entstehen beim Abschließen.'}</EmptyState>
          )}
        </Card>

        {isAdvanced ? (
          <Card>
            <SectionTitle eyebrow="Protokoll" title="Alle Ereignisse" />
            <Stack>
              {detail.data.timeline.map((entry) => {
                const display = describeHistoryEntry(entry, { hideSessionTitle: true })
                return <ListRow key={entry.id} title={display.title} detail={`${formatDateTime(entry.createdAt)} · ${display.detail}`} value={entry.amountCents !== null ? formatCurrency(entry.amountCents) : undefined} />
              })}
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </Screen>
  )
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 3 }}>
      <Text style={{ color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}
