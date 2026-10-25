import { memo, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { areaPath, polylineLength, smoothPath, toPoints } from '@/components/charts/chart-math'

const AnimatedPath = Animated.createAnimatedComponent(Path)

/** Tiny trend line with soft area fill; measures its own width. */
export const Sparkline = memo(function Sparkline({
  data,
  height = 32,
  color,
  strokeWidth = 2,
  fill = true,
  showLastDot = true,
}: {
  data: number[]
  height?: number
  color: string
  strokeWidth?: number
  fill?: boolean
  showLastDot?: boolean
}) {
  const [width, setWidth] = useState(0)
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? 1 : 0)
  const pad = strokeWidth + 2
  const geometry = useMemo(() => {
    if (width <= 0 || data.length === 0) return null
    const points = toPoints(data, width - pad * 2, height, { padY: pad }).map((point) => ({ x: point.x + pad, y: point.y }))
    return { points, line: smoothPath(points), area: areaPath(points, height), length: polylineLength(points) * 1.08 + 4 }
  }, [data, width, height, pad])

  useEffect(() => {
    if (!geometry) return
    progress.value = reduceMotion ? 1 : 0
    if (!reduceMotion) progress.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })
  }, [geometry, progress, reduceMotion])

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: (geometry?.length ?? 0) * (1 - progress.value) }))
  const gradientId = useMemo(() => `spark-${Math.random().toString(36).slice(2, 8)}`, [])
  const last = geometry?.points[geometry.points.length - 1]

  return (
    <View style={{ height }} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} accessible={false}>
      {geometry ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {fill ? <Path d={geometry.area} fill={`url(#${gradientId})`} /> : null}
          <AnimatedPath
            d={geometry.line}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[geometry.length, geometry.length]}
            animatedProps={animatedProps}
          />
          {showLastDot && last ? <Circle cx={last.x} cy={last.y} r={strokeWidth + 1} fill={color} /> : null}
        </Svg>
      ) : null}
    </View>
  )
})
