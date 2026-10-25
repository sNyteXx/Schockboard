import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { PlayerAvatar } from '@/components/avatar'
import { BarChart, LineChart, StackedBar, type BarDatum } from '@/components/charts'
import {
  AppText,
  Badge,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Grid,
  InnerScroll,
  KpiTile,
  LoadError,
  MeasuredFill,
  Screen,
  ScreenHeader,
  Segmented,
  SkeletonScreen,
  Split,
  StatTile,
  Stack,
  type IconName,
} from '@/components/ui'
import { getSeasonLossSeries } from '@/db/chart-queries'
import { getStatistics, type PlayerStats } from '@/db/stats-queries'
import { formatCurrency, formatDate } from '@/domain/format'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { useRuntime } from '@/providers/runtime-provider'
import { Feedback } from '@/services/haptics'
import { colors, playerColor, spacing, withAlpha } from '@/theme/tokens'

type Metric = 'lossCount' | 'lossCents' | 'averageLossCentsPerEvening' | 'eveningsAttended'

const METRICS: Array<{ value: Metric; label: string; format: (row: PlayerStats) => string }> = [
  { value: 'lossCount', label: 'Verluste', format: (row) => `${row.lossCount}` },
  { value: 'lossCents', label: 'Betrag', format: (row) => formatCurrency(row.lossCents) },
  { value: 'averageLossCentsPerEvening', label: 'Ø Abend', format: (row) => formatCurrency(row.averageLossCentsPerEvening) },
  { value: 'eveningsAttended', label: 'Abende', format: (row) => `${row.eveningsAttended}` },
]

