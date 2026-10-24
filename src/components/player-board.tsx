import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, {
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { formatCurrency } from '@/domain/format'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { Feedback } from '@/services/haptics'
import { colors, radius, spacing } from '@/theme/tokens'

export type BoardPlayer = {
  id: string
  name: string
  isCore: boolean
  lossCount: number
  todayCents: number
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const PRESS_SPRING = { damping: 15, stiffness: 420, mass: 0.6 }
/** A second "+" on the same tile within this window is treated as a double tap and ignored. */
export const DOUBLE_TAP_GUARD_MS = 350
const SWIPE_ACTION_WIDTH = 104

/** Returns true when a tap at `now` should be accepted (pure, for tests). */
export function acceptTap(lastAcceptedAt: number, now: number, windowMs = DOUBLE_TAP_GUARD_MS) {
  return now - lastAcceptedAt >= windowMs
}

/** Pressable that squishes on touch-down and springs back on release. */
function SpringButton({
  disabled,
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  disabled: boolean
  onPress: () => void
  accessibilityLabel: string
  style: object
  children: React.ReactNode
}) {
  const scale = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={() => { scale.value = withSpring(0.9, PRESS_SPRING) }}
      onPressOut={() => { scale.value = withSpring(1, PRESS_SPRING) }}
      onPress={onPress}
      hitSlop={6}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  )
}

/** Red "Storno" panel revealed when a tile is swiped to the left. */
function VoidAction({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.value * 1.4), transform: [{ scale: 0.8 + Math.min(1, progress.value) * 0.2 }] }))
  return (
    <View style={{ width: SWIPE_ACTION_WIDTH, justifyContent: 'center', alignItems: 'flex-end', paddingRight: spacing.md }}>
      <Animated.View style={[{ alignItems: 'center', gap: 2 }, style]}>
        <Text style={{ color: colors.danger, fontSize: 24, fontWeight: '900' }}>↩</Text>
        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '900', letterSpacing: 1 }}>STORNO</Text>
      </Animated.View>
    </View>
  )
}

function PlayerTile({
  player,
  width,
  dense,
  swipeToVoid,
  isClosed,
  onAdd,
  onRemove,
}: {
  player: BoardPlayer
  width: number | '100%'
  dense: boolean
  swipeToVoid: boolean
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const bump = useSharedValue(1)
  const flash = useSharedValue(0)
  const previousCount = useRef(player.lossCount)
  const lastAddAt = useRef(0)
  const swipeRef = useRef<SwipeableMethods>(null)

  // Pop the counter and flash the tile border whenever the count changes.
  useEffect(() => {
    if (previousCount.current === player.lossCount) return
    const increased = player.lossCount > previousCount.current
    previousCount.current = player.lossCount
    bump.value = withSequence(withTiming(increased ? 1.35 : 0.75, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 260 }))
    flash.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 520 }))
  }, [player.lossCount, bump, flash])

  const counterStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: flash.value }))
  const canRemove = !isClosed && player.lossCount > 0

  function handleAdd() {
    const now = Date.now()
    if (!acceptTap(lastAddAt.current, now)) return
    lastAddAt.current = now
    Feedback.booked()
    onAdd(player.id)
  }

  function handleRemove() {
    Feedback.reverted()
    onRemove(player.id)
  }

  const minusButton = (
    <SpringButton
      accessibilityLabel={`Letzten Verlust von ${player.name} stornieren`}
      disabled={!canRemove}
      onPress={handleRemove}
      style={{
        minWidth: dense ? 46 : 50,
        minHeight: dense ? 50 : 54,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceSoft,
        opacity: canRemove ? 1 : 0.3,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>−</Text>
    </SpringButton>
  )

  const plusButton = (
    <SpringButton
      accessibilityLabel={`Verlust für ${player.name} buchen`}
      disabled={isClosed}
      onPress={handleAdd}
      style={{
        minWidth: 56,
        minHeight: dense ? 50 : 56,
        flexGrow: dense ? 1 : 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        backgroundColor: colors.accent,
        opacity: isClosed ? 0.4 : 1,
      }}
    >
      <Text style={{ color: colors.buttonPrimaryText, fontSize: 30, fontWeight: '900' }}>＋</Text>
    </SpringButton>
  )

  const counter = (
    <View style={{ alignItems: 'center', minWidth: 34 }}>
      <Animated.Text style={[{ color: colors.text, fontSize: dense ? 38 : 29, fontWeight: '900', fontVariant: ['tabular-nums'] }, counterStyle]}>
        {player.lossCount}
      </Animated.Text>
      <Text style={{ color: colors.muted, fontSize: 10 }}>VERLUSTE</Text>
    </View>
  )

  const tile = (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.springify().damping(18)}
      style={{
        width: swipeToVoid ? '100%' : width,
        minWidth: 0,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        padding: dense ? spacing.sm : spacing.md,
        gap: spacing.sm,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', inset: 0, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent }, glowStyle]}
      />
      <View style={{ minHeight: dense ? 36 : 44, gap: 4 }}>
        <Text style={{ fontSize: dense ? 16 : 17, color: colors.text, fontWeight: '900' }} numberOfLines={dense ? 1 : 2}>{player.name}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{player.isCore ? 'STAMMRUNDE' : 'GAST'} · {formatCurrency(player.todayCents)}</Text>
      </View>
      {dense ? (
        <>
          {counter}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            {minusButton}
            {plusButton}
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }}>
          {minusButton}
          {counter}
          {plusButton}
        </View>
      )}
    </Animated.View>
  )

  if (!swipeToVoid) return tile

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={canRemove}
      friction={1.6}
      rightThreshold={SWIPE_ACTION_WIDTH * 0.6}
      overshootRight={false}
      containerStyle={{ width, borderRadius: radius.lg }}
      renderRightActions={(progress) => <VoidAction progress={progress} />}
      onSwipeableWillOpen={() => {
        handleRemove()
        swipeRef.current?.close()
      }}
    >
      {tile}
    </ReanimatedSwipeable>
  )
}

