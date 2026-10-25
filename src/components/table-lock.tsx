import { useEffect, useState } from 'react'
import { Modal, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppText, Button, Card, CardHeader, Split } from '@/components/ui'
import { useRuntime } from '@/providers/runtime-provider'
import { spacing } from '@/theme/tokens'

export function TableLock() {
  const { tableLocked, setTableLocked } = useRuntime()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { setConfirm(false) }, [tableLocked])
  return <Modal visible={tableLocked} transparent animationType="fade" onRequestClose={() => {}}>
    <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end', padding: spacing.md }}>
      <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <Card animated={false} tone="accent">
          <CardHeader title="Tisch gesperrt" icon="shield-checkmark-outline" />
          <AppText variant="caption" tone="muted">{confirm ? 'Bedienung jetzt wieder freigeben?' : 'Berührschutz aktiv. Der Spielstand bleibt sichtbar und wird aktualisiert.'}</AppText>
          {confirm ? <Split>
            <Button tone="secondary" onPress={() => setConfirm(false)}>Gesperrt lassen</Button>
            <Button onPress={() => setTableLocked(false)}>Jetzt freigeben</Button>
          </Split> : <Button onPress={() => setConfirm(true)}>Entsperren</Button>}
        </Card>
      </View>
    </SafeAreaView>
  </Modal>
}
