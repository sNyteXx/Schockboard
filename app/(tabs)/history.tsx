import { ActivityIndicator } from 'react-native'
import { useEffect, useState } from 'react'

import {
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
import { formatDateTime, formatSignedCurrency } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'
import { cleanOptionalText, parseSignedEuroToCents } from '@/domain/utils'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useRuntime } from '@/providers/runtime-provider'
import { CashboxService } from '@/services/cashbox-service'
import { ExportService } from '@/services/export-service'
import { SessionService } from '@/services/session-service'
import { colors } from '@/theme/tokens'

export default function HistoryScreen() {
  const runtime = useRuntime()
  const [playerId, setPlayerId] = useState('')
  const [kind, setKind] = useState<
    'all' | 'loss' | 'beerround' | 'absence' | 'payment' | 'correction' | 'audit'
  >('all')
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

  if (data.loading || !data.data || !runtime.account) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    )
  }

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
      runtime.bumpDataVersion()
      runtime.setFlash({
        type: 'success',
        message: 'Korrektur gebucht.',
      })
      setAmount('')
      setReason('')
      setSessionId('')
    } catch (caught) {
      runtime.setFlash({
        type: 'error',
        message:
          caught instanceof Error ? caught.message : 'Korrektur konnte nicht gebucht werden.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <Stack>
        {runtime.flash ? (
          <Notice message={runtime.flash.message} type={runtime.flash.type} />
        ) : null}
        <Split>
          {isAdvanced ? (
            <Card>
              <SectionTitle eyebrow="Filter" title="Historie durchsuchen" />
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
              <Field label="Typ">
                <Select
                  selectedValue={kind}
                  onValueChange={(value) => setKind(value as typeof kind)}
                  items={[
                    { label: 'Buchungen', value: 'all' },
                    { label: 'Verluste', value: 'loss' },
                    { label: 'Bierrunden', value: 'beerround' },
                    { label: 'Abwesenheit', value: 'absence' },
                    { label: 'Zahlungen', value: 'payment' },
                    { label: 'Korrekturen', value: 'correction' },
                    { label: 'System-Log', value: 'audit' },
                  ]}
                />
              </Field>
              <Button tone="secondary" onPress={() => null}>
                Filter aktiv
              </Button>
            </Card>
          ) : null}

          {isAdvanced ? (
            <Card tone="accent">
              <SectionTitle eyebrow="Append-only" title="Korrektur buchen" />
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
              <Field label="Betrag">
                <Input
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="-2,00 oder 2,00"
                />
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
                <Input
                  multiline
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Warum diese Korrektur nötig ist"
                />
              </Field>
              <Button onPress={handleCorrection} disabled={submitting}>
                {submitting ? 'Speichere…' : 'Korrektur loggen'}
              </Button>
            </Card>
          ) : null}
        </Split>

        <Card>
          <SectionTitle eyebrow="Timeline" title="Letzte 200 Einträge" />
          {isAdvanced ? (
            <Split>
              <Button tone="secondary" onPress={() => void ExportService.shareHistoryCsv()}>
                Historie exportieren
              </Button>
              <Button tone="secondary" onPress={() => void ExportService.shareCashboxCsv()}>
                Kasse exportieren
              </Button>
            </Split>
          ) : null}
          <Stack>
            {data.data.history.length > 0 ? (
              data.data.history.map((entry) => {
                const display = describeHistoryEntry(entry)
                return (
                  <ListRow
                    key={entry.id}
                    title={display.title}
                    detail={[formatDateTime(entry.createdAt), display.detail]
                      .filter(Boolean)
                      .join(' · ')}
                    value={
                      entry.amountCents !== null ? formatSignedCurrency(entry.amountCents) : '—'
                    }
                  />
                )
              })
            ) : (
              <EmptyState>Keine Einträge für die aktuelle Filterung.</EmptyState>
            )}
          </Stack>
        </Card>
      </Stack>
    </Screen>
  )
}
