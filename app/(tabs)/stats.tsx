import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import { BrandHero } from '@/components/brand'
import { Badge, Card, EmptyState, Notice, Screen, SectionTitle, Split, Stack } from '@/components/ui'
import { getStatistics, type PlayerStats } from '@/db/stats-queries'
import { formatCurrency, formatDate } from '@/domain/format'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useRuntime } from '@/providers/runtime-provider'
import { Feedback } from '@/services/haptics'
import { colors, radius, spacing } from '@/theme/tokens'

type Metric = 'lossCount' | 'lossCents' | 'averageLossCentsPerEvening' | 'eveningsAttended'

const METRICS: Array<{ id: Metric; label: string; format: (row: PlayerStats) => string }> = [
  { id: 'lossCount', label: 'Verluste', format: (row) => `${row.lossCount}` },
  { id: 'lossCents', label: 'Betrag', format: (row) => formatCurrency(row.lossCents) },
  { id: 'averageLossCentsPerEvening', label: 'Ø / Abend', format: (row) => formatCurrency(row.averageLossCentsPerEvening) },
  { id: 'eveningsAttended', label: 'Abende', format: (row) => `${row.eveningsAttended}` },
]

export default function StatsScreen() {
  const runtime = useRuntime()
  const [season, setSeason] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('lossCount')
  const data = useAsyncResource(() => getStatistics(season), [runtime.dataVersion, season])

  if (data.loading && !data.data) {
    return <Screen><ActivityIndicator color={colors.accentStrong} size="large" /></Screen>
  }

  if (data.error || !data.data) {
    return <Screen><Card><Notice type="error" message={data.error?.message ?? 'Statistik konnte nicht geladen werden.'} /></Card></Screen>
  }

  const { stats, seasons } = data.data
  const metricDef = METRICS.find((item) => item.id === metric)!
  const ranked = [...stats.players].sort((left, right) => right[metric] - left[metric] || left.playerName.localeCompare(right.playerName, 'de'))
  const maxValue = Math.max(1, ...ranked.map((row) => row[metric]))
  const attendees = stats.players.filter((row) => row.eveningsAttended > 0)
  const mostPechvogel = [...attendees].sort((left, right) => right.pechvogelCount - left.pechvogelCount)[0]
  const luckiest = [...attendees].sort((left, right) => right.longestLuckyStreak - left.longestLuckyStreak)[0]
  const loyal = [...stats.players].filter((row) => row.isCore).sort((left, right) => right.attendanceRate - left.attendanceRate || right.eveningsAttended - left.eveningsAttended)[0]
  const cleanest = [...attendees].sort((left, right) => right.cleanEvenings - left.cleanEvenings)[0]
  const beerKing = [...stats.players].sort((left, right) => right.beerRoundCount - left.beerRoundCount)[0]

  return (
    <Screen>
      <Stack>
        <BrandHero
          themeId={runtime.themeId}
          title="Statistik"
          subtitle={season ? `Saison ${season} · ${stats.eveningCount} abgeschlossene Abende` : `Alle Saisons · ${stats.eveningCount} abgeschlossene Abende`}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          <FilterChip label="Gesamt" selected={season === null} onPress={() => setSeason(null)} />
          {seasons.map((item) => (
            <FilterChip key={item} label={`Saison ${item}`} selected={season === item} onPress={() => setSeason(item)} />
          ))}
        </ScrollView>

        {stats.eveningCount === 0 ? (
          <Card>
            <EmptyState>Noch keine abgeschlossenen Spielabende{season ? ` in ${season}` : ''}. Sobald ein Abend abgeschlossen ist, erscheint hier die Rangliste.</EmptyState>
          </Card>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Kpi label="ABENDE" value={`${stats.eveningCount}`} />
              <Kpi label="VERLUSTE" value={`${stats.totalLossCount}`} />
              <Kpi label="VERLOREN" value={formatCurrency(stats.totalLossCents)} />
              <Kpi label="BIERRUNDEN" value={`${stats.totalBeerRoundCount}`} />
            </View>

            <Card>
              <SectionTitle eyebrow="Rangliste" title={season ? `Saison ${season}` : 'Ewige Tabelle'} aside={<Badge>{ranked.length} Spieler</Badge>} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {METRICS.map((item) => (
                  <FilterChip key={item.id} label={item.label} selected={metric === item.id} onPress={() => setMetric(item.id)} />
                ))}
              </View>
              <Stack>
                {ranked.map((row, index) => (
                  <RankRow
                    key={`${row.playerId}-${metric}-${season ?? 'all'}`}
                    rank={index + 1}
                    row={row}
                    value={metricDef.format(row)}
                    ratio={row[metric] / maxValue}
                    delay={Math.min(index, 10) * 40}
                  />
                ))}
              </Stack>
            </Card>

            <Split>
              <Card>
                <SectionTitle eyebrow="Fun Facts" title="Rekorde" />
                <Stack>
                  {mostPechvogel && mostPechvogel.pechvogelCount > 0 ? (
                    <Fact icon="🐦" title="Dauer-Pechvogel" detail={`${mostPechvogel.playerName} – ${mostPechvogel.pechvogelCount}× Pechvogel des Abends`} />
                  ) : null}
                  {luckiest && luckiest.longestLuckyStreak > 0 ? (
                    <Fact icon="🍀" title="Längste Glückssträhne" detail={`${luckiest.playerName} – ${luckiest.longestLuckyStreak} Abende in Folge kein Pechvogel`} />
                  ) : null}
                  {cleanest && cleanest.cleanEvenings > 0 ? (
                    <Fact icon="🧼" title="Weiße Weste" detail={`${cleanest.playerName} – ${cleanest.cleanEvenings} Abende ohne einen Verlust`} />
                  ) : null}
                  {loyal && loyal.eveningsAttended > 0 ? (
                    <Fact icon="🏟️" title="Treueste Seele" detail={`${loyal.playerName} – ${Math.round(loyal.attendanceRate * 100)} % der Abende dabei`} />
                  ) : null}
                  {beerKing && beerKing.beerRoundCount > 0 ? (
                    <Fact icon="🍺" title="Spendierhosen" detail={`${beerKing.playerName} – ${beerKing.beerRoundCount} Bierrunden (${formatCurrency(beerKing.beerRoundCents)})`} />
                  ) : null}
                  {stats.wildestEvening ? (
                    <Fact icon="🔥" title="Wildester Abend" detail={`${stats.wildestEvening.title} (${formatDate(stats.wildestEvening.startedAt)}) – ${stats.wildestEvening.lossCount} Verluste`} />
                  ) : null}
                </Stack>
              </Card>

              <Card>
                <SectionTitle eyebrow="Anwesenheit" title="Abende pro Spieler" />
                <Stack>
                  {[...stats.players].sort((left, right) => right.eveningsAttended - left.eveningsAttended || left.playerName.localeCompare(right.playerName, 'de')).map((row) => (
                    <View key={row.playerId} style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                        <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{row.playerName}{row.isCore ? '' : ' (Gast)'}</Text>
                        <Text style={{ color: colors.muted, fontSize: 13 }}>
                          {row.eveningsAttended} da{row.isCore ? ` · ${row.eveningsMissed} gefehlt` : ''} · Ø {row.averageLossesPerEvening.toLocaleString('de-DE')} Verl.
                        </Text>
                      </View>
                      <StackedBar attended={row.eveningsAttended} missed={row.eveningsMissed} total={stats.eveningCount} />
                    </View>
                  ))}
                </Stack>
              </Card>
            </Split>
          </>
        )}
      </Stack>
    </Screen>
  )
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => { if (!selected) { Feedback.tap(); onPress() } }}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 9,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.accent : colors.surfaceSoft,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: selected ? colors.buttonPrimaryText : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 120, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  )
}

