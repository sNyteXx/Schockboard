import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { useDeviceLayout } from '@/hooks/use-device-layout'
import { Feedback } from '@/services/haptics'
import { UNDO_WINDOW_MS, UndoService } from '@/services/undo-service'
import { colors, radius, spacing } from '@/theme/tokens'

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
  const styles = useMemo(makeStyles, [themeId])
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
      visible.value = withSpring(1, { damping: 16, stiffness: 220 })
      remaining.value = 1
      remaining.value = withTiming(0, { duration: UNDO_WINDOW_MS, easing: Easing.linear })
    })
  }, [remaining, visible])

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * 32 }, { scale: 0.96 + visible.value * 0.04 }],
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
        <Text style={styles.text}>{label}</Text>
        <Pressable accessibilityRole="button" onPress={handleUndo} style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}>
          <Text style={styles.buttonText}>Rückgängig</Text>
        </Pressable>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.progress, progressStyle]} />
      </View>
    </Animated.View>
  )
}

function makeStyles() {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      backgroundColor: colors.bgElevated,
      borderColor: colors.accent,
      borderWidth: 1,
      borderRadius: radius.lg,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    text: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
      flex: 1,
    },
    button: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    buttonText: {
      color: colors.buttonPrimaryText,
      fontWeight: '800',
      fontSize: 14,
    },
    track: { height: 3, backgroundColor: colors.surfaceSoft },
    progress: { height: 3, backgroundColor: colors.accent, transformOrigin: 'left' },
  })
}
