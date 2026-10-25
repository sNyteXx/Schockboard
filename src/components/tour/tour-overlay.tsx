import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AccessibilityInfo, BackHandler, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  FadeOut,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path, Rect as SvgRect } from 'react-native-svg'

import { CALM_EASING, PressableScale } from '@/components/motion'
import {
  TARGET_GRACE_MS,
  blockerRects,
  evaluateStep,
  isRectVisible,
  nextIndex,
  placeTooltip,
  previousShowableIndex,
  sameRect,
  spotlightPath,
  spotlightRect,
  stepCounter,
  tooltipWidth,
  type Insets,
  type Rect,
  type Size,
  type TourStep,
} from '@/components/tour/tour-logic'
import { tourStore } from '@/components/tour/tour-store'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles } from '@/theme/use-theme'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedRect = Animated.createAnimatedComponent(SvgRect)

const DIM = 'rgba(0, 0, 0, 0.72)'
const HOLE_PADDING = 6
const HOLE_RADIUS = 14
const MOVE_MS = 220
const CARD_MS = 200

/**
 * Renders the active tour step (if any). Subscribes to the tour store; while
 * the tour is idle or waiting for its screen this renders nothing.
 */
export function TourOverlay() {
  useSyncExternalStore(tourStore.subscribe, tourStore.getVersion, tourStore.getVersion)
  const missing = useRef<{ index: number; since: number } | null>(null)

  const running = tourStore.isRunning()
  const steps = tourStore.getSteps()
  const index = tourStore.getIndex()
  const step = running ? steps[index] : undefined
  const screen = tourStore.getScreen()
  const targets = tourStore.getTargetIds()
  const waitedMs = missing.current && missing.current.index === index ? Date.now() - missing.current.since : 0
  const decision = step ? evaluateStep(step, { screen, targets, waitedMs }) : null

  useEffect(() => {
    if (!decision) {
      missing.current = null
      return
    }
    if (decision.kind === 'skip' || decision.kind === 'complete') {
      missing.current = null
      tourStore.goTo(nextIndex(steps, index))
      return
    }
    if (decision.kind === 'wait' && decision.missingTarget) {
      if (!missing.current || missing.current.index !== index) missing.current = { index, since: Date.now() }
      const timer = setTimeout(() => tourStore.poke(), TARGET_GRACE_MS + 40)
      return () => clearTimeout(timer)
    }
    missing.current = null
  })

  if (!step || decision?.kind !== 'show') return null
  const previous = previousShowableIndex(steps, index, { screen, targets })
  return <Spotlight step={step} index={index} total={steps.length} targetId={decision.targetId} previous={previous} />
}