export function PlayerBoard({
  players,
  stakeCents,
  isClosed,
  onAdd,
  onRemove,
  columns: columnsOverride,
  dense = false,
  swipeToVoid = false,
  emptyHint = 'Noch niemand anwesend. Aktiviere im Schritt „Wer ist da?“ die gewünschten Spieler.',
}: {
  players: BoardPlayer[]
  stakeCents: number
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  /** Fixed column count (table mode uses 3–4). Defaults to 1–2 by width. */
  columns?: number
  /** Compact vertical tiles for narrow multi-column grids. */
  dense?: boolean
  /** Swipe a tile to the left to void its last loss (phones). */
  swipeToVoid?: boolean
  emptyHint?: string
}) {
  const { width, isTablet, isWide } = useDeviceLayout()
  const columns = columnsOverride ?? (isWide || isTablet || width >= 400 ? 2 : 1)
  const [gridWidth, setGridWidth] = useState(0)
  const gap = spacing.sm
  const tileWidth: number | '100%' = columns <= 1 || gridWidth <= 0 ? '100%' : Math.floor((gridWidth - gap * (columns - 1)) / columns)

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Text style={{ color: colors.accentStrong, fontSize: 11, letterSpacing: 1.8, fontWeight: '900' }}>LIVE AM TISCH</Text>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 23, letterSpacing: -0.5 }}>Schnellbuchung</Text>
        </View>
        <View style={{ backgroundColor: colors.surfaceSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 8 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>+ {formatCurrency(stakeCents)} / Verlust</Text>
        </View>
      </View>

      {players.length === 0 ? (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>{emptyHint}</Text>
      ) : (
        <View
          onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'stretch' }}
        >
          {players.map((player) => (
            <PlayerTile
              key={player.id}
              player={player}
              width={tileWidth}
              dense={dense}
              swipeToVoid={swipeToVoid && !isClosed}
              isClosed={isClosed}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </View>
      )}
      {swipeToVoid && !isClosed && players.some((player) => player.lossCount > 0) ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Tipp: Kachel nach links wischen storniert den letzten Verlust.</Text>
      ) : null}
    </View>
  )
}
