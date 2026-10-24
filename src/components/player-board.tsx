import { useEffect, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, {
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
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

function PlayerTile({
  player,
  wide,
  isClosed,
  onAdd,
  onRemove,
}: {
  player: BoardPlayer
  wide: boolean
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const bump = useSharedValue(1)
  const flash = useSharedValue(0)
  const previousCount = useRef(player.lossCount)

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

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.springify().damping(18)}
      style={{
        width: wide ? '48%' : '100%',
        flexGrow: 1,
        minWidth: 0,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', inset: 0, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent }, glowStyle]}
      />
      <View style={{ minHeight: 44, gap: 4 }}>
        <Text style={{ fontSize: 17, color: colors.text, fontWeight: '900' }} numberOfLines={2}>{player.name}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{player.isCore ? 'STAMMRUNDE' : 'GAST'} · {formatCurrency(player.todayCents)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }}>
        <SpringButton
          accessibilityLabel={`Letzten Verlust von ${player.name} stornieren`}
          disabled={!canRemove}
          onPress={() => { Feedback.reverted(); onRemove(player.id) }}
          style={{
            minWidth: 50,
            minHeight: 54,
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
        <View style={{ alignItems: 'center', minWidth: 34 }}>
          <Animated.Text style={[{ color: colors.text, fontSize: 29, fontWeight: '900', fontVariant: ['tabular-nums'] }, counterStyle]}>
            {player.lossCount}
          </Animated.Text>
          <Text style={{ color: colors.muted, fontSize: 10 }}>VERLUSTE</Text>
        </View>
        <SpringButton
          accessibilityLabel={`Verlust für ${player.name} buchen`}
          disabled={isClosed}
          onPress={() => { Feedback.booked(); onAdd(player.id) }}
          style={{
            minWidth: 56,
            minHeight: 56,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            backgroundColor: colors.accent,
            opacity: isClosed ? 0.4 : 1,
          }}
        >
          <Text style={{ color: colors.buttonPrimaryText, fontSize: 30, fontWeight: '900' }}>＋</Text>
        </SpringButton>
      </View>
    </Animated.View>
  )
}

export function PlayerBoard({
  players,
  stakeCents,
  isClosed,
  onAdd,
  onRemove,
}: {
  players: BoardPlayer[]
  stakeCents: number
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { width, isTablet, isWide } = useDeviceLayout()
  const columns = isWide || isTablet || width >= 400 ? 2 : 1

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
        <Text style={{ color: colors.muted, lineHeight: 22 }}>Noch niemand anwesend. Aktiviere rechts beziehungsweise unterhalb des Bretts die gewünschten Spieler.</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'stretch' }}>
          {players.map((player) => (
            <PlayerTile
              key={player.id}
              player={player}
              wide={columns === 2}
              isClosed={isClosed}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </View>
      )}
    </View>
  )
}
