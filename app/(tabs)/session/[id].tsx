import Ionicons from '@expo/vector-icons/Ionicons'
import * as Sharing from 'expo-sharing'
import { useIsFocused, useLocalSearchParams } from 'expo-router'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { captureRef } from 'react-native-view-shot'

import { BottomSheet } from '@/components/bottom-sheet'
import { BrandEmblem, BrandHero } from '@/components/brand'
import { StepIndicator, type EveningStep } from '@/components/evening-steps'
import { HideNavigationBar, KeepAwakeWhileLive } from '@/components/live-mode'
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
  Split,
  Stack,
  StatCard,
} from '@/components/ui'
import {
  buildEveningSummary,
  describeAbsenceSkipReason,
  formatEveningSummaryText,
  summaryInputFromDetail,
  type EveningSummary,
} from '@/domain/evening-summary'
import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'
import type { AbsencePenaltyMode, HistoryEntry, SessionDetail, ThemeId } from '@/domain/types'
import { cleanOptionalText, parseEuroToCents } from '@/domain/utils'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useTableMode } from '@/hooks/use-table-mode'
import { useRuntime } from '@/providers/runtime-provider'
import { Feedback } from '@/services/haptics'
import { UndoService } from '@/services/undo-service'
import { useUndoToastLift } from '@/components/undo-toast'
import { SessionService } from '@/services/session-service'
import { colors, radius, spacing } from '@/theme/tokens'

