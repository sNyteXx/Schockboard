import { memo, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg'

import { areaPath, labelIndices, niceTicks, polylineLength, smoothPath, toPoints } from '@/components/charts/chart-math'
import { colors, radius, spacing, withAlpha } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const AnimatedPath = Animated.createAnimatedComponent(Path)

export type LineSeries = { id: string; label: string; color: string; points: number[] }

function SeriesPath({ d, color, length, progress, dimmed, width }: { d: string; color: string; length: number; progress: SharedValue<number>; dimmed: boolean; width: number }) {
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }))
  return (
    <AnimatedPath
      d={d}
      stroke={color}
      strokeOpacity={dimmed ? 0.22 : 1}
      strokeWidth={width}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={[length, length]}
      animatedProps={animatedProps}
    />
  )
}

/**
 * Multi-series line chart with y-grid, x labels, draw-in and a tappable
 * legend (tap = focus one series, tap again = all).
 */
export const LineChart = memo(function LineChart({
  series,
  labels,
  height = 200,
  formatY = (value: number) => `${value}`,
  area = series.length === 1,
  legend = series.length > 1,
}: {
  series: LineSeries[]
  labels: string[]
  height?: number
  formatY?: (value: number) => string
  area?: boolean
  legend?: boolean
}) {
  const { t } = useTheme()
  const [width, setWidth] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? 1 : 0)
  const axisWidth = 44
  const bottom = 22
  const top = 8
  const plotWidth = Math.max(0, width - axisWidth - 8)
  const plotHeight = height - bottom - top
  const maxValue = Math.max(0, ...series.flatMap((entry) => entry.points))
  const ticks = useMemo(() => niceTicks(maxValue, 4), [maxValue])
  const yMax = ticks[ticks.length - 1] || 1

  const geometry = useMemo(() => {
    if (plotWidth <= 0) return []
    return series.map((entry) => {
      const points = toPoints(entry.points, plotWidth, plotHeight, { min: 0, max: yMax }).map((point) => ({ x: point.x + axisWidth, y: point.y + top }))
      return { ...entry, coords: points, line: smoothPath(points), area: areaPath(points, top + plotHeight), length: polylineLength(points) * 1.08 + 4 }
    })
  }, [series, plotWidth, plotHeight, yMax])

  const signature = `${series.map((entry) => `${entry.id}:${entry.points.join(',')}`).join('|')}|${plotWidth}`
  useEffect(() => {
    if (plotWidth <= 0) return
    progress.value = reduceMotion ? 1 : 0
    if (!reduceMotion) progress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })
  }, [signature, progress, reduceMotion, plotWidth])

  const xIndices = labelIndices(labels.length, Math.max(2, Math.floor(plotWidth / 72)))
  const stepX = labels.length > 1 ? plotWidth / (labels.length - 1) : 0
  const ordered = focus ? [...geometry.filter((entry) => entry.id !== focus), ...geometry.filter((entry) => entry.id === focus)] : geometry

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={{ height }}
        onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
        accessible
        accessibilityLabel={series.map((entry) => `${entry.label}: ${formatY(entry.points[entry.points.length - 1] ?? 0)}`).join(', ')}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Defs>
              {geometry.map((entry) => (
                <LinearGradient key={entry.id} id={`area-${entry.id}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={entry.color} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={entry.color} stopOpacity={0} />
                </LinearGradient>
              ))}
            </Defs>
            {ticks.map((tick) => {
              const y = top + plotHeight - (tick / yMax) * plotHeight
              return <Line key={tick} x1={axisWidth} x2={width - 8} y1={y} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray={tick === 0 ? undefined : [3, 4]} />
            })}
            {area ? ordered.map((entry) => <Path key={`a-${entry.id}`} d={entry.area} fill={`url(#area-${entry.id})`} opacity={focus && focus !== entry.id ? 0.2 : 1} />) : null}
            {ordered.map((entry) => (
              <SeriesPath key={entry.id} d={entry.line} color={entry.color} length={entry.length} progress={progress} dimmed={!!focus && focus !== entry.id} width={focus === entry.id ? 3 : 2.25} />
            ))}
            {ordered.map((entry) => {
              const last = entry.coords[entry.coords.length - 1]
              if (!last || (focus && focus !== entry.id)) return null
              return <Circle key={`d-${entry.id}`} cx={last.x} cy={last.y} r={3.5} fill={entry.color} stroke={colors.bgElevated} strokeWidth={1.5} />
            })}
          </Svg>
        ) : null}
        {width > 0
          ? ticks.map((tick) => (
              <Text
                key={`y-${tick}`}
                style={[t.caption, { position: 'absolute', left: 0, width: axisWidth - 6, textAlign: 'right', top: top + plotHeight - (tick / yMax) * plotHeight - 8, color: colors.subtle }]}
                numberOfLines={1}
              >
                {formatY(tick)}
              </Text>
            ))
          : null}
        {width > 0
          ? xIndices.map((index) => {
              const single = labels.length === 1
              const first = !single && index === 0
              const lastLabel = !single && index === labels.length - 1
              const left = single ? axisWidth + plotWidth / 2 - 36 : first ? axisWidth : lastLabel ? axisWidth + plotWidth - 72 : axisWidth + index * stepX - 36
              return (
                <Text
                  key={`x-${index}`}
                  style={[t.caption, { position: 'absolute', top: height - bottom + 4, width: 72, left, textAlign: first ? 'left' : lastLabel ? 'right' : 'center', color: colors.subtle }]}
                  numberOfLines={1}
                >
                  {labels[index]}
                </Text>
              )
            })
          : null}
      </View>
      {legend ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {series.map((entry) => {
            const active = focus === entry.id
            const dimmed = !!focus && !active
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${entry.label} hervorheben`}
                onPress={() => setFocus(active ? null : entry.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  minHeight: 32,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? entry.color : colors.border,
                  backgroundColor: active ? withAlpha(entry.color, 0.12) : 'transparent',
                  opacity: pressed ? 0.7 : dimmed ? 0.5 : 1,
                })}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: entry.color }} />
                <Text style={[t.caption, { color: colors.text }]} numberOfLines={1}>{entry.label}</Text>
                <Text style={[t.caption, { color: colors.subtle }]}>{formatY(entry.points[entry.points.length - 1] ?? 0)}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
})
