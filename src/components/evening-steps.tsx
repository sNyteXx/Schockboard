import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, Text, View } from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'

import { Feedback } from '@/services/haptics'
import { colors, radius, spacing } from '@/theme/tokens'

export type EveningStep = 'attendance' | 'live' | 'summary'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export const EVENING_STEPS: Array<{ id: EveningStep; label: string; icon: IconName }> = [
  { id: 'attendance', label: 'Wer ist da?', icon: 'people' },
  { id: 'live', label: 'Live-Brett', icon: 'grid' },
  { id: 'summary', label: 'Abschluss', icon: 'flag' },
]

/** Compact, tappable 3-step indicator for the evening assistant. */
export function StepIndicator({ step, onChange }: { step: EveningStep; onChange: (step: EveningStep) => void }) {
  const activeIndex = EVENING_STEPS.findIndex((item) => item.id === step)

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: 6,
        padding: 5,
        borderRadius: radius.pill,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {EVENING_STEPS.map((item, index) => {
        const active = index === activeIndex
        const done = index < activeIndex
        return (
          <Animated.View key={item.id} layout={LinearTransition.springify().damping(18)} style={{ flex: active ? 1.6 : 1, minWidth: 0 }}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Schritt ${index + 1}: ${item.label}`}
              onPress={() => {
                if (active) return
                Feedback.tap()
                onChange(item.id)
              }}
              style={({ pressed }) => ({
                minHeight: 40,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingHorizontal: spacing.xs,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.accent : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? colors.buttonPrimaryText : done ? colors.surfaceSoft : 'transparent',
                  borderWidth: active || done ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={13} color={colors.accentStrong} />
                ) : (
                  <Text style={{ color: active ? colors.accent : colors.muted, fontSize: 11, fontWeight: '900' }}>{index + 1}</Text>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{ color: active ? colors.buttonPrimaryText : done ? colors.text : colors.muted, fontWeight: '900', fontSize: 13, flexShrink: 1 }}
              >
                {item.label}
              </Text>
            </Pressable>
          </Animated.View>
        )
      })}
    </View>
  )
}
