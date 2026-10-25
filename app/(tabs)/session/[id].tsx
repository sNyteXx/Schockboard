import Ionicons from '@expo/vector-icons/Ionicons'
import * as Sharing from 'expo-sharing'
import { LinearGradient } from 'expo-linear-gradient'
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Share, Text, View } from 'react-native'
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated'
import { captureRef } from 'react-native-view-shot'

import { PlayerAvatar } from '@/components/avatar'
import { BottomSheet } from '@/components/bottom-sheet'
import { BrandEmblem } from '@/components/brand'
import { BarChart, type BarDatum } from '@/components/charts'
import { StepIndicator, type EveningStep } from '@/components/evening-steps'
import { HideNavigationBar, KeepAwakeWhileLive } from '@/components/live-mode'
import { enterFade, PressableScale } from '@/components/motion'
import { PlayerBoard, type BoardPlayer } from '@/components/player-board'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListRow,
  LoadError,
  Notice,
  Screen,
  ScreenHeader,
  Select,
  SkeletonScreen,
  Split,
  Stack,
  StatTile,
  type IconName,
} from '@/components/ui'
import { useUndoToastLift } from '@/components/undo-toast'
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
import { SessionService } from '@/services/session-service'
import { UndoService } from '@/services/undo-service'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles, useTheme } from '@/theme/use-theme'

const BEER_PRESETS = [500, 1000, 1500]
const enterStep = FadeIn.duration(200).reduceMotion(ReduceMotion.System)

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

