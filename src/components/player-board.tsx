import Ionicons from '@expo/vector-icons/Ionicons'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { PlayerAvatar } from '@/components/avatar'
import { CALM_EASING, PressableScale } from '@/components/motion'
import { Badge } from '@/components/ui'
import { formatCurrency } from '@/domain/format'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { Feedback } from '@/services/haptics'
import { colors, radius, spacing } from '@/theme/tokens'
import { themedStyles, useTheme } from '@/theme/use-theme'

export type BoardPlayer = {
  id: string
  name: string
  isCore: boolean
  lossCount: number
  todayCents: number
}

/** A second "+" on the same tile within this window is treated as a double tap and ignored. */
export const DOUBLE_TAP_GUARD_MS = 350
const SWIPE_ACTION_WIDTH = 104

/** Returns true when a tap at `now` should be accepted (pure, for tests). */
export function acceptTap(lastAcceptedAt: number, now: number, windowMs = DOUBLE_TAP_GUARD_MS) {
  return now - lastAcceptedAt >= windowMs
}

const useStyles = themedStyles(({ c, t }) => ({
  tile: {
    minWidth: 0,
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  tileLeader: { borderColor: c.borderStrong, backgroundColor: c.surface },
  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, borderWidth: 2, borderColor: c.accent },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40 },
  name: { ...t.subheading, color: c.text, flexShrink: 1 },
  meta: { ...t.caption, color: c.subtle },
  countRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xs },
  count: { ...t.scoreboard, color: c.text },
  countLabel: { ...t.overline, color: c.subtle },
  amount: { ...t.numericSm, color: c.text, textAlign: 'right' },
  amountLabel: { ...t.caption, color: c.subtle, textAlign: 'right' },
  minus: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.surfaceSoft,
  },
  plus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, backgroundColor: c.accent },
  voidLabel: { ...t.overline, color: c.danger },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  overline: { ...t.overline, color: c.subtle },
  heading: { ...t.heading, color: c.text },
  hint: { ...t.caption, color: c.subtle },
  empty: { ...t.body, color: c.muted },
}))

/** Red "Storno" panel revealed when a tile is swiped to the left. */
function VoidAction({ progress }: { progress: SharedValue<number> }) {
  const styles = useStyles()
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.value * 1.4), transform: [{ translateX: (1 - Math.min(1, progress.value)) * 12 }] }))
  return (
    <View style={{ width: SWIPE_ACTION_WIDTH, justifyContent: 'center', alignItems: 'flex-end', paddingRight: spacing.md }}>
      <Animated.View style={[{ alignItems: 'center', gap: 4 }, style]}>
        <Ionicons name="arrow-undo" size={26} color={colors.danger} />
        <Text style={styles.voidLabel}>Storno</Text>
      </Animated.View>
    </View>
  )
}

type TileProps = {
  player: BoardPlayer
  width: number | '100%'
  /** Large scoreboard sizing (table mode on big tablets). */
  big: boolean
  leader: boolean
  swipeToVoid: boolean
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}

