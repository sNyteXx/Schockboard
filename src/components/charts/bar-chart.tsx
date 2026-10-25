import { memo, useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import { PlayerAvatar } from '@/components/avatar'
import { ratio } from '@/components/charts/chart-math'
import { colors, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export type BarDatum = {
  id: string
  label: string
  value: number
  /** Formatted value shown at the end of the row. */
  display: string
  sublabel?: string
  color?: string
  /** Show a player avatar (id + name) in front of the label. */
  avatar?: { id: string; name: string }
  /** Optional second, stacked part of the bar (e.g. absence on top of losses). */
  secondary?: { value: number; color: string }
}

function Bar({ value, secondary, max, color, delay, height }: { value: number; secondary?: BarDatum['secondary']; max: number; color: string; delay: number; height: number }) {
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? 1 : 0)
  const primary = ratio(value, max)
  const extra = secondary ? ratio(secondary.value, max) : 0
  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1
      return
    }
    progress.value = 0
    progress.value = withDelay(delay, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }))
  }, [primary, extra, delay, progress, reduceMotion])
  const primaryStyle = useAnimatedStyle(() => ({ width: `${Math.max(primary > 0 ? 1.5 : 0, primary * 100 * progress.value)}%` }))
  const secondaryStyle = useAnimatedStyle(() => ({ width: `${extra * 100 * progress.value}%` }))
  return (
    <View style={{ height, borderRadius: radius.pill, backgroundColor: colors.surfaceSoft, overflow: 'hidden', flexDirection: 'row' }}>
      <Animated.View style={[{ height, backgroundColor: color, borderRadius: radius.pill }, primaryStyle]} />
      {secondary ? <Animated.View style={[{ height, backgroundColor: secondary.color, marginLeft: 2, borderRadius: radius.pill }, secondaryStyle]} /> : null}
    </View>
  )
}

/**
 * Horizontal ranking bars with optional avatars. The first row is drawn in
 * the accent colour when `highlightFirst` is set, others in `color`.
 */
export const BarChart = memo(function BarChart({
  data,
  max,
  color,
  highlightFirst = true,
  showRank = false,
  barHeight = 8,
  onPressItem,
  trailing,
  animate = true,
}: {
  data: BarDatum[]
  max?: number
  color?: string
  highlightFirst?: boolean
  showRank?: boolean
  barHeight?: number
  onPressItem?: (item: BarDatum) => void
  /** Extra element per row (e.g. a pay button). */
  trailing?: (item: BarDatum) => React.ReactNode
  animate?: boolean
}) {
  const { t } = useTheme()
  const resolvedMax = max ?? Math.max(1, ...data.map((item) => item.value + (item.secondary?.value ?? 0)))
  const base = color ?? colors.muted
  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((item, index) => {
        const barColor = item.color ?? (highlightFirst && index === 0 ? colors.accent : base)
        const content = (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {showRank ? (
              <Text style={[t.numericSm, { width: 22, textAlign: 'right', color: index < 3 ? colors.accentStrong : colors.subtle }]}>{index + 1}</Text>
            ) : null}
            {item.avatar ? <PlayerAvatar id={item.avatar.id} name={item.avatar.name} size={32} /> : null}
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
                <Text style={[t.bodyStrong, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>{item.label}</Text>
                {item.sublabel ? <Text style={[t.caption, { color: colors.subtle, flexShrink: 1 }]} numberOfLines={1}>{item.sublabel}</Text> : null}
                <View style={{ flex: 1 }} />
                <Text style={[t.numericSm, { color: colors.text }]}>{item.display}</Text>
              </View>
              <Bar value={item.value} secondary={item.secondary} max={resolvedMax} color={barColor} delay={animate ? Math.min(index, 8) * 45 : 0} height={barHeight} />
            </View>
            {trailing ? trailing(item) : null}
          </View>
        )
        return onPressItem ? (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label}: ${item.display}`} onPress={() => onPressItem(item)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            {content}
          </Pressable>
        ) : (
          <View key={item.id} accessible accessibilityLabel={`${item.label}: ${item.display}`}>{content}</View>
        )
      })}
    </View>
  )
})
