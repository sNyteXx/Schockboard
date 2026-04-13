import { useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useEffect, useMemo, useState } from 'react'

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
} from '@/components/ui'
import { formatCurrency, formatDateTime } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'
import { cleanOptionalText, parseEuroToCents } from '@/domain/utils'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useRuntime } from '@/providers/runtime-provider'
import { SessionService } from '@/services/session-service'
import { colors, radius, spacing } from '@/theme/tokens'

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const quickStyles = useQuickStyles()
  const detail = useAsyncResource(
    () => SessionService.getSessionDetail(id),
    [runtime.dataVersion, id]
  )
  const [stake, setStake] = useState('1,00')
  const [guestName, setGuestName] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [note, setNote] = useState('')
  const [beerAmount, setBeerAmount] = useState('5,00')
  const [beerPlayerId, setBeerPlayerId] = useState('')
  const [beerNote, setBeerNote] = useState('')

  useEffect(() => {
    if (!detail.data) {
      return
    }

    setStake((detail.data.session.stakeCents / 100).toFixed(2).replace('.', ','))
    setPlayerId(detail.data.availablePresentPlayers[0]?.id ?? '')
    setBeerPlayerId(detail.data.availablePresentPlayers[0]?.id ?? '')
  }, [detail.data])

  if (detail.loading || !runtime.account) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    )
  }

  if (!detail.data) {
    return (
      <Screen>
        <Card>
          <EmptyState>Spielabend nicht gefunden.</EmptyState>
        </Card>
      </Screen>
    )
  }

  const isClosed = detail.data.session.status === 'closed'
  const presentCoreCount = detail.data.attendance.filter((row) => row.present && row.isCore).length
  const skippedAbsenceCharges = isClosed && presentCoreCount === 0
  const isAdvanced = runtime.viewMode === 'advanced'

  // Count losses per player for showing the minus button
  const lossCountByPlayer: Record<string, number> = {}
  for (const loss of detail.data.losses) {
    lossCountByPlayer[loss.playerId] = (lossCountByPlayer[loss.playerId] ?? 0) + 1
  }

  async function handleStakeUpdate() {
    try {
      SessionService.updateSessionStake({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        stakeCents: parseEuroToCents(stake),
      })
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message: 'Einsatz aktualisiert.',
      })
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error ? caught.message : 'Einsatz konnte nicht aktualisiert werden.',
      })
    }
  }

  async function handleClose() {
    try {
      const result = SessionService.closeSession({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
      })
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message:
          result.reason === 'disabled'
            ? 'Spielabend abgeschlossen. Die Abwesenheitspenalty ist in den Einstellungen deaktiviert.'
            : result.reason === 'no-present-core'
              ? 'Spielabend abgeschlossen. Keine automatischen Zuschläge, weil kein Stammspieler anwesend war.'
              : 'Spielabend abgeschlossen.',
      })
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error
            ? caught.message
            : 'Spielabend konnte nicht abgeschlossen werden.',
      })
    }
  }

  async function handleGuest() {
    try {
      SessionService.addGuestToSession({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        name: guestName.trim(),
      })
      runtime.bumpDataVersion()
      setGuestName('')
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'Gast konnte nicht hinzugefügt werden.',
      })
    }
  }

  async function handleLoss() {
    try {
      SessionService.addLossEntry({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        playerId,
        note: cleanOptionalText(note),
      })
      runtime.bumpDataVersion()
      setNote('')
      runtime.scheduleUndo({
        type: 'loss',
        sessionId: detail.data!.session.id,
        playerId,
        label: 'Verlust gebucht',
      })
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'Verlust konnte nicht gebucht werden.',
      })
    }
  }

  async function handleQuickLoss(targetPlayerId: string) {
    try {
      SessionService.addLossEntry({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        playerId: targetPlayerId,
        note: null,
      })
      runtime.bumpDataVersion()
      runtime.scheduleUndo({
        type: 'loss',
        sessionId: detail.data!.session.id,
        playerId: targetPlayerId,
        label: 'Verlust gebucht',
      })
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'Verlust konnte nicht gebucht werden.',
      })
    }
  }

  async function handleUndoLoss(targetPlayerId: string) {
    try {
      SessionService.deleteLastLoss({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        playerId: targetPlayerId,
      })
      runtime.bumpDataVersion()
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'Verlust konnte nicht gelöscht werden.',
      })
    }
  }

  async function handleToggleAttendance(targetPlayerId: string) {
    try {
      SessionService.toggleAttendance({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        playerId: targetPlayerId,
      })
      runtime.bumpDataVersion()
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error ? caught.message : 'Anwesenheit konnte nicht geändert werden.',
      })
    }
  }

  async function handleBeerRound() {
    try {
      SessionService.addBeerRoundEntry({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        sessionId: detail.data!.session.id,
        playerId: beerPlayerId,
        amountCents: parseEuroToCents(beerAmount),
        note: cleanOptionalText(beerNote),
      })
      runtime.bumpDataVersion()
      setBeerNote('')
      runtime.scheduleUndo({
        type: 'beerround',
        sessionId: detail.data!.session.id,
        playerId: beerPlayerId,
        label: 'Bierrunde gebucht',
      })
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error ? caught.message : 'Bierrunde konnte nicht gebucht werden.',
      })
    }
  }

  return (
    <Screen>
      <Stack>
        {runtime.flash ? (
          <Notice message={runtime.flash.message} type={runtime.flash.type} />
        ) : null}

        <Card tone="accent">
          <SectionTitle
            eyebrow="Spielabend"
            title={detail.data.session.title}
            aside={
              <Badge tone={isClosed ? 'default' : 'success'}>
                {isClosed ? 'Abgeschlossen' : 'Offen'}
              </Badge>
            }
          />
          <Text style={{ color: colors.muted }}>
            Start {formatDateTime(detail.data.session.startedAt)}
            {detail.data.session.closedAt
              ? ` · Ende ${formatDateTime(detail.data.session.closedAt)}`
              : ''}
          </Text>
          {isAdvanced && detail.data.session.notes ? (
            <Text style={{ color: colors.muted }}>{detail.data.session.notes}</Text>
          ) : null}
          <Split>
            <Field label="Einsatz (€)">
              <Input
                value={stake}
                onChangeText={setStake}
                keyboardType="decimal-pad"
                editable={!isClosed}
              />
            </Field>
            <Button tone="secondary" onPress={handleStakeUpdate} disabled={isClosed}>
              Einsatz speichern
            </Button>
          </Split>
          {!isClosed ? (
            <View style={{ gap: 12 }}>
              <Button onPress={handleClose}>Abend abschließen</Button>
              {presentCoreCount === 0 ? (
                <Text style={{ color: colors.muted }}>
                  Gerade ist kein Stammspieler anwesend. Der Abend kann trotzdem geschlossen werden,
                  nur ohne automatische Zuschläge für Abwesende.
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        <Split>
          <Card>
            <SectionTitle eyebrow="Anwesenheit" title="Wer ist heute da?" />
            <Stack>
              {detail.data.attendance.map((row) => (
                <Button
                  key={row.id}
                  tone={row.present ? 'primary' : 'secondary'}
                  onPress={() => void handleToggleAttendance(row.playerId)}
                  disabled={isClosed}
                >
                  {row.playerName} · {row.isCore ? 'Stammrunde' : 'Gast'}
                </Button>
              ))}
            </Stack>
            {!isClosed ? (
              <Stack>
                <Field label="Gast hinzufügen">
                  <Input
                    value={guestName}
                    onChangeText={setGuestName}
                    placeholder="Gast hinzufügen"
                  />
                </Field>
                <Button tone="secondary" onPress={handleGuest}>
                  Gast reinholen
                </Button>
              </Stack>
            ) : null}
          </Card>

          <Card>
            <SectionTitle eyebrow="Verlustlog" title="Schnell buchen" />
            {detail.data.availablePresentPlayers.length > 0 && !isClosed ? (
              <Stack>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  ＋ = {formatCurrency(detail.data.session.stakeCents)} buchen · − = letzten Verlust
                  löschen
                </Text>
                <View style={quickStyles.grid}>
                  {detail.data.availablePresentPlayers.map((player) => (
                    <View key={player.id} style={quickStyles.playerRow}>
                      <Pressable
                        onPress={() => handleUndoLoss(player.id)}
                        disabled={(lossCountByPlayer[player.id] ?? 0) === 0}
                        style={({ pressed }) => [
                          quickStyles.minusButton,
                          (lossCountByPlayer[player.id] ?? 0) === 0 && quickStyles.disabledButton,
                          pressed && quickStyles.quickButtonPressed,
                        ]}
                      >
                        <Text
                          style={[
                            quickStyles.buttonIcon,
                            (lossCountByPlayer[player.id] ?? 0) === 0 && quickStyles.disabledText,
                          ]}
                        >
                          −
                        </Text>
                      </Pressable>
                      <Text style={quickStyles.playerLabel}>
                        {player.name}
                        {(lossCountByPlayer[player.id] ?? 0) > 0
                          ? ` (${lossCountByPlayer[player.id]})`
                          : ''}
                      </Text>
                      <Pressable
                        onPress={() => handleQuickLoss(player.id)}
                        style={({ pressed }) => [
                          quickStyles.plusButton,
                          pressed && quickStyles.quickButtonPressed,
                        ]}
                      >
                        <Text style={quickStyles.buttonIcon}>＋</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
                {isAdvanced ? (
                  <>
                    <Field label="Verlierer">
                      <Select
                        selectedValue={playerId}
                        onValueChange={setPlayerId}
                        items={detail.data.availablePresentPlayers.map((player) => ({
                          label: player.name,
                          value: player.id,
                        }))}
                      />
                    </Field>
                    <Field label="Notiz">
                      <Input
                        value={note}
                        onChangeText={setNote}
                        placeholder="Schock Aus, General …"
                      />
                    </Field>
                    <Button onPress={handleLoss}>Verlust mit Notiz buchen</Button>
                  </>
                ) : null}
              </Stack>
            ) : (
              <EmptyState>
                {isClosed ? 'Der Abend ist abgeschlossen.' : 'Markiere zuerst anwesende Spieler.'}
              </EmptyState>
            )}
            <SectionTitle eyebrow="Letzte Buchungen" title="Verlust- & Korrekturlog" />
            <Stack>
              {detail.data.timeline.filter(
                (e) => e.kind === 'loss' || e.kind === 'beerround' || e.kind === 'correction'
              ).length > 0 ? (
                detail.data.timeline
                  .filter(
                    (e) => e.kind === 'loss' || e.kind === 'beerround' || e.kind === 'correction'
                  )
                  .slice(0, 10)
                  .map((entry) => (
                    <ListRow
                      key={entry.id}
                      title={`${entry.kind === 'correction' ? '↩ ' : entry.kind === 'beerround' ? '🍺 ' : ''}${entry.playerName ?? '–'}`}
                      detail={`${formatDateTime(entry.createdAt)}${entry.message ? ` · ${entry.message}` : ''}`}
                      value={
                        entry.amountCents !== null
                          ? formatCurrency(Math.abs(entry.amountCents))
                          : undefined
                      }
                    />
                  ))
              ) : (
                <EmptyState>Noch keine Buchungen erfasst.</EmptyState>
              )}
            </Stack>
          </Card>
        </Split>

        {!isClosed && detail.data.availablePresentPlayers.length > 0 ? (
          <Card>
            <SectionTitle eyebrow="Sonderposten" title="🍺 Bierrunde" />
            <Stack>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                Bierrunden werden dem Spieler als Schulden zugewiesen, fließen aber nicht in den
                Abwesenheitsdurchschnitt ein.
              </Text>
              <Field label="Spieler">
                <Select
                  selectedValue={beerPlayerId}
                  onValueChange={setBeerPlayerId}
                  items={detail.data.availablePresentPlayers.map((player) => ({
                    label: player.name,
                    value: player.id,
                  }))}
                />
              </Field>
              <Field label="Betrag (€)">
                <Input value={beerAmount} onChangeText={setBeerAmount} keyboardType="decimal-pad" />
              </Field>
              <Field label="Notiz">
                <Input
                  value={beerNote}
                  onChangeText={setBeerNote}
                  placeholder="z. B. Runde für alle"
                />
              </Field>
              <Button onPress={handleBeerRound}>🍺 Bierrunde buchen</Button>
            </Stack>
          </Card>
        ) : null}

        <Split>
          <Card>
            <SectionTitle eyebrow="Abwesenheit" title="Automatische Zuschläge" />
            {detail.data.absences.length > 0 ? (
              <Stack>
                {detail.data.absences.map((absence) => (
                  <ListRow
                    key={absence.id}
                    title={absence.playerName}
                    detail={
                      isAdvanced
                        ? (absence.note ??
                          `${formatCurrency(absence.averageBaseLossCents)} Gesamtverluste ÷ ${absence.averagePresentCoreCount} Stammspieler`)
                        : undefined
                    }
                    value={formatCurrency(absence.amountCents)}
                  />
                ))}
              </Stack>
            ) : skippedAbsenceCharges ? (
              <EmptyState>
                Der Abend wurde ohne anwesenden Stammspieler abgeschlossen. Automatische Zuschläge
                wurden deshalb übersprungen.
              </EmptyState>
            ) : (
              <EmptyState>
                Abwesenheitsbeträge entstehen erst beim Abschließen des Spielabends.
              </EmptyState>
            )}
          </Card>

          {isAdvanced ? (
            <Card>
              <SectionTitle eyebrow="Timeline" title="Alles zum Abend" />
              <Stack>
                {detail.data.timeline.map((entry) => {
                  const display = describeHistoryEntry(entry, { hideSessionTitle: true })
                  const detailText = [
                    display.detail,
                    entry.amountCents !== null ? formatCurrency(entry.amountCents) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <ListRow
                      key={entry.id}
                      title={display.title}
                      detail={`${formatDateTime(entry.createdAt)} · ${detailText}`}
                    />
                  )
                })}
              </Stack>
            </Card>
          ) : null}
        </Split>
      </Stack>
    </Screen>
  )
}

function useQuickStyles() {
  return useMemo(
    () =>
      StyleSheet.create({
        grid: { gap: spacing.sm },
        playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
        minusButton: {
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSoft,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        plusButton: {
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSoft,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        disabledButton: { opacity: 0.3 },
        quickButtonPressed: { backgroundColor: colors.accent, transform: [{ scale: 0.95 }] },
        buttonIcon: { color: colors.accentStrong, fontSize: 20, fontWeight: '800' },
        disabledText: { color: colors.muted },
        playerLabel: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
      }),
    [colors.id]
  )
}
