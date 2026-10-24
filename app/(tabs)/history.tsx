import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'

import {
  AppText,
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  Divider,
  EmptyState,
  Field,
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
  type IconName,
} from '@/components/ui'
import { formatDate, formatSignedCurrency } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'
import type { HistoryEntry } from '@/domain/types'
import { parseSignedEuroToCents } from '@/domain/utils'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { useRuntime } from '@/providers/runtime-provider'
import { CashboxService } from '@/services/cashbox-service'
import { ExportService } from '@/services/export-service'
import { Feedback } from '@/services/haptics'
import { SessionService } from '@/services/session-service'
import { colors, radius, spacing } from '@/theme/tokens'

type Kind = 'all' | 'loss' | 'beerround' | 'absence' | 'payment' | 'correction' | 'audit'

const KINDS: Array<{ value: Kind; label: string; icon: IconName; advanced?: boolean }> = [
  { value: 'all', label: 'Alle Buchungen', icon: 'layers-outline' },
  { value: 'loss', label: 'Verluste', icon: 'remove-circle-outline' },
  { value: 'beerround', label: 'Bierrunden', icon: 'beer-outline' },
  { value: 'absence', label: 'Abwesenheit', icon: 'person-remove-outline' },
  { value: 'payment', label: 'Zahlungen', icon: 'cash-outline' },
  { value: 'correction', label: 'Korrekturen', icon: 'construct-outline' },
  { value: 'audit', label: 'System-Log', icon: 'document-text-outline', advanced: true },
]

const KIND_ICON: Record<HistoryEntry['kind'], { icon: IconName; tone: () => string }> = {
  loss: { icon: 'remove-circle', tone: () => colors.accentStrong },
  beerround: { icon: 'beer', tone: () => colors.warning },
  absence: { icon: 'person-remove', tone: () => colors.danger },
  payment: { icon: 'cash', tone: () => colors.success },
  correction: { icon: 'construct', tone: () => colors.info },
  audit: { icon: 'document-text', tone: () => colors.muted },
}

const timeFormatter = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' })

function KindIcon({ kind }: { kind: HistoryEntry['kind'] }) {
  const def = KIND_ICON[kind]
  return (
    <View style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft }}>
      <Ionicons name={def.icon} size={18} color={def.tone()} />
    </View>
  )
}

