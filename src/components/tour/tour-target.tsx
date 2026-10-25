import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Dimensions, View, type ScrollView, type StyleProp, type ViewStyle } from 'react-native'

import type { TourScreen } from '@/components/tour/tour-logic'
import { tourStore, type TourScroller } from '@/components/tour/tour-store'

/** Provided by <Screen> around its scroll content (null outside scroll views). */
export const TourScrollContext = createContext<TourScroller | null>(null)

/** Scroller for a ScrollView: brings a target to ~22 % from the top. */
export function useTourScroller(scrollRef: RefObject<ScrollView | null>, innerRef: RefObject<View | null>): TourScroller {
  return useMemo(
    () => ({
      reveal(target: View) {
        const scroll = scrollRef.current
        const inner = innerRef.current
        if (!scroll || !inner) return
        target.measureLayout(
          inner,
          (_x, y) => scroll.scrollTo({ y: Math.max(0, y - Dimensions.get('window').height * 0.22), animated: true }),
          () => {},
        )
      },
    }),
    [scrollRef, innerRef],
  )
}

/**
 * Registers a tour target. Spread the result on a host <View>. No state, no
 * subscription: renders of the owner are unaffected by the tour. `onPress`
 * is what a "perform" step runs when the highlighted area is tapped.
 */
export function useTourTarget(id: string, options?: { onPress?: () => void; enabled?: boolean }) {
  const ref = useRef<View>(null)
  const action = useRef(options?.onPress)
  action.current = options?.onPress
  const scroller = useContext(TourScrollContext)
  const enabled = options?.enabled ?? true

  useEffect(() => {
    if (!enabled) return
    return tourStore.registerTarget(id, { ref, action, scroller })
  }, [id, enabled, scroller])

  const onLayout = useCallback(() => tourStore.targetLayoutChanged(id), [id])
  return { ref, onLayout, collapsable: false as const }
}

/** Wrapper view registering its children as a tour target. */
export function TourTarget({
  id,
  onPress,
  enabled,
  style,
  children,
}: {
  id: string
  onPress?: () => void
  enabled?: boolean
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
}) {
  const target = useTourTarget(id, { onPress, enabled })
  return (
    <View {...target} style={style}>
      {children}
    </View>
  )
}

/** Marks `name` as the focused tour screen while `active`. */
export function useTourScreen(name: TourScreen, active: boolean) {
  useEffect(() => {
    if (!active) return
    tourStore.setScreen(name, true)
    return () => tourStore.setScreen(name, false)
  }, [name, active])
}

/** Restart from Setup ("Einführung erneut zeigen"). */
export function restartTour() {
  tourStore.start(0)
}