const BEER_PRESETS = [500, 1000, 1500]

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function safeParseCents(value: string) {
  try {
    return parseEuroToCents(value)
  } catch {
    return null
  }
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const layout = useTableMode()
  const focused = useIsFocused()
  const resource = useAsyncResource(
    () => ({ detail: SessionService.getSessionDetail(id), settings: SessionService.getSettings() }),
    [runtime.dataVersion, id],
  )
  const [step, setStep] = useState<EveningStep>('live')
  const [sheet, setSheet] = useState<'beer' | 'guest' | null>(null)
  const [stake, setStake] = useState('1,00')
  const [guestName, setGuestName] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [note, setNote] = useState('')
  const [showNoteBooking, setShowNoteBooking] = useState(false)
  const [beerAmount, setBeerAmount] = useState('5,00')
  const [beerPlayerId, setBeerPlayerId] = useState('')
  const [beerNote, setBeerNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const initializedFor = useRef<string | null>(null)
  const resultRef = useRef<View>(null)

  const detailData = resource.data?.detail ?? null
  const currentDetail = detailData && detailData.session.id === id ? detailData : null

  // Pick the starting step once per evening: closed → summary, untouched → attendance.
  useEffect(() => {
    if (!currentDetail || initializedFor.current === id) return
    initializedFor.current = id
    setStep(currentDetail.session.status === 'closed' ? 'summary' : currentDetail.losses.length > 0 ? 'live' : 'attendance')
  }, [currentDetail, id])

  const sessionStake = currentDetail?.session.stakeCents
  useEffect(() => {
    if (sessionStake !== undefined) setStake(centsToInput(sessionStake))
  }, [sessionStake])

  useEffect(() => {
    if (!currentDetail) return
    const available = currentDetail.availablePresentPlayers
    setPlayerId((previous) => (available.some((player) => player.id === previous) ? previous : available[0]?.id ?? ''))
    setBeerPlayerId((previous) => (available.some((player) => player.id === previous) ? previous : available[0]?.id ?? ''))
  }, [currentDetail])

  if ((resource.loading && !currentDetail) || !runtime.account) {
    return <Screen><ActivityIndicator color={colors.accentStrong} size="large" /></Screen>
  }

  if (resource.error) {
    return <Screen><Card><Notice type="error" message={resource.error.message} /><Button onPress={resource.reload}>Erneut versuchen</Button></Card></Screen>
  }

  if (!currentDetail || !resource.data) {
    return <Screen><Card><EmptyState>Spielabend nicht gefunden.</EmptyState></Card></Screen>
  }

  const detail: SessionDetail = currentDetail
  const absenceMode: AbsencePenaltyMode = resource.data.settings.absencePenaltyMode
  const session = detail.session
  const isClosed = session.status === 'closed'
  const isAdvanced = runtime.viewMode === 'advanced'
  const { tableMode, tableColumns, isTablet } = layout
  const normalLosses = detail.losses.filter((loss) => !loss.isBeerRound)
  const totalTodayCents = detail.losses.reduce((total, loss) => total + loss.amountCents, 0)
  const presentCount = detail.attendance.filter((row) => row.present).length
  const absentCoreCount = detail.attendance.filter((row) => !row.present && row.isCore).length
  const players: BoardPlayer[] = detail.availablePresentPlayers.map((player) => {
    const playerLosses = normalLosses.filter((loss) => loss.playerId === player.id)
    return {
      id: player.id,
      name: player.name,
      isCore: player.isCore,
      lossCount: playerLosses.length,
      todayCents: detail.losses.filter((loss) => loss.playerId === player.id).reduce((total, loss) => total + loss.amountCents, 0),
    }
  })
  const timeline = detail.timeline.filter((entry) => entry.kind === 'loss' || entry.kind === 'beerround' || entry.kind === 'correction')
  const summary = buildEveningSummary(summaryInputFromDetail(detail, absenceMode))
  const actor = { accountId: runtime.account.id, username: runtime.account.username }

  function goTo(next: EveningStep) {
    // Leaving the attendance step must not silently drop an edited stake.
    if (step === 'attendance' && next !== 'attendance' && !isClosed && !saveStakeIfChanged()) return
    setSheet(null)
    setStep(next)
  }

  function showError(error: unknown, fallback: string) {
    Feedback.error()
    runtime.setFlash({ type: 'error', message: error instanceof Error ? error.message : fallback })
  }

  function saveStakeIfChanged() {
    const cents = safeParseCents(stake)
    if (cents === null) {
      showError(null, 'Bitte einen gültigen Einsatz eingeben.')
      return false
    }
    if (cents === session.stakeCents) return true
    try {
      SessionService.updateSessionStake({ actor, sessionId: session.id, stakeCents: cents })
      runtime.bumpDataVersion()
      runtime.setFlash({ type: 'success', message: `Einsatz auf ${formatCurrency(cents)} gesetzt.` })
      return true
    } catch (error) {
      showError(error, 'Einsatz konnte nicht aktualisiert werden.')
      return false
    }
  }

  function adjustStake(delta: number) {
    const current = safeParseCents(stake) ?? session.stakeCents
    setStake(centsToInput(Math.max(10, current + delta)))
    Feedback.tap()
  }

  function startEvening() {
    if (!saveStakeIfChanged()) return
    Feedback.success()
    setSheet(null)
    setStep('live')
  }

  function closeSession() {
    try {
      setClosing(true)
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
      setStep('summary')
    } catch (error) {
      showError(error, 'Spielabend konnte nicht abgeschlossen werden.')
    } finally {
      setClosing(false)
    }
  }

  function confirmClose() {
    Alert.alert(
      'Spielabend abschließen?',
      `Es werden ${formatCurrency(summary.absenceCents)} Abwesenheitszuschläge gebucht. Danach sind keine Buchungen mehr möglich.`,
      [
        { text: 'Weiterspielen', style: 'cancel' },
        { text: 'Abschließen', style: 'destructive', onPress: closeSession },
      ],
    )
  }

  function handleGuest() {
    try {
      SessionService.addGuestToSession({ actor, sessionId: session.id, name: guestName.trim() })
      Feedback.success()
      runtime.bumpDataVersion()
      setGuestName('')
      setSheet((current) => (current === 'guest' ? null : current))
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
      // Only drop the pending undo if it belongs to this player's booking.
      if (UndoService.getPendingUndo()?.playerId === targetPlayerId) runtime.cancelUndo()
      runtime.setFlash({ type: 'success', message: 'Letzter Verlust storniert.' })
    } catch (error) {
      showError(error, 'Verlust konnte nicht storniert werden.')
    }
  }

  function toggleAttendance(targetPlayerId: string) {
    try {
      SessionService.toggleAttendance({ actor, sessionId: session.id, playerId: targetPlayerId })
      Feedback.tap()
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
      Feedback.booked()
      runtime.bumpDataVersion()
      setBeerNote('')
      setSheet((current) => (current === 'beer' ? null : current))
      runtime.scheduleUndo({ type: 'beerround', sessionId: session.id, playerId: beerPlayerId, entryId, label: 'Bierrunde gebucht' })
    } catch (error) {
      showError(error, 'Bierrunde konnte nicht gebucht werden.')
    }
  }

  const summaryText = formatEveningSummaryText(summary, { title: session.title, dateLabel: formatDate(session.startedAt) })

  async function shareAsText() {
    try {
      await Share.share({ message: summaryText, title: session.title })
    } catch (error) {
      showError(error, 'Teilen fehlgeschlagen.')
    }
  }

  async function shareAsImage() {
    setSharing(true)
    try {
      const uri = await captureRef(resultRef, { format: 'png', quality: 1, result: 'tmpfile' })
      if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen nicht verfügbar')
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${session.title} teilen`, UTI: 'public.png' })
    } catch {
      // Screenshot or share sheet unavailable: fall back to plain text.
      await shareAsText()
    } finally {
      setSharing(false)
    }
  }

  const attendanceCard = (
    <Card>
      <SectionTitle eyebrow="Aufstellung" title="Wer ist da?" aside={<Badge>{presentCount} / {detail.attendance.length}</Badge>} />
      <AttendanceChips attendance={detail.attendance} disabled={isClosed} onToggle={toggleAttendance} />
      {absentCoreCount > 0 && !isClosed ? (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
          {absentCoreCount} {absentCoreCount === 1 ? 'Stammspieler fehlt' : 'Stammspieler fehlen'} – {describeMode(absenceMode)}
        </Text>
      ) : null}
    </Card>
  )

  const guestCard = !isClosed ? (
    <Card>
      <SectionTitle eyebrow="Spontan dabei" title="Gast hinzufügen" />
      <GuestForm value={guestName} onChange={setGuestName} onSubmit={handleGuest} />
    </Card>
  ) : null

  const beerForm = (
    <BeerRoundForm
      players={players}
      playerId={beerPlayerId}
      onPlayer={setBeerPlayerId}
      amount={beerAmount}
      onAmount={setBeerAmount}
      note={beerNote}
      onNote={setBeerNote}
      showNote={isAdvanced}
      onSubmit={recordBeerRound}
    />
  )

  const board = (
    <Card>
      <PlayerBoard
        players={players}
        stakeCents={session.stakeCents}
        isClosed={isClosed}
        onAdd={(targetId) => recordLoss(targetId, null)}
        onRemove={removeLastLoss}
        columns={tableMode ? Math.min(tableColumns, Math.max(players.length, 1)) : undefined}
        dense={tableMode}
        swipeToVoid={!tableMode}
      />
    </Card>
  )

  const noteBooking = isAdvanced && !isClosed && players.length > 0 ? (
    <Card>
      <Pressable accessibilityRole="button" onPress={() => setShowNoteBooking((value) => !value)}>
        <SectionTitle eyebrow="Buchung" title="Verlust mit Notiz" aside={<Ionicons name={showNoteBooking ? 'chevron-up' : 'chevron-down'} size={22} color={colors.muted} />} />
      </Pressable>
      {showNoteBooking ? (
        <Stack>
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
  ) : null

  const metrics = isTablet && !tableMode ? (
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
  )

  const showActionBar = step === 'live' && !tableMode
  const liveActive = focused && step === 'live' && !isClosed

  return (
    <>
      {liveActive ? <KeepAwakeWhileLive /> : null}
      {liveActive && tableMode ? <HideNavigationBar /> : null}
      <Screen
        footer={showActionBar ? (
          <ActionBar
            isClosed={isClosed}
            canBook={players.length > 0}
            onBeer={() => setSheet('beer')}
            onGuest={() => setSheet('guest')}
            onFinish={() => goTo('summary')}
          />
        ) : null}
      >
        <Stack>
          {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

          {tableMode && step === 'live' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <BrandEmblem size={44} themeId={runtime.themeId} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }} numberOfLines={1}>{session.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {presentCount} am Tisch · {normalLosses.length} Verluste · {formatCurrency(totalTodayCents)}
                </Text>
              </View>
              <View style={{ width: 460 }}><StepIndicator step={step} onChange={goTo} /></View>
            </View>
          ) : (
            <>
              <BrandHero
                themeId={runtime.themeId}
                title={session.title}
                subtitle={`Seit ${formatDateTime(session.startedAt)}${session.closedAt ? ` · Ende ${formatDateTime(session.closedAt)}` : ''}`}
                aside={<Badge tone={isClosed ? 'default' : 'success'}>{isClosed ? 'ABGESCHLOSSEN' : '● LIVE'}</Badge>}
              />
              <StepIndicator step={step} onChange={goTo} />
            </>
          )}

          {step === 'attendance' ? (
            <Animated.View key="attendance" entering={FadeIn.duration(200)} style={{ gap: spacing.md }}>
              <Split>
                {attendanceCard}
                <Stack>
                  {guestCard}
                  {!isClosed ? (
                    <Card>
                      <SectionTitle eyebrow="Einsatz" title="Pro Verlust" />
                      <StakeStepper value={stake} onChange={setStake} onAdjust={adjustStake} />
                    </Card>
                  ) : null}
                </Stack>
              </Split>
              {isClosed ? (
                <Button onPress={() => goTo('live')}>Zum Brett →</Button>
              ) : (
                <Button onPress={startEvening} disabled={presentCount === 0}>
                  {presentCount === 0 ? 'Mindestens einen Spieler auswählen' : `Los geht's – ${presentCount} am Tisch →`}
                </Button>
              )}
            </Animated.View>
          ) : null}

          {step === 'live' && tableMode ? (
            <Animated.View key="live-table" entering={FadeIn.duration(200)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>
                {attendanceCard}
                {guestCard}
              </View>
              <View style={{ flex: 2.1, minWidth: 0, gap: spacing.md }}>
                {board}
                {noteBooking}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>
                {!isClosed && players.length > 0 ? (
                  <Card>
                    <SectionTitle eyebrow="Sonderposten" title="Bierrunde" aside={<Badge tone="warning">🍺</Badge>} />
                    {beerForm}
                  </Card>
                ) : null}
                <LiveFeed timeline={timeline} limit={8} />
                <Button tone="secondary" onPress={() => goTo('summary')}>{isClosed ? 'Zur Zusammenfassung →' : 'Zum Abschluss →'}</Button>
              </View>
            </Animated.View>
          ) : null}

          {step === 'live' && !tableMode ? (
            <Animated.View key="live" entering={FadeIn.duration(200)} style={{ gap: spacing.md }}>
              {metrics}
              {board}
              {noteBooking}
              <LiveFeed timeline={timeline} limit={10} />
            </Animated.View>
          ) : null}

          {step === 'summary' ? (
            <Animated.View key="summary" entering={FadeIn.duration(200)} style={{ gap: spacing.md }}>
              {isClosed ? (
                <>
                  <ResultCard ref={resultRef} summary={summary} title={session.title} dateLabel={formatDate(session.startedAt)} themeId={runtime.themeId} />
                  <Split>
                    <Button onPress={shareAsImage} disabled={sharing}>{sharing ? 'Bild wird erstellt…' : 'Teilen'}</Button>
                    <Button tone="secondary" onPress={shareAsText}>Als Text teilen</Button>
                  </Split>
                </>
              ) : (
                <>
                  <Card>
                    <SectionTitle eyebrow="Vorschau" title="So endet der Abend" aside={<Badge tone="warning">Noch offen</Badge>} />
                    <SummaryBody summary={summary} />
                  </Card>
                  <Split>
                    <Button tone="secondary" onPress={() => goTo('live')}>← Weiterspielen</Button>
                    <Button onPress={confirmClose} disabled={closing}>{closing ? 'Schließe ab…' : 'Abend abschließen'}</Button>
                  </Split>
                </>
              )}

              {isAdvanced ? (
                <Card>
                  <SectionTitle eyebrow="Protokoll" title="Alle Ereignisse" />
                  <Stack>
                    {detail.timeline.map((entry) => {
                      const display = describeHistoryEntry(entry, { hideSessionTitle: true })
                      return <ListRow key={entry.id} title={display.title} detail={`${formatDateTime(entry.createdAt)} · ${display.detail}`} value={entry.amountCents !== null ? formatCurrency(entry.amountCents) : undefined} />
                    })}
                  </Stack>
                </Card>
              ) : null}
            </Animated.View>
          ) : null}
        </Stack>
      </Screen>

      <BottomSheet visible={sheet === 'beer'} onClose={() => setSheet(null)} eyebrow="Sonderposten" title="Bierrunde buchen">
        {beerForm}
      </BottomSheet>
      <BottomSheet visible={sheet === 'guest'} onClose={() => setSheet(null)} eyebrow="Spontan dabei" title="Gast hinzufügen">
        <GuestForm value={guestName} onChange={setGuestName} onSubmit={handleGuest} autoFocus />
      </BottomSheet>
    </>
  )
}

