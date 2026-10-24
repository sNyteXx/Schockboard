import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { colors, radius, spacing } from '@/theme/tokens'

const SHEET_OFFSET = 520

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
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(visible)
  const progress = useSharedValue(0)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      progress.value = withSpring(1, { damping: 20, stiffness: 210, mass: 0.8 })
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false)
      })
    }
  }, [visible])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.6 }))
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * SHEET_OFFSET }] }))

  if (!mounted) return null

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, backdropStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Schließen" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            {
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
              maxHeight: '88%',
              backgroundColor: colors.bgElevated,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
            sheetStyle,
          ]}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing.xs }}>
            <View style={{ width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm }}>
            <View style={{ flex: 1, gap: 4 }}>
              {eyebrow ? <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>{eyebrow.toUpperCase()}</Text> : null}
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }}>{title}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Schließen"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '900' }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
