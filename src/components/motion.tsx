import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { easeOutCubic } from '@/components/motion-math'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
/** Calm, non-overshooting curve used for all UI motion. */
export const CALM_EASING = Easing.bezier(0.2, 0, 0, 1)
const PRESS_IN = { duration: 120, easing: CALM_EASING }
const PRESS_OUT = { duration: 180, easing: CALM_EASING }
/** Never squish more than 3 % – crisp, not wobbly. */
const MIN_PRESS_SCALE = 0.97

/** Standard entrance for screens and cards (runs once on mount). */
export const enterCard = FadeInDown.duration(220).easing(Easing.out(Easing.cubic)).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).reduceMotion(ReduceMotion.System)
export const enterFade = FadeIn.duration(180).reduceMotion(ReduceMotion.System)

/**
 * Pressable with a subtle squish on touch-down (UI thread). `pressedScale`
 * ~0.97 for big surfaces, ~0.9 for small buttons.
 */
export function PressableScale({
  style,
  pressedScale = 0.97,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>
  pressedScale?: number
  children?: React.ReactNode
}) {
  const scale = useSharedValue(1)
  const reduceMotion = useReducedMotion()
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        if (!reduceMotion) scale.value = withTiming(Math.max(MIN_PRESS_SCALE, pressedScale), PRESS_IN)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, PRESS_OUT)
        onPressOut?.(event)
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  )
}

/**
 * Counts from the previous value to `value` (first mount: from 0). JS-driven
 * on purpose – only a handful of KPI numbers use it, never board tiles.
 */
export function AnimatedNumber({
  value,
  format,
  style,
  duration = 650,
  numberOfLines = 1,
}: {
  value: number
  format: (value: number) => string
  style?: StyleProp<TextStyle>
  duration?: number
  numberOfLines?: number
}) {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState(reduceMotion ? value : 0)
  const fromRef = useRef(reduceMotion ? value : 0)

  useEffect(() => {
    if (reduceMotion) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    if (from === value) return
    const startedAt = Date.now()
    let frame = 0
    const tick = () => {
      const progress = (Date.now() - startedAt) / duration
      const next = progress >= 1 ? value : Math.round(from + (value - from) * easeOutCubic(progress))
      setDisplay(next)
      fromRef.current = next
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduceMotion])

  return (
    <Text style={style} numberOfLines={numberOfLines} adjustsFontSizeToFit={numberOfLines === 1}>
      {format(display)}
    </Text>
  )
}