const PlayerTile = memo(
  function PlayerTile({ player, width, big, leader, swipeToVoid, isClosed, onAdd, onRemove }: TileProps) {
    const styles = useStyles()
    const { layout } = useTheme()
    const reduceMotion = useReducedMotion()
    const bump = useSharedValue(0)
    const flash = useSharedValue(0)
    const previousCount = useRef(player.lossCount)
    const lastAddAt = useRef(0)
    const swipeRef = useRef<SwipeableMethods>(null)

    // Calm feedback on change: the new digit slides in (from below on +,
    // from above on −) while fading up, and the border glows briefly.
    useEffect(() => {
      if (previousCount.current === player.lossCount) return
      const increased = player.lossCount > previousCount.current
      previousCount.current = player.lossCount
      if (!reduceMotion) {
        bump.value = increased ? 1 : -1
        bump.value = withTiming(0, { duration: 180, easing: CALM_EASING })
      }
      flash.value = withSequence(withTiming(0.85, { duration: 90, easing: CALM_EASING }), withTiming(0, { duration: 360, easing: CALM_EASING }))
    }, [player.lossCount, bump, flash, reduceMotion])

    const counterStyle = useAnimatedStyle(() => ({
      opacity: 1 - Math.abs(bump.value) * 0.6,
      transform: [{ translateY: bump.value * 8 }],
    }))
    const glowStyle = useAnimatedStyle(() => ({ opacity: flash.value }))
    const canRemove = !isClosed && player.lossCount > 0

    // Button sizes: phones 56, tablets 64, table mode ≥ 80 dp.
    const buttonHeight = big ? Math.round(72 * layout.typeScale) : layout.isTablet ? 64 : 56
    const minusWidth = big ? Math.round(buttonHeight * 0.95) : buttonHeight - 8
    const avatarSize = big ? 44 : layout.isTablet ? 40 : 36

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

    const tile = (
      <Animated.View
        entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
        layout={LinearTransition.duration(200).easing(CALM_EASING).reduceMotion(ReduceMotion.System)}
        style={[styles.tile, leader && styles.tileLeader, { width: swipeToVoid ? '100%' : width }, big && { padding: spacing.md, gap: spacing.md }]}
      >
        <Animated.View pointerEvents="none" style={[styles.flash, glowStyle]} />
        <View style={styles.nameRow}>
          <PlayerAvatar id={player.id} name={player.name} size={avatarSize} ring={leader} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{player.name}</Text>
            {leader ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="flame" size={12} color={colors.accentStrong} />
                <Text style={[styles.meta, { color: colors.accentStrong }]} numberOfLines={1}>Pechvogel</Text>
              </View>
            ) : !player.isCore ? (
              <Text style={styles.meta} numberOfLines={1}>Gast</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.countRow}>
          <View>
            <Animated.Text style={[styles.count, counterStyle, { transformOrigin: 'left bottom' }]} accessibilityLabel={`${player.lossCount} Verluste`}>
              {player.lossCount}
            </Animated.Text>
            <Text style={styles.countLabel}>{player.lossCount === 1 ? 'Verlust' : 'Verluste'}</Text>
          </View>
          <View style={{ flexShrink: 1, paddingBottom: 2 }}>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>{formatCurrency(player.todayCents)}</Text>
            <Text style={styles.amountLabel}>heute</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Letzten Verlust von ${player.name} stornieren`}
            accessibilityState={{ disabled: !canRemove }}
            disabled={!canRemove}
            onPress={handleRemove}
            hitSlop={4}
            pressedScale={0.9}
            style={[styles.minus, { width: minusWidth, height: buttonHeight, opacity: canRemove ? 1 : 0.35 }]}
          >
            <Ionicons name="remove" size={big ? 30 : 24} color={colors.text} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Verlust für ${player.name} buchen`}
            accessibilityState={{ disabled: isClosed }}
            disabled={isClosed}
            onPress={handleAdd}
            hitSlop={4}
            pressedScale={0.94}
            style={[styles.plus, { height: buttonHeight, opacity: isClosed ? 0.4 : 1 }]}
          >
            <Ionicons name="add" size={big ? 44 : 34} color={colors.buttonPrimaryText} />
          </PressableScale>
        </View>
      </Animated.View>
    )

    if (!swipeToVoid) return tile

    return (
      <ReanimatedSwipeable
        ref={swipeRef}
        // Stays enabled while closing; a swipe with nothing to void just snaps back.
        enabled={!isClosed}
        friction={1.6}
        rightThreshold={SWIPE_ACTION_WIDTH * 0.6}
        overshootRight={false}
        containerStyle={{ width, borderRadius: radius.lg }}
        renderRightActions={(progress) => <VoidAction progress={progress} />}
        onSwipeableWillOpen={() => {
          if (canRemove) handleRemove()
          swipeRef.current?.close()
        }}
      >
        {tile}
      </ReanimatedSwipeable>
    )
  },
  (previous, next) =>
    previous.player.id === next.player.id &&
    previous.player.name === next.player.name &&
    previous.player.isCore === next.player.isCore &&
    previous.player.lossCount === next.player.lossCount &&
    previous.player.todayCents === next.player.todayCents &&
    previous.width === next.width &&
    previous.big === next.big &&
    previous.leader === next.leader &&
    previous.swipeToVoid === next.swipeToVoid &&
    previous.isClosed === next.isClosed &&
    previous.onAdd === next.onAdd &&
    previous.onRemove === next.onRemove
)