function describeMode(mode: AbsencePenaltyMode) {
  switch (mode) {
    case 'none':
      return 'laut Hausregel ohne Zuschlag.'
    case 'split_absent':
      return 'sie teilen sich beim Abschluss den Durchschnitt der Anwesenden.'
    default:
      return 'jeder zahlt beim Abschluss den Durchschnitt der Anwesenden.'
  }
}

function Chip({ label, selected, disabled, onPress, accessibilityLabel }: {
  label: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.surfaceSoft : colors.bgElevated,
        paddingVertical: 10,
        paddingHorizontal: spacing.sm,
        opacity: pressed ? 0.65 : selected ? 1 : 0.65,
        minHeight: 46,
        justifyContent: 'center',
      })}
    >
      <Text style={{ color: selected ? colors.text : colors.muted, fontSize: 13, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )
}

function AttendanceChips({ attendance, disabled, onToggle }: {
  attendance: SessionDetail['attendance']
  disabled: boolean
  onToggle: (playerId: string) => void
}) {
  const regulars = attendance.filter((row) => row.isCore)
  const guests = attendance.filter((row) => !row.isCore)
  const renderRow = (row: SessionDetail['attendance'][number]) => (
    <Chip
      key={row.id}
      label={`${row.present ? '●' : '○'} ${row.playerName}`}
      accessibilityLabel={`${row.playerName}: ${row.present ? 'anwesend' : 'abwesend'}`}
      selected={row.present}
      disabled={disabled}
      onPress={() => onToggle(row.playerId)}
    />
  )
  return (
    <View style={{ gap: spacing.sm }}>
      {regulars.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{regulars.map(renderRow)}</View>
      ) : (
        <EmptyState>Noch keine Stammspieler angelegt.</EmptyState>
      )}
      {guests.length ? (
        <>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>GÄSTE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{guests.map(renderRow)}</View>
        </>
      ) : null}
    </View>
  )
}