/** "24.10." – short x-axis label. */
function shortDate(iso: string) {
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

/** Compact euro axis label: 1250 → "12,5 €", 2000 → "20 €". */
function compactEuro(cents: number) {
  const euros = cents / 100
  return `${euros.toLocaleString('de-DE', { maximumFractionDigits: euros < 10 ? 1 : 0 })} €`
}

export default function StatsScreen() {
  const runtime = useRuntime()
  const { isTablet } = useDeviceLayout()
  const [season, setSeason] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('lossCount')
  const data = useAsyncResource(
    () => ({ ...getStatistics(season), timeline: getSeasonLossSeries(season, shortDate) }),
    [runtime.dataVersion, season]
  )

  const derived = useMemo(() => {
    if (!data.data) return null
    const { stats, timeline } = data.data
    const attendees = stats.players.filter((row) => row.eveningsAttended > 0)
    const pick = (list: PlayerStats[], score: (row: PlayerStats) => number) => [...list].sort((left, right) => score(right) - score(left))[0]
    const lineSeries = timeline.series.map((entry) => ({ id: entry.playerId, label: entry.playerName, color: playerColor(entry.playerId), points: entry.points }))
    const attendance = [...stats.players].sort((left, right) => right.eveningsAttended - left.eveningsAttended || left.playerName.localeCompare(right.playerName, 'de'))
    return {
      lineSeries,
      attendance,
      records: {
        pechvogel: pick(attendees, (row) => row.pechvogelCount),
        lucky: pick(attendees, (row) => row.longestLuckyStreak),
        loyal: [...stats.players].filter((row) => row.isCore).sort((left, right) => right.attendanceRate - left.attendanceRate || right.eveningsAttended - left.eveningsAttended)[0],
        clean: pick(attendees, (row) => row.cleanEvenings),
        beer: pick(stats.players, (row) => row.beerRoundCount),
      },
    }
  }, [data.data])

  const ranking = useMemo<BarDatum[]>(() => {
    if (!data.data) return []
    const metricDef = METRICS.find((item) => item.value === metric)!
    return [...data.data.stats.players]
      .sort((left, right) => right[metric] - left[metric] || left.playerName.localeCompare(right.playerName, 'de'))
      .map((row) => ({
        id: row.playerId,
        label: row.playerName,
        value: row[metric],
        display: metricDef.format(row),
        sublabel: [row.isCore ? null : 'Gast', row.pechvogelCount > 0 ? `${row.pechvogelCount}× Pechvogel` : null].filter(Boolean).join(' · ') || undefined,
        avatar: { id: row.playerId, name: row.playerName },
      }))
  }, [data.data, metric])

  if (data.error && !data.data) return <LoadError error={data.error} onRetry={data.reload} />
  if (!data.data || !derived) return <SkeletonScreen variant="dashboard" />

  const { stats, seasons, timeline } = data.data
  const { records } = derived
  const recordTiles: Array<{ key: string; label: string; value: string; hint: string; icon: IconName }> = []
  if (records.pechvogel && records.pechvogel.pechvogelCount > 0) {
    recordTiles.push({ key: 'pech', label: 'Dauer-Pechvogel', value: records.pechvogel.playerName, hint: `${records.pechvogel.pechvogelCount}× Pechvogel des Abends`, icon: 'sad-outline' })
  }
  if (records.lucky && records.lucky.longestLuckyStreak > 0) {
    recordTiles.push({ key: 'lucky', label: 'Glückssträhne', value: records.lucky.playerName, hint: `${records.lucky.longestLuckyStreak} Abende in Folge kein Pechvogel`, icon: 'leaf-outline' })
  }
  if (records.clean && records.clean.cleanEvenings > 0) {
    recordTiles.push({ key: 'clean', label: 'Weiße Weste', value: records.clean.playerName, hint: `${records.clean.cleanEvenings} Abende ohne Verlust`, icon: 'shield-checkmark-outline' })
  }
  if (records.loyal && records.loyal.eveningsAttended > 0) {
    recordTiles.push({ key: 'loyal', label: 'Treueste Seele', value: records.loyal.playerName, hint: `${Math.round(records.loyal.attendanceRate * 100)} % der Abende dabei`, icon: 'heart-outline' })
  }
  if (records.beer && records.beer.beerRoundCount > 0) {
    recordTiles.push({ key: 'beer', label: 'Spendierhosen', value: records.beer.playerName, hint: `${records.beer.beerRoundCount} Bierrunden · ${formatCurrency(records.beer.beerRoundCents)}`, icon: 'beer-outline' })
  }
  if (stats.wildestEvening) {
    recordTiles.push({ key: 'wild', label: 'Wildester Abend', value: `${stats.wildestEvening.lossCount} Verluste`, hint: `${stats.wildestEvening.title} · ${formatDate(stats.wildestEvening.startedAt)}`, icon: 'flame-outline' })
  }

  // Tablets: no page scroll – cards fill the height, lists scroll inside.
  const fillCard = isTablet ? { flex: 1, minHeight: 0 } : undefined
  const scrollable = (node: React.ReactNode, fill = true) =>
    isTablet ? <InnerScroll fill={fill}>{node}</InnerScroll> : node
  const legendReserve = 28 * Math.ceil(derived.lineSeries.length / 4) + 12

  return (
    <Screen fixedOnTablet>
      <ScreenHeader
        title="Statistik"
        context={`${season ? `Saison ${season}` : 'Alle Saisons'} · ${stats.eveningCount} ${stats.eveningCount === 1 ? 'abgeschlossener Abend' : 'abgeschlossene Abende'}`}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        <Chip label="Gesamt" icon="infinite-outline" selected={season === null} onPress={() => { if (season !== null) { Feedback.tap(); setSeason(null) } }} />
        {seasons.map((item) => (
          <Chip key={item} label={`Saison ${item}`} selected={season === item} onPress={() => { if (season !== item) { Feedback.tap(); setSeason(item) } }} />
        ))}
      </ScrollView>

      {stats.eveningCount === 0 ? (
        <Card>
          <EmptyState icon="stats-chart-outline" title="Noch keine Statistik">
            {`Noch keine abgeschlossenen Spielabende${season ? ` in ${season}` : ''}. Sobald ein Abend abgeschlossen ist, erscheinen hier Rangliste, Verlauf und Rekorde.`}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Grid columns={{ compact: 2, medium: 4, expanded: 4 }}>
            <KpiTile label="Abende" icon="calendar-outline" value={stats.eveningCount} format={(value) => `${value}`} hint="abgeschlossen" />
            <KpiTile label="Verluste" icon="remove-circle-outline" value={stats.totalLossCount} format={(value) => `${value}`} hint={`Ø ${(stats.totalLossCount / Math.max(1, stats.eveningCount)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} pro Abend`} />
            <KpiTile label="Verloren" icon="cash-outline" tone="hero" value={stats.totalLossCents} format={formatCurrency} hint={`+ ${formatCurrency(stats.totalAbsenceCents)} Abwesenheit`} />
            <KpiTile label="Bierrunden" icon="beer-outline" value={stats.totalBeerRoundCount} format={(value) => `${value}`} hint={formatCurrency(stats.totalBeerRoundCents)} />
          </Grid>

          <Split weights={[7, 5]} fill>
            <View style={isTablet ? { flex: 1, minHeight: 0, gap: spacing.lg - 4 } : { gap: spacing.md }}>
              <Card style={fillCard}>
                <CardHeader overline="Verlauf" title="Verluste kumuliert" icon="trending-up" aside={<Badge>{`${timeline.labels.length} Abende`}</Badge>} />
                {derived.lineSeries.length === 0 ? (
                  <EmptyState icon="trending-up">In diesem Zeitraum wurde noch nichts verloren.</EmptyState>
                ) : isTablet ? (
                  <MeasuredFill minHeight={120}>
                    {(height) => (
                      <LineChart series={derived.lineSeries} labels={timeline.labels} height={Math.max(100, height - legendReserve)} formatY={compactEuro} legend area={derived.lineSeries.length === 1} />
                    )}
                  </MeasuredFill>
                ) : (
                  <LineChart series={derived.lineSeries} labels={timeline.labels} height={220} formatY={compactEuro} legend area={derived.lineSeries.length === 1} />
                )}
              </Card>

              <Card style={isTablet ? { flex: 1.2, minHeight: 0 } : undefined}>
                <CardHeader overline="Rangliste" title={season ? `Saison ${season}` : 'Ewige Tabelle'} icon="trophy-outline" aside={<Badge>{`${ranking.length} Spieler`}</Badge>} />
                <Segmented options={METRICS.map(({ value, label }) => ({ value, label }))} value={metric} onChange={(value) => { Feedback.tap(); setMetric(value) }} />
                {scrollable(<BarChart key={`${metric}-${season ?? 'all'}`} data={ranking} showRank barHeight={8} />)}
              </Card>
            </View>

            <View style={isTablet ? { flex: 1, minHeight: 0, gap: spacing.lg - 4 } : { gap: spacing.md }}>
              {recordTiles.length ? (
                <Card style={isTablet ? { flexShrink: 1, minHeight: 0, maxHeight: '55%' } : undefined}>
                  <CardHeader overline="Fun Facts" title="Rekorde" icon="ribbon-outline" />
                  {scrollable(
                    <Grid columns={{ compact: 2, medium: 2, expanded: 2 }}>
                      {recordTiles.map((tile) => (
                        <StatTile key={tile.key} label={tile.label} value={tile.value} hint={tile.hint} icon={tile.icon} tone={tile.key === 'pech' || tile.key === 'wild' ? 'warning' : 'accent'} />
                      ))}
                    </Grid>,
                    false,
                  )}
                </Card>
              ) : null}

              <Card style={fillCard}>
                <CardHeader overline="Anwesenheit" title="Abende pro Spieler" icon="people-outline" />
                {scrollable(<Stack gap={spacing.sm}>
                  {derived.attendance.map((row) => (
                    <View key={row.playerId} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <PlayerAvatar id={row.playerId} name={row.playerName} size={28} />
                      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
                          <AppText variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{row.playerName}</AppText>
                          <View style={{ flex: 1 }} />
                          <AppText variant="caption" tone="muted">
                            {`${row.eveningsAttended} da${row.isCore ? ` · ${row.eveningsMissed} gefehlt` : ' · Gast'} · Ø ${row.averageLossesPerEvening.toLocaleString('de-DE')}`}
                          </AppText>
                        </View>
                        <StackedBar
                          total={stats.eveningCount}
                          height={6}
                          segments={[
                            { key: 'attended', value: row.eveningsAttended, color: colors.success },
                            { key: 'missed', value: row.eveningsMissed, color: withAlpha(colors.danger, 0.6) },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </Stack>)}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <LegendDot color={colors.success} label="anwesend" />
                  <LegendDot color={withAlpha(colors.danger, 0.6)} label="gefehlt" />
                </View>
              </Card>
            </View>
          </Split>
        </>
      )}
    </Screen>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <AppText variant="caption" tone="subtle">{label}</AppText>
    </View>
  )
}