/** Ids of the player(s) with the most losses tonight (none while everyone is at 0). */
export function leaderIds(players: BoardPlayer[]) {
  const max = players.reduce((value, player) => Math.max(value, player.lossCount), 0)
  return new Set(max > 0 ? players.filter((player) => player.lossCount === max).map((player) => player.id) : [])
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
  showHeader = true,
  emptyHint = 'Noch niemand anwesend. Aktiviere im Schritt „Wer ist da?“ die gewünschten Spieler.',
}: {
  players: BoardPlayer[]
  stakeCents: number
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  /** Fixed column count (table mode uses 3–4). Defaults to what fits the width. */
  columns?: number
  /** Large scoreboard tiles for the table mode. */
  dense?: boolean
  /** Swipe a tile to the left to void its last loss (phones). */
  swipeToVoid?: boolean
  showHeader?: boolean
  emptyHint?: string
}) {
  const styles = useStyles()
  const { width, isTablet, pagePadding } = useDeviceLayout()
  const [gridWidth, setGridWidth] = useState(0)
  const gap = isTablet ? spacing.sm : spacing.xs + 4

  // Stable callbacks: a booking re-renders only the tiles whose numbers changed.
  const addRef = useRef(onAdd)
  const removeRef = useRef(onRemove)
  addRef.current = onAdd
  removeRef.current = onRemove
  const stableAdd = useCallback((id: string) => addRef.current(id), [])
  const stableRemove = useCallback((id: string) => removeRef.current(id), [])

  // Before the first layout pass estimate the grid width from the window.
  const measured = gridWidth > 0 ? gridWidth : width - pagePadding * 2 - (isTablet ? 100 : 0)
  const minTile = isTablet ? 200 : 168
  const columns = Math.max(1, columnsOverride ?? Math.min(4, Math.floor((measured + gap) / (minTile + gap))))
  const tileWidth: number | '100%' = columns <= 1 ? '100%' : Math.floor((measured - gap * (columns - 1)) / columns)
  const leaders = leaderIds(players)

  return (
    <View style={{ gap: spacing.sm }}>
      {showHeader ? (
        <View style={styles.headerRow}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={styles.overline}>Live am Tisch</Text>
            <Text style={styles.heading}>Schnellbuchung</Text>
          </View>
          <Badge tone="accent" icon="add-circle">{`${formatCurrency(stakeCents)} je Verlust`}</Badge>
        </View>
      ) : null}

      {players.length === 0 ? (
        <Text style={styles.empty}>{emptyHint}</Text>
      ) : (
        <View
          onLayout={(event) => setGridWidth(Math.floor(event.nativeEvent.layout.width))}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'stretch' }}
        >
          {players.map((player) => (
            <PlayerTile
              key={player.id}
              player={player}
              width={tileWidth}
              big={dense}
              leader={leaders.has(player.id)}
              swipeToVoid={swipeToVoid && !isClosed}
              isClosed={isClosed}
              onAdd={stableAdd}
              onRemove={stableRemove}
            />
          ))}
        </View>
      )}
      {swipeToVoid && !isClosed && players.some((player) => player.lossCount > 0) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="swap-horizontal" size={14} color={colors.subtle} />
          <Text style={styles.hint}>Kachel nach links wischen storniert den letzten Verlust.</Text>
        </View>
      ) : null}
    </View>
  )
}