function GuestForm({ value, onChange, onSubmit, autoFocus }: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  autoFocus?: boolean
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Field label="Name des Gasts">
        <Input
          value={value}
          onChangeText={onChange}
          placeholder="z. B. Onkel Heinz"
          returnKeyType="done"
          autoFocus={autoFocus}
          onSubmitEditing={() => { if (value.trim()) onSubmit() }}
        />
      </Field>
      <Button tone="secondary" onPress={onSubmit} disabled={!value.trim()}>＋ Gast hinzufügen</Button>
    </View>
  )
}

function StakeStepper({ value, onChange, onAdjust }: { value: string; onChange: (value: string) => void; onAdjust: (delta: number) => void }) {
  const stepButton = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={delta > 0 ? 'Einsatz erhöhen' : 'Einsatz verringern'}
      onPress={() => onAdjust(delta)}
      style={({ pressed }) => ({
        width: 52, height: 52, borderRadius: radius.pill,
        backgroundColor: pressed ? colors.accent : colors.surfaceSoft, borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      })}
    >
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.accentStrong }}>{label}</Text>
    </Pressable>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      {stepButton('−', -50)}
      <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" style={{ flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900' }} />
      {stepButton('＋', 50)}
    </View>
  )
}

function BeerRoundForm(props: {
  players: BoardPlayer[]
  playerId: string
  onPlayer: (id: string) => void
  amount: string
  onAmount: (value: string) => void
  note: string
  onNote: (value: string) => void
  showNote: boolean
  onSubmit: () => void
}) {
  if (props.players.length === 0) return <EmptyState>Noch niemand am Tisch.</EmptyState>
  const selected = props.players.find((player) => player.id === props.playerId)
  return (
    <View style={{ gap: spacing.md }}>
      <Field label="Wer gibt die Runde?">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {props.players.map((player) => (
            <Chip key={player.id} label={player.name} selected={player.id === props.playerId} onPress={() => props.onPlayer(player.id)} />
          ))}
        </View>
      </Field>
      <Field label="Betrag (€)">
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {BEER_PRESETS.map((cents) => (
            <Chip key={cents} label={formatCurrency(cents)} selected={safeParseCents(props.amount) === cents} onPress={() => props.onAmount(centsToInput(cents))} />
          ))}
        </View>
        <Input value={props.amount} onChangeText={props.onAmount} keyboardType="decimal-pad" />
      </Field>
      {props.showNote ? <Field label="Notiz"><Input value={props.note} onChangeText={props.onNote} placeholder="Optional" /></Field> : null}
      <Button onPress={props.onSubmit} disabled={!selected}>🍺 Bierrunde{selected ? ` für ${selected.name}` : ''} buchen</Button>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Bierrunden fließen nicht in den Abwesenheitsdurchschnitt ein.</Text>
    </View>
  )
}

