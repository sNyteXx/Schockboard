import { useEffect, useState } from 'react'
import { Alert, Text } from 'react-native'

import { Badge, Button, Card, SectionTitle } from '@/components/ui'
import { formatDateTime } from '@/domain/format'
import { syncBackgroundRegistration } from '@/remote/background'
import { RemoteConfigStore, type RemoteConfig } from '@/remote/config'
import { SyncEngine, type SyncOutcome } from '@/remote/sync-engine'
import { colors } from '@/theme/tokens'

/** Only rendered once the device is paired; sync itself needs no UI. */
export function RemoteStatusCard() {
  const [config, setConfig] = useState<RemoteConfig | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(SyncEngine.getLastOutcome())

  useEffect(() => {
    void RemoteConfigStore.get().then(setConfig)
    return SyncEngine.subscribe((next) => {
      setOutcome(next)
      void RemoteConfigStore.get().then(setConfig)
    })
  }, [])

  if (!config) return null

  const host = new URL(config.server).hostname
  const healthy = outcome?.status !== 'error'

  function confirmUnpair() {
    Alert.alert('Web-Verwaltung trennen?', `Dieses Gerät gleicht danach nicht mehr mit ${host} ab. Die Daten auf dem Gerät bleiben erhalten.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Trennen',
        style: 'destructive',
        async onPress() {
          await SyncEngine.unpair()
          await syncBackgroundRegistration(false)
          setConfig(null)
        },
      },
    ])
  }

  return (
    <Card>
      <SectionTitle eyebrow="Web-Verwaltung" title={host} aside={<Badge tone={healthy ? 'success' : 'warning'}>{healthy ? 'VERBUNDEN' : 'OFFLINE'}</Badge>} />
      <Text style={{ color: colors.muted, lineHeight: 21 }}>
        {outcome?.status === 'ok'
          ? `Zuletzt abgeglichen ${formatDateTime(outcome.at)}.`
          : outcome?.status === 'error'
            ? `Letzter Versuch ${formatDateTime(outcome.at)}: ${outcome.message} Wird automatisch wiederholt.`
            : 'Abgleich läuft automatisch im Hintergrund.'}
      </Text>
      <Button tone="secondary" onPress={confirmUnpair}>Trennen</Button>
    </Card>
  )
}