function Spotlight({ step, index, total, targetId, previous }: { step: TourStep; index: number; total: number; targetId: string | null; previous: number | null }) {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const { isTablet } = useDeviceLayout()
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<View>(null)
  const origin = useRef({ x: 0, y: 0 })
  const [viewport, setViewport] = useState<Size>(() => {
    const window = Dimensions.get('window')
    return { width: window.width, height: window.height }
  })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const insetsRef = useRef<Insets>(insets)
  insetsRef.current = insets
  const bottomReserve = isTablet ? 24 : 140

  const key = `${index}:${targetId ?? ''}`
  const [rect, setRect] = useState<Rect | null>(null)
  const [measuredFor, setMeasuredFor] = useState<string | null>(null)
  const [cardHeight, setCardHeight] = useState(190)
  const ready = measuredFor === key

  // Measure the target (window coordinates → overlay coordinates). Scrolls
  // it into view once if it sits outside the visible band.
  useEffect(() => {
    if (!targetId) {
      setRect(null)
      setMeasuredFor(key)
      return
    }
    let alive = true
    let revealed = false
    const timers: Array<ReturnType<typeof setTimeout>> = []
    const measure = () => {
      const entry = tourStore.getTarget(targetId)
      const view = entry?.ref.current
      if (!entry || !view) return
      view.measureInWindow((x, y, width, height) => {
        if (!alive || (width === 0 && height === 0)) return
        const next = { x: x - origin.current.x, y: y - origin.current.y, width, height }
        if (!revealed && entry.scroller && !isRectVisible(next, viewportRef.current, insetsRef.current, bottomReserve)) {
          revealed = true
          entry.scroller.reveal(view)
          timers.push(setTimeout(measure, 380))
          return
        }
        setRect((previousRect) => (sameRect(previousRect, next) ? previousRect : next))
        setMeasuredFor(key)
      })
    }
    measure()
    timers.push(setTimeout(measure, 250))
    // Cheap safety net for layout transitions and keyboard/scroll shifts.
    const interval = setInterval(measure, 600)
    const offLayout = tourStore.onTargetLayout((id) => {
      if (id === targetId) measure()
    })
    return () => {
      alive = false
      timers.forEach(clearTimeout)
      clearInterval(interval)
      offLayout()
    }
  }, [key, targetId, bottomReserve])

  const hole = rect && targetId ? spotlightRect(rect, viewport, HOLE_PADDING) : null

  // Animated spotlight geometry (UI thread).
  const hx = useSharedValue(0)
  const hy = useSharedValue(0)
  const hw = useSharedValue(0)
  const hh = useSharedValue(0)
  const vw = useSharedValue(viewport.width)
  const vh = useSharedValue(viewport.height)
  const dim = useSharedValue(0)
  const card = useSharedValue(0)
  const shown = useRef(false)

  useEffect(() => {
    vw.value = viewport.width
    vh.value = viewport.height
  }, [viewport, vw, vh])

  useEffect(() => {
    if (!ready) return
    const target = hole ?? { x: viewport.width / 2, y: viewport.height / 2, width: 0, height: 0 }
    const duration = reduceMotion || !shown.current ? 0 : MOVE_MS
    const config = { duration, easing: CALM_EASING }
    hx.value = withTiming(target.x, config)
    hy.value = withTiming(target.y, config)
    hw.value = withTiming(target.width, config)
    hh.value = withTiming(target.height, config)
    if (!shown.current) {
      shown.current = true
      dim.value = withTiming(1, { duration: reduceMotion ? 0 : CARD_MS, easing: CALM_EASING })
    }
  }, [ready, hole?.x, hole?.y, hole?.width, hole?.height, viewport.width, viewport.height]) // eslint-disable-line react-hooks/exhaustive-deps

  // Card fades/scales in per step.
  useEffect(() => {
    if (!ready) {
      card.value = 0
      return
    }
    card.value = withTiming(1, { duration: reduceMotion ? 0 : CARD_MS, easing: CALM_EASING })
    AccessibilityInfo.announceForAccessibility(`Einführung, Schritt ${index + 1} von ${total}. ${step.title}. ${step.body}`)
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Android back = skip the tour.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      tourStore.finish('skipped')
      return true
    })
    return () => subscription.remove()
  }, [])

  const pathProps = useAnimatedProps(() => ({ d: spotlightPath(vw.value, vh.value, hx.value, hy.value, hw.value, hh.value, HOLE_RADIUS) }))
  const ringProps = useAnimatedProps(() => ({
    x: hx.value,
    y: hy.value,
    width: hw.value,
    height: hh.value,
    opacity: hw.value > 1 ? 1 : 0,
  }))
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }))
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value, transform: [{ scale: 0.96 + card.value * 0.04 }] }))

  const width = tooltipWidth(viewport.width, insets)
  const placement = placeTooltip({ target: hole, viewport, insets, size: { width, height: cardHeight } })
  const isLast = index === total - 1

  const action = () => (targetId ? tourStore.getTarget(targetId)?.action.current : undefined)
  const advance = () => tourStore.goTo(nextIndex(tourStore.getSteps(), index))
  const onNext = () => {
    if (step.nextPerformsAction) action()?.()
    advance()
  }
  const onHolePress = () => {
    if (step.targetPress === 'perform') {
      const run = action()
      run?.()
      if (step.advanceAfterPerform !== false && (run || !step.requiresTargetTap)) advance()
    } else if (step.targetPress === 'advance') {
      advance()
    }
  }

  return (
    <Animated.View
      ref={rootRef}
      collapsable={false}
      exiting={FadeOut.duration(160).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, dimStyle]}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout
        setViewport((current) => (current.width === w && current.height === h ? current : { width: w, height: h }))
        rootRef.current?.measureInWindow((x, y) => {
          origin.current = { x, y }
        })
      }}
    >
      <Svg width={viewport.width} height={viewport.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <AnimatedPath animatedProps={pathProps} fill={DIM} fillRule="evenodd" />
        <AnimatedRect animatedProps={ringProps} rx={HOLE_RADIUS} ry={HOLE_RADIUS} fill="none" stroke={colors.accent} strokeWidth={2} />
      </Svg>

      {/* Dim area swallows touches without doing anything. */}
      {blockerRects(ready ? hole : null, viewport).map((block, blockIndex) => (
        <View
          key={blockIndex}
          importantForAccessibility="no-hide-descendants"
          onStartShouldSetResponder={() => true}
          style={{ position: 'absolute', left: block.x, top: block.y, width: block.width, height: block.height }}
        />
      ))}

      {ready && hole && step.targetPress !== 'passthrough' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step.targetPress === 'perform' ? step.title : `${step.title} – weiter`}
          onPress={onHolePress}
          style={{ position: 'absolute', left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: HOLE_RADIUS }}
        />
      ) : null}

      <Animated.View
        accessibilityViewIsModal
        accessibilityLiveRegion="polite"
        pointerEvents={ready ? 'auto' : 'none'}
        onLayout={(event) => {
          const h = Math.round(event.nativeEvent.layout.height)
          setCardHeight((current) => (Math.abs(current - h) < 1 ? current : h))
        }}
        style={[styles.card, { left: placement.left, top: placement.top, width: placement.width }, cardStyle]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badge}>
            <Ionicons name="sparkles" size={12} color={colors.accentStrong} />
            <Text style={styles.overline}>Einführung</Text>
          </View>
          <Text style={styles.counter} accessibilityLabel={`Schritt ${index + 1} von ${total}`}>{stepCounter(index, total)}</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
        {step.requiresTargetTap ? (
          <View style={styles.hintRow}>
            <Ionicons name="hand-left-outline" size={14} color={colors.accentStrong} />
            <Text style={styles.hint}>Tippe auf die markierte Stelle.</Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <TourButton label="Überspringen" tone="ghost" onPress={() => tourStore.finish('skipped')} />
          <View style={{ flex: 1 }} />
          {previous !== null ? <TourButton label="Zurück" tone="secondary" onPress={() => tourStore.goTo(previous)} /> : null}
          {!step.requiresTargetTap ? (
            <TourButton label={isLast ? 'Fertig' : 'Weiter'} icon={isLast ? 'checkmark' : 'arrow-forward'} tone="primary" onPress={onNext} />
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  )
}

function TourButton({ label, tone, icon, onPress }: { label: string; tone: 'primary' | 'secondary' | 'ghost'; icon?: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  const styles = useStyles()
  const fg = tone === 'primary' ? colors.buttonPrimaryText : tone === 'ghost' ? colors.muted : colors.text
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={[styles.button, tone === 'primary' && styles.buttonPrimary, tone === 'secondary' && styles.buttonSecondary]}
    >
      <Text style={[styles.buttonLabel, { color: fg }]} numberOfLines={1}>{label}</Text>
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
    </PressableScale>
  )
}

const useStyles = themedStyles(({ c, t }) => ({
  card: {
    position: 'absolute',
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    padding: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.accentSoft },
  overline: { ...t.overline, color: c.accentStrong },
  counter: { ...t.numericSm, color: c.muted },
  title: { ...t.heading, color: c.text },
  body: { ...t.body, color: c.muted },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { ...t.caption, color: c.accentStrong },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  button: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  buttonPrimary: { backgroundColor: c.accent, paddingHorizontal: spacing.md },
  buttonSecondary: { backgroundColor: c.surfaceSoft, borderWidth: 1, borderColor: c.borderStrong },
  buttonLabel: { ...t.label },
}))
