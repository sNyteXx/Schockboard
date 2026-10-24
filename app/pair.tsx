import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Text } from 'react-native'

import { Button, Card, Notice, Screen, SectionTitle, Stack } from '@/components/ui'
import { normalizeServerOrigin } from '@/remote/config'
import { SyncEngine } from '@/remote/sync-engine'
import { Feedback } from '@/services/haptics'
import { colors } from '@/theme/tokens'

/** Target of the QR code shown in the web admin: schockboard://pair?server=…&token=… */
export default function PairScreen() {
  const params = useLocalSearchParams<{ server?: string; token?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = useMemo(() => {
    try {
      if (!params.server || !params.token) throw new Error('Der Kopplungslink ist unvollständig.')
      return { server: normalizeServerOrigin(params.server), token: params.token, error: null }
    } catch (caught) {
      return { server: null, token: null, error: caught instanceof Error ? caught.message : 'Ungültiger Link.' }
    }
  }, [params.server, params.token])

  async function confirm() {
    if (!target.server || !target.token) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await SyncEngine.pair(target.server, target.token)
      if (outcome.status === 'error') throw new Error(outcome.message)
      Feedback.success()
      router.replace('/(tabs)')
    } catch (caught) {
      Feedback.error()
      setError(caught instanceof Error ? caught.message : 'Kopplung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Stack>
        <Card>
          <SectionTitle eyebrow="Web-Verwaltung" title="Gerät koppeln" />
          {target.error ? (
            <Notice type="error" message={target.error} />
          ) : (
            <Text style={{ color: colors.text, lineHeight: 22 }}>
              Dieses Gerät gleicht seine Daten danach automatisch im Hintergrund mit{' '}
              <Text style={{ fontWeight: '900', color: colors.accentStrong }}>{new URL(target.server!).hostname}</Text> ab.
              Die Datenbank bleibt auf dem Gerät; Korrekturen aus dem Web werden hier übernommen.
            </Text>
          )}
          {error ? <Notice type="error" message={error} /> : null}
          {busy ? <ActivityIndicator color={colors.accentStrong} /> : null}
          {!target.error ? <Button disabled={busy} onPress={confirm}>Koppeln</Button> : null}
          <Button tone="secondary" disabled={busy} onPress={() => router.replace('/(tabs)')}>Abbrechen</Button>
        </Card>
      </Stack>
    </Screen>
  )
}
