import { useMemo, useRef, useState } from 'react'
import { View, Switch } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SvgXml } from 'react-native-svg'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { AppText, Badge, Button, Card, CardHeader, Field, Grid, Input, Notice, Screen, ScreenHeader, Segmented, Split } from '@/components/ui'
import { getStatsRawData } from '@/db/stats-queries'
import { getRecap } from '@/db/recap'
import { buildAchievements } from '@/domain/achievements'
import { achievementDate, recapSvg } from '@/domain/recap'
import { useRuntime } from '@/providers/runtime-provider'
import { colors, spacing } from '@/theme/tokens'

export default function AchievementsScreen() {
  const runtime = useRuntime(), router = useRouter()
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>()
  const [mode, setMode] = useState<'trophies' | 'recap'>(sessionId ? 'recap' : 'trophies')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [player, setPlayer] = useState<string>('all')
  const [balances, setBalances] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const imageRef = useRef<View>(null)
  const raw = useMemo(() => getStatsRawData(), [runtime.dataVersion])
  const awards = useMemo(() => buildAchievements(raw), [raw])
  const selected = awards.filter(award => player === 'all' || award.playerId === player)
  const recap = useMemo(() => {
    try { return getRecap({ sessionId, year: /^\d{4}$/.test(year) ? year : String(new Date().getFullYear()), includeBalances: balances }) }
    catch { return null }
  }, [sessionId, year, balances, runtime.dataVersion])
  async function share() {
    setBusy(true); setError(null)
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen auf diesem Gerät nicht verfügbar.')
      const uri = await captureRef(imageRef, { format: 'png', quality: 1, result: 'tmpfile', width: 960 })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Schockboard-Rückblick teilen', UTI: 'public.png' })
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const svg = recap ? recapSvg(recap) : ''
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 400)
  return <Screen maxWidth={1100}>
    <ScreenHeader title="Erfolge & Rückblick" context="Eure Geschichte am Spieltisch" />
    <Button tone="ghost" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>Zurück</Button>
    <Segmented value={mode} onChange={setMode} options={[{ value: 'trophies', label: 'Trophäen' }, { value: 'recap', label: sessionId ? 'Abendrückblick' : 'Jahresrückblick' }]} />
    {error ? <Notice type="error" message={error} /> : null}
    {mode === 'trophies' ? <>
      <Card><CardHeader title={`${selected.filter(award => award.unlockedAt).length} Erfolge freigeschaltet`} icon="trophy-outline" />
        <AppText tone="muted">Vergangene Abende zählen mit. Leere Testabende zählen nicht. Korrekturen werden automatisch berücksichtigt.</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}><Button tone={player === 'all' ? 'primary' : 'secondary'} onPress={() => setPlayer('all')}>Alle</Button>{raw.players.map(row => <Button key={row.id} tone={player === row.id ? 'primary' : 'secondary'} onPress={() => setPlayer(row.id)}>{row.name}</Button>)}</View>
      </Card>
      <Grid columns={{ compact: 1, medium: 2, expanded: 3 }}>{selected.map(award => <Card key={`${award.playerId}:${award.id}`}>
        <CardHeader title={award.title} icon={award.unlockedAt ? 'trophy' : 'lock-closed-outline'} aside={<Badge tone={award.unlockedAt ? 'accent' : 'default'}>{`${award.progress}/${award.target}`}</Badge>} />
        <AppText>{award.playerName}</AppText><AppText tone="muted">{award.description}</AppText>
        <View accessible accessibilityLabel={`${award.progress} von ${award.target}`} style={{ height: 5, borderRadius: 3, backgroundColor: colors.border }}><View style={{ height: 5, borderRadius: 3, backgroundColor: colors.accent, width: `${award.progress / award.target * 100}%` }} /></View>
        <AppText tone="subtle">{achievementDate(award)}</AppText>
      </Card>)}</Grid>
      {!raw.players.length ? <AppText tone="muted">Lege Spieler an, um ihre Trophäen zu sehen.</AppText> : null}
    </> : <>
      <Card><CardHeader title={sessionId ? 'Euer Abend als Bild' : 'Euer Jahr als Bild'} icon="image-outline" />
        {!sessionId ? <Field label="Jahr"><Input value={year} onChangeText={setYear} maxLength={4} keyboardType="number-pad" /></Field> : null}
        <Split><AppText>Persönliche Kontostände einschließen</AppText><Switch accessibilityLabel="Persönliche Kontostände einschließen" value={balances} onValueChange={setBalances} /></Split>
        <AppText tone="muted">Ohne Auswahl werden keine persönlichen Schulden oder Guthaben geteilt. Die Vorschau zeigt genau das exportierte Bild.</AppText>
      </Card>
      {recap ? <View ref={imageRef} collapsable={false} style={{ width: '100%', aspectRatio: 960 / height }}><SvgXml xml={svg} width="100%" height="100%" /></View> : <Notice type="error" message="Für diesen Abend ist noch kein abgeschlossener Rückblick vorhanden." />}
      <Button disabled={!recap || busy || (!sessionId && !/^\d{4}$/.test(year))} loading={busy} onPress={() => void share()}>Als Bild teilen</Button>
    </>}
  </Screen>
}