export default function HistoryScreen() {
  const runtime = useRuntime()
  const { isTablet } = useDeviceLayout()
  const [playerId, setPlayerId] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [correctionPlayerId, setCorrectionPlayerId] = useState('')
  const [amount, setAmount] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const data = useAsyncResource(
    () => ({
      players: SessionService.listPlayers(),
      sessions: SessionService.listSessions(),
      history: SessionService.getHistoryEntries({
        playerId: playerId || undefined,
        kind,
      }),
    }),
    [runtime.dataVersion, playerId, kind]
  )

  useEffect(() => {
    if (!data.data || correctionPlayerId) {
      return
    }

    setCorrectionPlayerId(data.data.players[0]?.id ?? '')
  }, [correctionPlayerId, data.data])

  const groups = useMemo(() => {
    const result: Array<{ day: string; entries: HistoryEntry[] }> = []
    for (const entry of data.data?.history ?? []) {
      const day = formatDate(entry.createdAt)
      const last = result[result.length - 1]
      if (last && last.day === day) last.entries.push(entry)
      else result.push({ day, entries: [entry] })
    }
    return result
  }, [data.data])

  if (data.error && !data.data) return <LoadError error={data.error} onRetry={data.reload} />

  if (!data.data || !runtime.account) return <SkeletonScreen variant="list" />

  const isAdvanced = runtime.viewMode === 'advanced'

  async function handleCorrection() {
    try {
      setSubmitting(true)
      CashboxService.recordCorrection({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        playerId: correctionPlayerId,
        amountCents: parseSignedEuroToCents(amount),
        reason: reason.trim(),
        sessionId: sessionId || null,
      })
      Feedback.success()
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message: 'Korrektur gebucht.',
      })
      setAmount('')
      setReason('')
      setSessionId('')
    } catch (caught) {
      Feedback.error()
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error ? caught.message : 'Korrektur konnte nicht gebucht werden.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const filters = (
    <Stack gap={spacing.sm}>
      <ScrollView horizontal={!isTablet} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, flexWrap: isTablet ? 'wrap' : 'nowrap', flexDirection: 'row' }}>
        {KINDS.filter((item) => !item.advanced || isAdvanced).map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            icon={item.icon}
            selected={kind === item.value}
            onPress={() => { if (kind !== item.value) { Feedback.tap(); setKind(item.value) } }}
          />
        ))}
      </ScrollView>
      {isAdvanced ? (
        <Field label="Spieler">
          <Select
            selectedValue={playerId}
            onValueChange={setPlayerId}
            items={[
              { label: 'Alle Spieler', value: '' },
              ...data.data.players.map((player) => ({
                label: player.name,
                value: player.id,
              })),
            ]}
          />
        </Field>
      ) : null}
    </Stack>
  )

  const timeline = (
    <Card>
      <CardHeader overline="Timeline" title="Letzte 200 Einträge" icon="time-outline" aside={<Badge>{`${data.data.history.length}`}</Badge>} />
      {groups.length > 0 ? (
        <Stack gap={spacing.md}>
          {groups.map((group, index) => (
            <View key={group.day} style={{ gap: 2 }}>
              {index > 0 ? <Divider style={{ marginBottom: spacing.sm }} /> : null}
              <AppText variant="overline" tone="subtle">{group.day}</AppText>
              {group.entries.map((entry) => {
                const display = describeHistoryEntry(entry)
                return (
                  <ListRow
                    key={entry.id}
                    leading={<KindIcon kind={entry.kind} />}
                    title={display.title}
                    detail={[timeFormatter.format(new Date(entry.createdAt)), display.detail].filter(Boolean).join(' · ')}
                    value={entry.amountCents !== null ? formatSignedCurrency(entry.amountCents) : '—'}
                    valueTone={entry.kind === 'payment' ? 'success' : entry.amountCents === null ? 'subtle' : 'default'}
                  />
                )
              })}
            </View>
          ))}
        </Stack>
      ) : (
        <EmptyState icon="search-outline">Keine Einträge für die aktuelle Filterung.</EmptyState>
      )}
    </Card>
  )

  const side = isAdvanced ? (
    <>
      <Card tone="accent">
        <CardHeader overline="Append-only" title="Korrektur buchen" icon="construct-outline" />
        <Field label="Spieler">
          <Select
            selectedValue={correctionPlayerId}
            onValueChange={setCorrectionPlayerId}
            items={data.data.players.map((player) => ({
              label: player.name,
              value: player.id,
            }))}
          />
        </Field>
        <Field label="Betrag (€)" hint="Negativ = Gutschrift, positiv = zusätzliche Schuld">
          <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="-2,00 oder 2,00" />
        </Field>
        <Field label="Spielabend">
          <Select
            selectedValue={sessionId}
            onValueChange={setSessionId}
            items={[
              { label: 'Ohne Zuordnung', value: '' },
              ...data.data.sessions.map((session) => ({
                label: session.title,
                value: session.id,
              })),
            ]}
          />
        </Field>
        <Field label="Grund">
          <Input multiline value={reason} onChangeText={setReason} placeholder="Warum diese Korrektur nötig ist" />
        </Field>
        <Button icon="checkmark" onPress={handleCorrection} loading={submitting}>Korrektur loggen</Button>
      </Card>
      <Card>
        <CardHeader overline="Export" title="CSV teilen" icon="download-outline" />
        <Button tone="secondary" icon="share-outline" onPress={() => void ExportService.shareHistoryCsv()}>Historie exportieren</Button>
        <Button tone="secondary" icon="share-outline" onPress={() => void ExportService.shareCashboxCsv()}>Kasse exportieren</Button>
      </Card>
    </>
  ) : null

  return (
    <Screen>
      <ScreenHeader title="Chronik" context="Verluste, Bierrunden, Zahlungen, Korrekturen" />
      {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}
      {isTablet ? (
        <Split weights={[8, 4]}>
          {timeline}
          <Stack>
            <Card>
              <CardHeader overline="Filter" title="Ansicht eingrenzen" icon="funnel-outline" />
              {filters}
            </Card>
            {side}
          </Stack>
        </Split>
      ) : (
        <>
          {filters}
          {timeline}
          {side}
        </>
      )}
    </Screen>
  )
}
