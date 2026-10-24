import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { CALM_EASING, PressableScale } from '@/components/motion'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { Feedback } from '@/services/haptics'
import { UNDO_WINDOW_MS, UndoService } from '@/services/undo-service'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles } from '@/theme/use-theme'

// Extra bottom offset requested by screens with a sticky bottom bar.
let toastLift = 0
const liftListeners = new Set<(lift: number) => void>()

/** Keeps the undo toast above a sticky footer while the caller is mounted. */
export function useUndoToastLift(px: number) {
  useEffect(() => {
    toastLift = px
    liftListeners.forEach((listener) => listener(px))
    return () => {
      toastLift = 0
      liftListeners.forEach((listener) => listener(0))
    }
  }, [px])
}

export function UndoToast({
  actor,
  onUndo,
  onError,
  themeId,
}: {
  actor: { id: string; username: string } | null
  onUndo: () => void
  onError: (message: string) => void
  themeId: string
}) {
  // themeId keeps the prop contract; styles follow the active theme via themedStyles.
  void themeId
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const [label, setLabel] = useState<string | null>(null)
  const visible = useSharedValue(0)
  const remaining = useSharedValue(1)

  const { isTablet } = useDeviceLayout()
  const { width: windowWidth } = useWindowDimensions()
  // Absolute views ignore alignSelf: center the toast explicitly (max 560 dp).
  const toastWidth = Math.min(windowWidth - 32, 560)
  const [lift, setLift] = useState(toastLift)

  useEffect(() => {
    liftListeners.add(setLift)
    return () => {
      liftListeners.delete(setLift)
    }
  }, [])

  useEffect(() => {
    const clearLabelIfIdle = () => {
      if (!UndoService.getPendingUndo()) setLabel(null)
    }
    const hide = () => {
      cancelAnimation(remaining)
      visible.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) scheduleOnRN(clearLabelIfIdle)
      })
    }

    return UndoService.subscribe(() => {
      const pending = UndoService.getPendingUndo()
      if (!pending) {
        hide()
        return
      }
      setLabel(pending.label)
      visible.value = withTiming(1, { duration: 200, easing: CALM_EASING })
      remaining.value = 1
      remaining.value = withTiming(0, { duration: UNDO_WINDOW_MS, easing: Easing.linear })
    })
  }, [remaining, visible])

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * 16 }],
  }))
  const progressStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: remaining.value }] }))

  async function handleUndo() {
    if (!actor) return
    try {
      await UndoService.executeUndo({ accountId: actor.id, username: actor.username })
      Feedback.reverted()
      onUndo()
    } catch (error) {
      // The booking still exists (e.g. the evening was closed meanwhile):
      // say so instead of silently pretending the undo worked.
      Feedback.error()
      onError(error instanceof Error ? `Rückgängig fehlgeschlagen: ${error.message}` : 'Rückgängig fehlgeschlagen.')
    }
  }

  if (!label) return null

  return (
    <Animated.View style={[styles.container, { bottom: Math.max(insets.bottom, 12) + (isTablet ? 12 : 72) + lift, width: toastWidth, left: (windowWidth - toastWidth) / 2 }, containerStyle]}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="checkmark" size={16} color={colors.success} />
        </View>
        <Text style={styles.text} numberOfLines={2}>{label}</Text>
        <PressableScale accessibilityRole="button" accessibilityLabel="Rückgängig" onPress={handleUndo} pressedScale={0.94} style={styles.button}>
          <Ionicons name="arrow-undo" size={16} color={colors.buttonPrimaryText} />
          <Text style={styles.buttonText}>Rückgängig</Text>
        </PressableScale>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.progress, progressStyle]} />
      </View>
    </Animated.View>
  )
}

const useStyles = themedStyles(({ c, t }) => ({
  container: {
    position: 'absolute',
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.successSoft },
  text: { ...t.bodyStrong, color: c.text, flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.accent,
  },
  buttonText: { ...t.label, color: c.buttonPrimaryText },
  track: { height: 3, backgroundColor: c.surfaceSoft },
  progress: { height: 3, backgroundColor: c.accent, transformOrigin: 'left' },
}))
