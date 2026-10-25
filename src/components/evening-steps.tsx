import Ionicons from '@expo/vector-icons/Ionicons'
import { Text, View } from 'react-native'

import { PressableScale } from '@/components/motion'
import { TourTarget } from '@/components/tour/tour-target'
import { TOUR_TARGETS } from '@/components/tour/tour-steps'
import { Feedback } from '@/services/haptics'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles } from '@/theme/use-theme'

export type EveningStep = 'attendance' | 'live' | 'summary'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export const EVENING_STEPS: Array<{ id: EveningStep; label: string; icon: IconName }> = [
  { id: 'attendance', label: 'Wer ist da?', icon: 'people' },
  { id: 'live', label: 'Live-Brett', icon: 'grid' },
  { id: 'summary', label: 'Abschluss', icon: 'flag' },
]

const useStyles = themedStyles(({ c, t }) => ({
  track: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.border,
  },
  step: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  stepActive: { backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent },
  label: { ...t.label, color: c.muted, flexShrink: 1 },
  labelActive: { color: c.text },
  labelDone: { color: c.text },
}))

/** Compact, tappable 3-step indicator for the evening assistant. */
export function StepIndicator({ step, onChange, tourEnabled = false }: { step: EveningStep; onChange: (step: EveningStep) => void; tourEnabled?: boolean }) {
  const styles = useStyles()
  const activeIndex = EVENING_STEPS.findIndex((item) => item.id === step)

  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {EVENING_STEPS.map((item, index) => {
        const active = index === activeIndex
        const done = index < activeIndex
        const iconName = (done ? 'checkmark-circle' : active ? item.icon : `${item.icon}-outline`) as IconName
        const pill = (
          <PressableScale
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Schritt ${index + 1}: ${item.label}`}
            pressedScale={0.96}
            onPress={() => {
              if (active) return
              Feedback.tap()
              onChange(item.id)
            }}
            style={[styles.step, active && styles.stepActive]}
          >
            <Ionicons name={iconName} size={17} color={active ? colors.accentStrong : done ? colors.success : colors.subtle} />
            <Text numberOfLines={1} style={[styles.label, active && styles.labelActive, done && styles.labelDone]}>
              {item.label}
            </Text>
          </PressableScale>
        )
        if (item.id !== 'summary' || !tourEnabled) return pill
        return (
          <TourTarget
            key={item.id}
            id={TOUR_TARGETS.finish}
            onPress={() => { if (!active) onChange(item.id) }}
            style={{ flex: 1, minWidth: 0 }}
          >
            {pill}
          </TourTarget>
        )
      })}
    </View>
  )
}