function RankRow({ rank, row, value, ratio, delay }: { rank: number; row: PlayerStats; value: string; ratio: number; delay: number }) {
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(ratio, { duration: 520 }))
  }, [delay, progress, ratio])
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.max(progress.value * 100, 1.5)}%` }))

  return (
    <Animated.View entering={FadeIn.duration(200)} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ width: 26, color: rank <= 3 ? colors.accentStrong : colors.muted, fontWeight: '900' }}>{rank}.</Text>
        <Text style={{ flex: 1, color: colors.text, fontWeight: '800' }} numberOfLines={1}>
          {row.playerName}{row.pechvogelCount > 0 ? ` · 🐦 ${row.pechvogelCount}` : ''}
        </Text>
        <Text style={{ color: colors.text, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surfaceSoft, overflow: 'hidden', marginLeft: 26 + spacing.sm }}>
        <Animated.View style={[{ height: 10, borderRadius: 5, backgroundColor: rank === 1 ? colors.accentStrong : colors.accent }, barStyle]} />
      </View>
    </Animated.View>
  )
}

function StackedBar({ attended, missed, total }: { attended: number; missed: number; total: number }) {
  const safeTotal = Math.max(1, total)
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSoft, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${(attended / safeTotal) * 100}%`, backgroundColor: colors.success }} />
      <View style={{ width: `${(missed / safeTotal) * 100}%`, backgroundColor: colors.danger, opacity: 0.7 }} />
    </View>
  )
}

function Fact({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Text style={{ fontSize: 26 }}>{icon}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '900' }}>{title}</Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>{detail}</Text>
      </View>
    </View>
  )
}
