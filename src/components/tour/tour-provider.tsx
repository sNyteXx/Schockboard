import * as SecureStore from 'expo-secure-store'
import { useEffect } from 'react'
import { View } from 'react-native'

import { TourOverlay } from '@/components/tour/tour-overlay'
import { TOUR_STORAGE_KEY, parseTourState, serializeTourState, shouldAutoStart } from '@/components/tour/tour-logic'
import { tourStore } from '@/components/tour/tour-store'
import { hasActiveCorePlayers } from '@/hooks/use-onboarding'

/**
 * Mount once inside the tabs layout. Loads/persists progress (secure store
 * key schockboard.tour.v1), auto-starts the first-evening tour once on the
 * dashboard when players exist, and renders the overlay above the tabs.
 */
export function TourProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let alive = true
    let startTimer: ReturnType<typeof setTimeout> | null = null

    tourStore.setPersistor((state) => {
      SecureStore.setItemAsync(TOUR_STORAGE_KEY, serializeTourState(state)).catch(() => {
        // Not persisted – worst case the tour shows up once more.
      })
    })

    void (async () => {
      let raw: string | null = null
      try {
        raw = await SecureStore.getItemAsync(TOUR_STORAGE_KEY)
      } catch {
        raw = null
      }
      // A restart from Setup may already have written a newer state.
      if (alive && tourStore.getPersisted() === null) tourStore.hydrate(parseTourState(raw))
    })()

    const maybeAutoStart = () => {
      const state = tourStore.getPersisted()
      if (!state || tourStore.isRunning() || startTimer) return
      if (state.status !== 'new' || tourStore.getScreen() !== 'dashboard') return
      if (!shouldAutoStart(state, tourStore.getScreen(), hasActiveCorePlayers())) return
      // Outside the store's emit loop; let the dashboard settle first.
      startTimer = setTimeout(() => {
        startTimer = null
        const latest = tourStore.getPersisted()
        if (alive && latest?.status === 'new' && !tourStore.isRunning()) tourStore.start(0)
      }, 450)
    }
    const unsubscribe = tourStore.subscribe(maybeAutoStart)

    return () => {
      alive = false
      if (startTimer) clearTimeout(startTimer)
      unsubscribe()
      tourStore.setPersistor(null)
    }
  }, [])

  return (
    <View style={{ flex: 1 }}>
      {children}
      <TourOverlay />
    </View>
  )
}
