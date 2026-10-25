import { Modal, Pressable, View } from 'react-native'
import { Alert } from '@/components/dialog'
import { AppText } from '@/components/ui'
import { useRuntime } from '@/providers/runtime-provider'
import { colors, radius, spacing } from '@/theme/tokens'

export function TableLock() {
  const runtime = useRuntime()
  return <Modal visible={runtime.tableLocked} transparent animationType="fade" onRequestClose={() => {}}>
    <View style={{ flex: 1, backgroundColor: '#00000088', alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
      <View style={{ backgroundColor: colors.bgElevated, borderColor: colors.accent, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg, maxWidth: 440 }}>
        <AppText variant="title">Tisch gesperrt</AppText>
        <AppText>Die Anzeige läuft weiter. Zum Entsperren den Knopf zwei Sekunden halten.</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Tisch entsperren" accessibilityHint="Zwei Sekunden halten. Mit Vorlesefunktion doppeltippen und Entsperren bestätigen." accessibilityActions={[{ name: 'activate', label: 'Entsperren' }]} onAccessibilityAction={() => Alert.alert('Tisch entsperren?', 'Bedienung wieder freigeben.', [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Entsperren', onPress: () => runtime.setTableLocked(false) }])} delayLongPress={2000} onLongPress={() => runtime.setTableLocked(false)} style={{ padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center' }}>
          <AppText tone="onAccent">Zum Entsperren halten</AppText>
        </Pressable>
      </View>
    </View>
  </Modal>
}