function LiveFeed({ timeline, limit }: { timeline: HistoryEntry[]; limit: number }) {
  return (
    <Card>
      <SectionTitle eyebrow="Live-Feed" title="Letzte Buchungen" />
      {timeline.length ? (
        <Stack>
          {timeline.slice(0, limit).map((entry) => (
            <Animated.View key={entry.id} entering={FadeInDown.duration(220)}>
              <ListRow
                title={`${entry.kind === 'beerround' ? '🍺 ' : entry.kind === 'correction' ? '↩ ' : ''}${entry.playerName ?? 'System'}`}
                detail={entry.message}
                value={entry.amountCents !== null ? formatCurrency(Math.abs(entry.amountCents)) : undefined}
              />
            </Animated.View>
          ))}
        </Stack>
      ) : <EmptyState>Noch keine Buchungen.</EmptyState>}
    </Card>
  )
}

function ActionBar({ isClosed, canBook, onBeer, onGuest, onFinish }: {
  isClosed: boolean
  canBook: boolean
  onBeer: () => void
  onGuest: () => void
  onFinish: () => void
}) {
  useUndoToastLift(76)
  const iconButton = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => { Feedback.tap(); onPress() }}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceSoft,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.accentStrong} />
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: colors.tabBar,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      {!isClosed ? iconButton('beer', 'Bierrunde', onBeer, !canBook) : null}
      {!isClosed ? iconButton('person-add', 'Gast', onGuest, false) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isClosed ? 'Zur Zusammenfassung' : 'Zum Abschluss'}
        onPress={() => { Feedback.tap(); onFinish() }}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 52,
          borderRadius: radius.md,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <Text style={{ color: colors.buttonPrimaryText, fontWeight: '900', fontSize: 15 }}>{isClosed ? 'Zusammenfassung →' : 'Abschließen →'}</Text>
      </Pressable>
    </View>
  )
}