const useStyles = themedStyles(({ c, t }) => ({
  muted: { ...t.body, color: c.muted },
  hint: { ...t.caption, color: c.subtle },
  overline: { ...t.overline, color: c.subtle },
  stakeInput: { ...t.numeric, flex: 1, textAlign: 'center', color: c.text },
  heroIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent },
  heroName: { ...t.title, color: c.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  total: { ...t.numericLg, color: c.accentStrong },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...t.caption, color: c.muted },
  feedIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: c.tabBar,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  result: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.bgElevated, padding: spacing.lg, gap: spacing.md, overflow: 'hidden' },
  resultTitle: { ...t.title, color: c.text },
  resultOverline: { ...t.overline, color: c.accentStrong },
  resultFooter: { ...t.caption, color: c.subtle, textAlign: 'center' },
}))

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const router = useRouter()
  const layout = useTableMode()
  const focused = useIsFocused()
  const styles = useStyles()
  const resource = useAsyncResource(
    () => ({ detail: SessionService.getSessionDetail(id), settings: SessionService.getSettings() }),
    [runtime.dataVersion, id],
  )
  const [step, setStep] = useState<EveningStep>('live')
  const [sheet, setSheet] = useState<'beer' | 'guest' | 'menu' | null>(null)
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
  const absenceMode: AbsencePenaltyMode = resource.data?.settings.absencePenaltyMode ?? 'full_average'

  // Derived data is memoised on the loaded detail so typing in a form or
  // toggling a sheet never recomputes the board or the summary.
  const derived = useMemo(() => {
    if (!currentDetail) return null
    const normalLosses = currentDetail.losses.filter((loss) => !loss.isBeerRound)
    const players: BoardPlayer[] = currentDetail.availablePresentPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      isCore: player.isCore,
      lossCount: normalLosses.reduce((count, loss) => count + (loss.playerId === player.id ? 1 : 0), 0),
      todayCents: currentDetail.losses.reduce((total, loss) => total + (loss.playerId === player.id ? loss.amountCents : 0), 0),
    }))
    return {
      normalLossCount: normalLosses.length,
      totalTodayCents: currentDetail.losses.reduce((total, loss) => total + loss.amountCents, 0),
      presentCount: currentDetail.attendance.filter((row) => row.present).length,
      absentCoreCount: currentDetail.attendance.filter((row) => !row.present && row.isCore && !row.isArchived).length,
      players,
      // Storno receipts (0 €) are bookkeeping noise in the live feed.
      timeline: currentDetail.timeline.filter(
        (entry) => entry.kind === 'loss' || entry.kind === 'beerround' || (entry.kind === 'correction' && entry.amountCents !== 0)
      ),
      summary: buildEveningSummary(summaryInputFromDetail(currentDetail, absenceMode)),
    }
  }, [currentDetail, absenceMode])

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

  if (resource.error && !currentDetail) return <LoadError error={resource.error} onRetry={resource.reload} />

  if ((resource.loading && !currentDetail) || !runtime.account) {
    return <SkeletonScreen variant="board" />
  }

  if (!currentDetail || !resource.data || !derived) {
    return (
      <Screen maxWidth={720}>
        <Card>
          <EmptyState icon="search-outline" title="Spielabend nicht gefunden">Der Abend wurde gelöscht oder ersetzt.</EmptyState>
        </Card>
      </Screen>
    )
  }

  const detail: SessionDetail = currentDetail
  const session = detail.session
  const isClosed = session.status === 'closed'
  const isAdvanced = runtime.viewMode === 'advanced'
  const { tableMode, tableColumns, isTablet } = layout
  const { players, timeline, summary, presentCount, absentCoreCount, totalTodayCents, normalLossCount } = derived
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

  function cancelEvening() {
    try {
      runtime.cancelUndo()
      SessionService.cancelSession({ actor, sessionId: session.id })
      Feedback.error()
      setSheet(null)
      // Leave first so this screen never renders the deleted evening.
      router.navigate('/(tabs)/sessions')
      runtime.bumpDataVersion()
      runtime.setFlash({ type: 'success', message: 'Spielabend abgebrochen.' })
    } catch (error) {
      showError(error, 'Spielabend konnte nicht abgebrochen werden.')
    }
  }

  function confirmCancel() {
    const count = detail.losses.length
    Feedback.tap()
    Alert.alert(
      'Spielabend abbrechen?',
      count === 0
        ? `„${session.title}“ wird verworfen. Es wurden noch keine Buchungen erfasst.`
        : `„${session.title}“ wird verworfen – ${count === 1 ? '1 Buchung' : `${count} Buchungen`} (${formatCurrency(totalTodayCents)}, inkl. Bierrunden) werden gelöscht. Es werden keine Abwesenheitszuschläge gebucht, Zahlungen bleiben erhalten. Das kann nicht rückgängig gemacht werden.`,
      [
        { text: 'Weiterspielen', style: 'cancel' },
        { text: 'Abend abbrechen', style: 'destructive', onPress: cancelEvening },
      ],
    )
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
      <CardHeader icon="people" overline="Aufstellung" title="Wer ist da?" aside={<Badge tone={presentCount > 0 ? 'accent' : 'default'}>{`${presentCount} / ${detail.attendance.length}`}</Badge>} />
      <AttendanceChips attendance={detail.attendance} disabled={isClosed} onToggle={toggleAttendance} />
      {absentCoreCount > 0 && !isClosed ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={16} color={colors.subtle} style={{ marginTop: 1 }} />
          <Text style={[styles.hint, { flex: 1 }]}>
            {absentCoreCount} {absentCoreCount === 1 ? 'Stammspieler fehlt' : 'Stammspieler fehlen'} – {describeMode(absenceMode)}
          </Text>
        </View>
      ) : null}
    </Card>
  )

  const guestCard = !isClosed ? (
    <Card>
      <CardHeader icon="person-add" overline="Spontan dabei" title="Gast hinzufügen" />
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
  )

  const noteBooking = isAdvanced && !isClosed && players.length > 0 ? (
    <Card>
      <PressableScale accessibilityRole="button" accessibilityState={{ expanded: showNoteBooking }} pressedScale={0.99} onPress={() => setShowNoteBooking((value) => !value)}>
        <CardHeader icon="create-outline" overline="Buchung" title="Verlust mit Notiz" aside={<Ionicons name={showNoteBooking ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />} />
      </PressableScale>
      {showNoteBooking ? (
        <Stack>
          <Field label="Spieler">
            <Select selectedValue={playerId} onValueChange={setPlayerId} items={players.map((player) => ({ value: player.id, label: player.name }))} />
          </Field>
          <Field label="Notiz">
            <Input value={note} onChangeText={setNote} placeholder="Schock Aus, General …" />
          </Field>
          <Button icon="add" onPress={() => recordLoss(playerId, cleanOptionalText(note))}>Verlust mit Notiz buchen</Button>
        </Stack>
      ) : null}
    </Card>
  ) : null

  const metrics = (
    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
      <StatTile icon="people" label="Am Tisch" value={`${presentCount}`} hint={isTablet ? 'Spieler anwesend' : undefined} />
      <StatTile icon="trending-up" label="Verluste" value={`${normalLossCount}`} hint={isTablet ? `${formatCurrency(session.stakeCents)} je Verlust` : undefined} />
      <StatTile icon="cash-outline" tone="accent" label="Heute" value={formatCurrency(totalTodayCents)} hint={isTablet ? 'inkl. Bierrunden' : undefined} />
    </View>
  )

  const showActionBar = step === 'live' && !tableMode
  const liveActive = focused && step === 'live' && !isClosed
  const context = [
    `Seit ${formatDateTime(session.startedAt)}`,
    session.closedAt ? `Ende ${formatDateTime(session.closedAt)}` : null,
    `${presentCount} am Tisch`,
    `${normalLossCount} ${normalLossCount === 1 ? 'Verlust' : 'Verluste'}`,
    formatCurrency(totalTodayCents),
  ].filter(Boolean).join(' · ')
  const statusBadge = isClosed ? <Badge icon="checkmark-done">Abgeschlossen</Badge> : <Badge tone="success" dot>LIVE</Badge>
  const wideSummary = isTablet

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
        {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

        <ScreenHeader
          leading={<BrandEmblem size={32} themeId={runtime.themeId} />}
          title={session.title}
          context={context}
          badge={statusBadge}
          actions={
            <>
              {tableMode ? <View style={{ width: 440 }}><StepIndicator step={step} onChange={goTo} /></View> : null}
              {!isClosed ? <IconButton icon="ellipsis-horizontal" accessibilityLabel="Weitere Aktionen" onPress={() => setSheet('menu')} /> : null}
            </>
          }
        />
        {!tableMode ? <StepIndicator step={step} onChange={goTo} /> : null}

        {step === 'attendance' ? (
          <Animated.View key="attendance" entering={enterStep} style={{ gap: spacing.md }}>
            <Split weights={[7, 5]}>
              {attendanceCard}
              <>
                {guestCard}
                {!isClosed ? (
                  <Card>
                    <CardHeader icon="pricetag" overline="Einsatz" title="Pro Verlust" />
                    <StakeStepper value={stake} onChange={setStake} onAdjust={adjustStake} />
                    <Text style={styles.hint}>Gilt für alle Verluste dieses Abends.</Text>
                  </Card>
                ) : null}
              </>
            </Split>
            {isClosed ? (
              <Button size="lg" iconRight="arrow-forward" onPress={() => goTo('live')}>Zum Brett</Button>
            ) : (
              <Button size="lg" iconRight={presentCount === 0 ? undefined : 'arrow-forward'} onPress={startEvening} disabled={presentCount === 0}>
                {presentCount === 0 ? 'Mindestens einen Spieler auswählen' : `Los geht's – ${presentCount} am Tisch`}
              </Button>
            )}
          </Animated.View>
        ) : null}

        {step === 'live' && tableMode ? (
          <Animated.View key="live-table" entering={enterStep} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
            <View style={{ flex: 0.85, minWidth: 0, gap: spacing.md }}>
              {attendanceCard}
              {guestCard}
            </View>
            <View style={{ flex: 2.6, minWidth: 0, gap: spacing.md }}>
              {board}
              {noteBooking}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>
              {!isClosed && players.length > 0 ? (
                <Card>
                  <CardHeader icon="beer" overline="Sonderposten" title="Bierrunde" />
                  {beerForm}
                </Card>
              ) : null}
              <LiveFeed timeline={timeline} limit={8} />
              <Button tone="secondary" iconRight="arrow-forward" onPress={() => goTo('summary')}>{isClosed ? 'Zur Zusammenfassung' : 'Zum Abschluss'}</Button>
            </View>
          </Animated.View>
        ) : null}

        {step === 'live' && !tableMode ? (
          <Animated.View key="live" entering={enterStep} style={{ gap: spacing.md }}>
            {metrics}
            {board}
            {noteBooking}
            <LiveFeed timeline={timeline} limit={10} />
          </Animated.View>
        ) : null}

        {step === 'summary' ? (
          <Animated.View key="summary" entering={enterStep} style={{ gap: spacing.md }}>
            {isClosed ? (
              <>
                <ResultCard ref={resultRef} summary={summary} title={session.title} dateLabel={formatDate(session.startedAt)} themeId={runtime.themeId} wide={wideSummary} />
                <Split>
                  <Button icon="image-outline" onPress={shareAsImage} loading={sharing}>{sharing ? 'Bild wird erstellt…' : 'Als Bild teilen'}</Button>
                  <Button tone="secondary" icon="chatbubble-ellipses-outline" onPress={shareAsText}>Als Text teilen</Button>
                </Split>
              </>
            ) : (
              <>
                <Card>
                  <CardHeader icon="eye-outline" overline="Vorschau" title="So endet der Abend" aside={<Badge tone="warning" icon="time-outline">Noch offen</Badge>} />
                  <SummaryBody summary={summary} wide={wideSummary} />
                </Card>
                <Split>
                  <Button tone="secondary" icon="arrow-back" onPress={() => goTo('live')}>Weiterspielen</Button>
                  <Button icon="flag" onPress={confirmClose} loading={closing}>{closing ? 'Schließe ab…' : 'Abend abschließen'}</Button>
                </Split>
                <View style={{ alignItems: 'center' }}>
                  <Button tone="ghost" size="sm" icon="trash-outline" onPress={confirmCancel} style={{ opacity: 0.85 }}>
                    Abend abbrechen – ohne Abrechnung verwerfen
                  </Button>
                </View>
              </>
            )}

            {isAdvanced ? (
              <Card>
                <CardHeader icon="list" overline="Protokoll" title="Alle Ereignisse" aside={<Badge>{`${detail.timeline.length}`}</Badge>} />
                <View>
                  {detail.timeline.map((entry) => {
                    const display = describeHistoryEntry(entry, { hideSessionTitle: true })
                    return (
                      <ListRow
                        key={entry.id}
                        leading={<FeedIcon kind={entry.kind} />}
                        title={display.title}
                        detail={`${formatDateTime(entry.createdAt)} · ${display.detail}`}
                        value={entry.amountCents !== null ? formatCurrency(entry.amountCents) : undefined}
                      />
                    )
                  })}
                </View>
              </Card>
            ) : null}
          </Animated.View>
        ) : null}
      </Screen>

      <BottomSheet visible={sheet === 'beer'} onClose={() => setSheet(null)} eyebrow="Sonderposten" title="Bierrunde buchen">
        {beerForm}
      </BottomSheet>
      <BottomSheet visible={sheet === 'menu'} onClose={() => setSheet(null)} eyebrow={session.title} title="Weitere Aktionen">
        <Button tone="secondary" icon="flag-outline" onPress={() => goTo('summary')}>Zum Abschluss</Button>
        <Button tone="danger" icon="trash-outline" onPress={confirmCancel}>Abend abbrechen</Button>
        <Text style={styles.hint}>Abbrechen verwirft den Abend samt Verlusten und Bierrunden, ohne Abwesenheitszuschläge. Zahlungen bleiben erhalten.</Text>
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

function AttendanceChips({ attendance, disabled, onToggle }: {
  attendance: SessionDetail['attendance']
  disabled: boolean
  onToggle: (playerId: string) => void
}) {
  const styles = useStyles()
  const regulars = attendance.filter((row) => row.isCore)
  const guests = attendance.filter((row) => !row.isCore)
  const renderRow = (row: SessionDetail['attendance'][number]) => (
    <Chip
      key={row.id}
      label={row.playerName}
      leading={<PlayerAvatar id={row.playerId} name={row.playerName} size={30} muted={!row.present} />}
      icon={row.present ? 'checkmark' : undefined}
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
        <EmptyState icon="people-outline">Noch keine Stammspieler angelegt.</EmptyState>
      )}
      {guests.length ? (
        <>
          <Text style={styles.overline}>Gäste</Text>
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
      <Button tone="secondary" icon="person-add" onPress={onSubmit} disabled={!value.trim()}>Gast hinzufügen</Button>
    </View>
  )
}

function StakeStepper({ value, onChange, onAdjust }: { value: string; onChange: (value: string) => void; onAdjust: (delta: number) => void }) {
  const styles = useStyles()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <IconButton icon="remove" size={48} accessibilityLabel="Einsatz verringern" onPress={() => onAdjust(-50)} color={colors.accentStrong} />
      <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" accessibilityLabel="Einsatz in Euro" style={styles.stakeInput} />
      <IconButton icon="add" size={48} accessibilityLabel="Einsatz erhöhen" onPress={() => onAdjust(50)} color={colors.accentStrong} />
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
  const styles = useStyles()
  if (props.players.length === 0) return <EmptyState icon="people-outline">Noch niemand am Tisch.</EmptyState>
  const selected = props.players.find((player) => player.id === props.playerId)
  return (
    <View style={{ gap: spacing.md }}>
      <Field label="Wer gibt die Runde?">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {props.players.map((player) => (
            <Chip
              key={player.id}
              label={player.name}
              leading={<PlayerAvatar id={player.id} name={player.name} size={28} />}
              selected={player.id === props.playerId}
              onPress={() => props.onPlayer(player.id)}
            />
          ))}
        </View>
      </Field>
      <Field label="Betrag (€)">
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {BEER_PRESETS.map((cents) => (
            <Chip key={cents} label={formatCurrency(cents)} selected={safeParseCents(props.amount) === cents} onPress={() => props.onAmount(centsToInput(cents))} />
          ))}
        </View>
        <Input value={props.amount} onChangeText={props.onAmount} keyboardType="decimal-pad" accessibilityLabel="Betrag in Euro" />
      </Field>
      {props.showNote ? <Field label="Notiz"><Input value={props.note} onChangeText={props.onNote} placeholder="Optional" /></Field> : null}
      <Button icon="beer" onPress={props.onSubmit} disabled={!selected}>{`Bierrunde${selected ? ` für ${selected.name}` : ''} buchen`}</Button>
      <Text style={styles.hint}>Bierrunden fließen nicht in den Abwesenheitsdurchschnitt ein.</Text>
    </View>
  )
}

const FEED_ICONS: Record<HistoryEntry['kind'], { icon: IconName; tone: () => { fg: string; bg: string } }> = {
  loss: { icon: 'remove-circle', tone: () => ({ fg: colors.accentStrong, bg: colors.accentSoft }) },
  beerround: { icon: 'beer', tone: () => ({ fg: colors.warning, bg: colors.warningSoft }) },
  correction: { icon: 'arrow-undo', tone: () => ({ fg: colors.info, bg: colors.surfaceSoft }) },
  absence: { icon: 'person-remove', tone: () => ({ fg: colors.danger, bg: colors.dangerSoft }) },
  payment: { icon: 'wallet', tone: () => ({ fg: colors.success, bg: colors.successSoft }) },
  audit: { icon: 'document-text-outline', tone: () => ({ fg: colors.muted, bg: colors.surfaceSoft }) },
}

function FeedIcon({ kind }: { kind: HistoryEntry['kind'] }) {
  const styles = useStyles()
  const entry = FEED_ICONS[kind] ?? FEED_ICONS.audit
  const tone = entry.tone()
  return (
    <View style={[styles.feedIcon, { backgroundColor: tone.bg }]}>
      <Ionicons name={entry.icon} size={18} color={tone.fg} />
    </View>
  )
}

const FEED_KIND: Partial<Record<HistoryEntry['kind'], string>> = { loss: 'Verlust', beerround: 'Bierrunde', correction: 'Korrektur' }

/** "Verlust · 01:31" (+ note) instead of the stored default text "Verlust geloggt". */
function feedDetail(entry: HistoryEntry) {
  const time = new Date(entry.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const generic = entry.message === 'Verlust geloggt' || entry.message === 'Bierrunde'
  return [FEED_KIND[entry.kind] ?? entry.kind, time, generic ? null : entry.message].filter(Boolean).join(' · ')
}

function LiveFeed({ timeline, limit }: { timeline: HistoryEntry[]; limit: number }) {
  return (
    <Card>
      <CardHeader icon="pulse" overline="Live-Feed" title="Letzte Buchungen" />
      {timeline.length ? (
        <View>
          {timeline.slice(0, limit).map((entry) => (
            <Animated.View key={entry.id} entering={enterFade}>
              <ListRow
                leading={<FeedIcon kind={entry.kind} />}
                title={entry.playerName ?? 'System'}
                detail={feedDetail(entry)}
                value={entry.amountCents !== null ? formatCurrency(Math.abs(entry.amountCents)) : undefined}
                valueTone={entry.kind === 'correction' ? 'muted' : 'default'}
              />
            </Animated.View>
          ))}
        </View>
      ) : <EmptyState icon="time-outline">Noch keine Buchungen.</EmptyState>}
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
  const styles = useStyles()
  return (
    <View style={styles.actionBar}>
      {!isClosed ? (
        <Button tone="secondary" icon="beer" accessibilityLabel="Bierrunde" disabled={!canBook} onPress={() => { Feedback.tap(); onBeer() }}>Bierrunde</Button>
      ) : null}
      {!isClosed ? (
        <Button tone="secondary" icon="person-add" accessibilityLabel="Gast" onPress={() => { Feedback.tap(); onGuest() }}>Gast</Button>
      ) : null}
      <Button
        accessibilityLabel={isClosed ? 'Zur Zusammenfassung' : 'Zum Abschluss'}
        iconRight="arrow-forward"
        onPress={() => { Feedback.tap(); onFinish() }}
        style={{ flex: 1 }}
      >
        {isClosed ? 'Zusammenfassung' : 'Abschließen'}
      </Button>
    </View>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  const styles = useStyles()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}

function SummaryBody({ summary, wide }: { summary: EveningSummary; wide: boolean }) {
  const styles = useStyles()
  const { t } = useTheme()
  const skip = describeAbsenceSkipReason(summary.absenceSkipReason)

  const tonight = useMemo<BarDatum[]>(() => summary.ranking.map((player) => ({
    id: player.playerId,
    label: player.playerName,
    sublabel: [
      `${player.lossCount}×`,
      player.beerRoundCount ? `${player.beerRoundCount}× Bier` : null,
      player.isCore ? null : 'Gast',
    ].filter(Boolean).join(' · '),
    value: player.lossCents,
    secondary: player.beerRoundCents > 0 ? { value: player.beerRoundCents, color: colors.warning } : undefined,
    display: formatCurrency(player.totalCents),
    avatar: { id: player.playerId, name: player.playerName },
  })), [summary])

  const absences = useMemo<BarDatum[]>(() => summary.absentCore.map((player) => ({
    id: player.playerId,
    label: player.playerName,
    value: player.absenceCents,
    display: formatCurrency(player.absenceCents),
    color: colors.danger,
    avatar: { id: player.playerId, name: player.playerName },
  })), [summary])

  const hero = (
    <Card tone="hero" animated={false} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={styles.heroIcon}>
        <Ionicons name={summary.pechvogel ? 'skull' : 'ribbon'} size={26} color={colors.accentStrong} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.overline, { color: colors.accentStrong }]}>Pechvogel des Abends</Text>
        <Text style={styles.heroName} numberOfLines={2}>
          {summary.pechvogel ? summary.pechvogel.names.join(' & ') : 'Niemand – blütenweiße Weste!'}
        </Text>
        {summary.pechvogel ? (
          <Text style={[t.caption, { color: colors.muted }]}>{summary.pechvogel.lossCount} {summary.pechvogel.lossCount === 1 ? 'Verlust' : 'Verluste'}</Text>
        ) : null}
      </View>
    </Card>
  )

  const ranking = (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text style={styles.overline}>Am Tisch</Text>
        {summary.beerRoundCount > 0 ? <Legend items={[{ label: 'Verluste', color: colors.accent }, { label: 'Bierrunden', color: colors.warning }]} /> : null}
      </View>
      {tonight.length ? <BarChart data={tonight} color={colors.muted} /> : <EmptyState icon="people-outline">Niemand war anwesend.</EmptyState>}
    </View>
  )

  const absent = summary.absentCore.length ? (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.overline}>{summary.isFinal ? 'Abwesend – gebucht' : 'Abwesend – wird beim Abschluss gebucht'}</Text>
      <BarChart data={absences} highlightFirst={false} barHeight={6} />
      {summary.absenceMath ? (
        // Spell the rule out with tonight's numbers so nobody has to trust a black box.
        <Text style={styles.hint}>
          {`So wird gerechnet: Verluste der ${summary.absenceMath.presentCoreCount} anwesenden Stammspieler ${formatCurrency(summary.absenceMath.baseCents)} ÷ ${summary.absenceMath.presentCoreCount} = ${formatCurrency(summary.absenceMath.averageCents)} Durchschnitt. `}
          {summary.absenceMath.absentCoreCount > 1 && summary.absenceChargeCents !== summary.absenceMath.averageCents
            ? `Geteilt durch ${summary.absenceMath.absentCoreCount} Abwesende = ${formatCurrency(summary.absenceChargeCents)} pro Person.`
            : `Jeder Abwesende zahlt den vollen Durchschnitt: ${formatCurrency(summary.absenceChargeCents)}.`}
          {' Bierrunden und Gäste zählen nicht mit.'}
        </Text>
      ) : null}
      {skip ? <Text style={styles.hint}>{skip}</Text> : null}
    </View>
  ) : null

  const totals = (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        <StatTile icon="trending-up" label="Verluste" value={formatCurrency(summary.lossCents)} hint={`${summary.lossCount}×`} />
        <StatTile icon="beer" tone="warning" label="Bierrunden" value={formatCurrency(summary.beerRoundCents)} hint={`${summary.beerRoundCount}×`} />
        <StatTile icon="person-remove" tone="danger" label="Abwesenheit" value={formatCurrency(summary.absenceCents)} hint={`${summary.absentCore.length} ${summary.absentCore.length === 1 ? 'Person' : 'Personen'}`} />
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.overline}>Gesamt</Text>
        <Text style={styles.total}>{formatCurrency(summary.totalCents)}</Text>
      </View>
    </View>
  )

  if (wide) {
    return (
      <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: 7, minWidth: 0, gap: spacing.md }}>
          {ranking}
          {absent}
        </View>
        <View style={{ flex: 5, minWidth: 0, gap: spacing.md }}>
          {hero}
          {totals}
        </View>
      </View>
    )
  }

  return (
    <View style={{ gap: spacing.md }}>
      {hero}
      {ranking}
      {absent}
      {totals}
    </View>
  )
}

const ResultCard = forwardRef<View, { summary: EveningSummary; title: string; dateLabel: string; themeId: ThemeId; wide: boolean }>(function ResultCard(
  { summary, title, dateLabel, themeId, wide },
  ref,
) {
  const styles = useStyles()
  return (
    <View ref={ref} collapsable={false} style={styles.result}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.heroFrom, colors.bgElevated]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 0.5 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 160 }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: colors.accent }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <BrandEmblem size={40} themeId={themeId} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.resultOverline}>{`Ergebnis · ${dateLabel}`}</Text>
          <Text style={styles.resultTitle} numberOfLines={2}>{title}</Text>
        </View>
      </View>
      <SummaryBody summary={summary} wide={wide} />
      <Text style={styles.resultFooter}>Schockboard</Text>
    </View>
  )
})
