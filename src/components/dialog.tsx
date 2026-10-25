import { useEffect, useState } from 'react'
import { BackHandler, Modal, Pressable, StyleSheet, View } from 'react-native'
import Animated, { Easing, FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated'

import { AppText, Button } from '@/components/ui'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { colors, radius, spacing } from '@/theme/tokens'

/**
 * In-app replacement for the grey Android system dialog. Same call shape as
 * React Native's Alert so call sites only swap the import:
 *   import { Alert } from '@/components/dialog'
 *   Alert.alert('Abend abbrechen?', '3 Buchungen werden verworfen.', [
 *     { text: 'Weiterspielen', style: 'cancel' },
 *     { text: 'Abbrechen', style: 'destructive', onPress: cancel },
 *   ])
 * <DialogHost /> must be mounted once (app/_layout.tsx).
 */

export type DialogButton = {
  text: string
  style?: 'default' | 'cancel' | 'destructive'
  onPress?: () => void | Promise<void>
}

type DialogRequest = { id: number; title: string; message?: string; buttons: DialogButton[] }

let nextId = 1
let queue: DialogRequest[] = []
const listeners = new Set<(current: DialogRequest | null) => void>()

function publish() {
  for (const listener of listeners) listener(queue[0] ?? null)
}

function close(id: number) {
  queue = queue.filter((request) => request.id !== id)
  publish()
}

export const Alert = {
  alert(title: string, message?: string, buttons?: DialogButton[]) {
    queue = [...queue, { id: nextId++, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }]
    publish()
  },
}

const EASE = Easing.bezier(0.2, 0, 0, 1)

export function DialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(queue[0] ?? null)
  const reduceMotion = useReducedMotion()
  const { isTablet } = useDeviceLayout()

  useEffect(() => {
    listeners.add(setCurrent)
    return () => {
      listeners.delete(setCurrent)
    }
  }, [])

  const cancelButton = current?.buttons.find((button) => button.style === 'cancel')

  function choose(button: DialogButton | undefined) {
    if (!current) return
    close(current.id)
    void button?.onPress?.()
  }

  // Android back = the cancel option (or just close when there is none).
  useEffect(() => {
    if (!current) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      choose(cancelButton)
      return true
    })
    return () => subscription.remove()
  })

  if (!current) return null

  // Cancel left/secondary, the real action right/prominent – like the rest of the app.
  const ordered = [...current.buttons].sort((left, right) => Number(left.style !== 'cancel') - Number(right.style !== 'cancel'))
  const stacked = ordered.length > 2

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => choose(cancelButton)}>
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(160).easing(EASE)}
        exiting={reduceMotion ? undefined : FadeOut.duration(120)}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Schließen" onPress={cancelButton ? () => choose(cancelButton) : undefined} />
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(200).easing(EASE)}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.card, { width: isTablet ? 480 : '88%', borderColor: colors.border, backgroundColor: colors.bgElevated }]}
        >
          <AppText variant="heading">{current.title}</AppText>
          {current.message ? <AppText tone="muted">{current.message}</AppText> : null}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {ordered.map((button) => (
              <View key={button.text} style={stacked ? undefined : { flex: 1 }}>
                <Button
                  tone={button.style === 'destructive' ? 'danger' : button.style === 'cancel' ? 'secondary' : 'primary'}
                  onPress={() => choose(button)}
                >
                  {button.text}
                </Button>
              </View>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: spacing.lg,
  },
  card: {
    maxWidth: 520,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionsStacked: { flexDirection: 'column-reverse' },
})