function SummaryBody({ summary }: { summary: EveningSummary }) {
  const maxLosses = Math.max(1, ...summary.ranking.map((player) => player.lossCount))
  const skip = describeAbsenceSkipReason(summary.absenceSkipReason)

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text style={{ fontSize: 34 }}>🐦</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '900', letterSpacing: 1.8 }}>PECHVOGEL DES ABENDS</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '900' }}>
            {summary.pechvogel ? summary.pechvogel.names.join(' & ') : 'Niemand – blütenweiße Weste!'}
          </Text>
          {summary.pechvogel ? (
            <Text style={{ color: colors.muted }}>{summary.pechvogel.lossCount} {summary.pechvogel.lossCount === 1 ? 'Verlust' : 'Verluste'}</Text>
          ) : null}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>AM TISCH</Text>
        {summary.ranking.length ? summary.ranking.map((player) => (
          <View key={player.playerId} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ flex: 1, color: colors.text, fontWeight: '800' }} numberOfLines={1}>
                {player.playerName}{player.isCore ? '' : ' (Gast)'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {player.lossCount}×{player.beerRoundCount ? ` · ${player.beerRoundCount}× 🍺` : ''}
              </Text>
              <Text style={{ color: colors.text, fontWeight: '900', minWidth: 76, textAlign: 'right' }}>{formatCurrency(player.totalCents)}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSoft, overflow: 'hidden' }}>
              <View style={{ width: `${(player.lossCount / maxLosses) * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
            </View>
          </View>
        )) : <EmptyState>Niemand war anwesend.</EmptyState>}
      </View>

      {summary.absentCore.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>
            {summary.isFinal ? 'ABWESEND – GEBUCHT' : 'ABWESEND – WIRD BEIM ABSCHLUSS GEBUCHT'}
          </Text>
          {summary.absentCore.map((player) => (
            <ListRow key={player.playerId} title={player.playerName} value={formatCurrency(player.absenceCents)} />
          ))}
          {skip ? <Text style={{ color: colors.muted, fontSize: 13 }}>{skip}</Text> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <CompactMetric label="VERLUSTE" value={`${summary.lossCount} · ${formatCurrency(summary.lossCents)}`} />
        <CompactMetric label="BIERRUNDEN" value={`${summary.beerRoundCount} · ${formatCurrency(summary.beerRoundCents)}`} />
        <CompactMetric label="ABWESENHEIT" value={formatCurrency(summary.absenceCents)} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text style={{ color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 12 }}>GESAMT</Text>
        <Text style={{ color: colors.accentStrong, fontWeight: '900', fontSize: 26 }}>{formatCurrency(summary.totalCents)}</Text>
      </View>
    </View>
  )
}

const ResultCard = forwardRef<View, { summary: EveningSummary; title: string; dateLabel: string; themeId: ThemeId }>(function ResultCard(
  { summary, title, dateLabel, themeId },
  ref,
) {
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated, padding: spacing.lg, gap: spacing.md, overflow: 'hidden' }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: colors.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <BrandEmblem size={52} themeId={themeId} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>ERGEBNIS · {dateLabel.toUpperCase()}</Text>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }} numberOfLines={2}>{title}</Text>
        </View>
      </View>
      <SummaryBody summary={summary} />
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>Schockboard</Text>
    </View>
  )
})

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 90, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 3 }}>
      <Text style={{ color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}
