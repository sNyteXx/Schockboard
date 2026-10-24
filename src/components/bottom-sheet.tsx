import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { CALM_EASING } from '@/components/motion'
import { IconButton } from '@/components/ui'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles } from '@/theme/use-theme'

const SHEET_OFFSET = 520

const useStyles = themedStyles(({ c, t }) => ({
  sheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    maxHeight: '88%',
    backgroundColor: c.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: c.borderStrong,
  },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: c.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  overline: { ...t.overline, color: c.accentStrong },
  title: { ...t.heading, color: c.text },
}))

/**
 * Minimal bottom sheet: a transparent Modal with a fading backdrop and a
 * spring-in panel. Stays mounted until the exit animation has finished.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  eyebrow,
  children,
}: {
  visible: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: React.ReactNode
}) {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion()
  const [mounted, setMounted] = useState(visible)
  const progress = useSharedValue(0)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      progress.value = reduceMotion ? withTiming(1, { duration: 120 }) : withTiming(1, { duration: 240, easing: CALM_EASING })
    } else if (mounted) {
      progress.value = withTiming(0, { duration: reduceMotion ? 120 : 200, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false)
      })
    }
  }, [visible])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.6 }))
  const sheetStyle = useAnimatedStyle(() => (reduceMotion ? { opacity: progress.value } : { transform: [{ translateY: (1 - progress.value) * SHEET_OFFSET }] }))

  if (!mounted) return null

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, backdropStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Schließen" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }, sheetStyle]}>
          <View style={{ alignItems: 'center', paddingTop: spacing.xs }}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 2 }}>
              {eyebrow ? <Text style={styles.overline}>{eyebrow}</Text> : null}
              <Text style={styles.title} accessibilityRole="header">{title}</Text>
            </View>
            <IconButton icon="close" accessibilityLabel="Schließen" onPress={onClose} size={36} color={colors.muted} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
