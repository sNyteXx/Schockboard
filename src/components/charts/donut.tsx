import { memo, useEffect, useMemo } from 'react'
import { Text, View } from 'react-native'
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Circle, G } from 'react-native-svg'

import { donutArcs } from '@/components/charts/chart-math'
import { colors, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export type DonutDatum = { key: string; label: string; value: number; color: string; display?: string }

/**
 * One ring layer showing 0 → `end` of the circle. Layers are painted from the
 * longest to the shortest so each segment covers the next one's start – this
 * keeps the draw-in on a plain numeric strokeDashoffset (UI thread).
 */
function Arc({ cx, r, thickness, color, end, circumference, progress }: {
  cx: number; r: number; thickness: number; color: string; end: number; circumference: number
  progress: { value: number }
}) {
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference - end * progress.value }))
  return (
    <AnimatedCircle
      cx={cx}
      cy={cx}
      r={r}
      stroke={color}
      strokeWidth={thickness}
      fill="none"
      strokeLinecap="butt"
      strokeDasharray={[circumference, circumference]}
      animatedProps={animatedProps}
    />
  )
}

/** Donut with centre label and optional legend (right on wide, below otherwise). */
export const Donut = memo(function Donut({
  data,
  size = 140,
  thickness = 14,
  centerValue,
  centerLabel,
  legend = true,
  legendPosition = 'right',
}: {
  data: DonutDatum[]
  size?: number
  thickness?: number
  centerValue?: string
  centerLabel?: string
  legend?: boolean
  legendPosition?: 'right' | 'bottom'
}) {
  const { t } = useTheme()
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? 1 : 0)
  const r = (size - thickness) / 2
  const circumference = 2 * Math.PI * r
  const arcs = useMemo(() => donutArcs(data.map((d) => ({ key: d.key, value: d.value, color: d.color })), circumference), [data, circumference])
  const signature = arcs.map((arc) => `${arc.key}:${arc.fraction.toFixed(3)}`).join('|')

  useEffect(() => {
    progress.value = reduceMotion ? 1 : 0
    if (!reduceMotion) progress.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) })
  }, [signature, progress, reduceMotion])

  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0)

  return (
    <View
      accessible
      accessibilityLabel={data.map((d) => `${d.label}: ${d.display ?? d.value}`).join(', ')}
      style={{ flexDirection: legendPosition === 'right' ? 'row' : 'column', alignItems: 'center', gap: spacing.lg - 4 }}
    >
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceSoft} strokeWidth={thickness} fill="none" />
            {[...arcs].reverse().map((arc) => (
              <Arc key={arc.key} cx={size / 2} r={r} thickness={thickness} color={arc.color} end={arc.offset + arc.length} circumference={circumference} progress={progress} />
            ))}
          </G>
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: thickness + 4 }}>
          {centerValue ? <Text style={[t.numeric, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{centerValue}</Text> : null}
          {centerLabel ? <Text style={[t.overline, { color: colors.subtle }]} numberOfLines={1}>{centerLabel}</Text> : null}
        </View>
      </View>
      {legend ? (
        <View style={{ gap: spacing.sm, flex: legendPosition === 'right' ? 1 : undefined, minWidth: 0, alignSelf: legendPosition === 'bottom' ? 'stretch' : undefined }}>
          {data.map((d) => (
            <View key={d.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: d.color }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.caption, { color: colors.muted }]} numberOfLines={1}>{d.label}</Text>
                <Text style={[t.numericSm, { color: colors.text }]} numberOfLines={1}>
                  {d.display ?? d.value}
                  {total > 0 ? <Text style={[t.caption, { color: colors.subtle }]}>{`  ${Math.round((Math.max(0, d.value) / total) * 100)} %`}</Text> : null}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
})
