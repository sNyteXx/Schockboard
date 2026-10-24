import { useKeepAwake } from 'expo-keep-awake'
import * as NavigationBar from 'expo-navigation-bar'
import { useEffect } from 'react'
import { Platform } from 'react-native'

/** Keeps the display on while mounted (render it only during a live evening). */
export function KeepAwakeWhileLive() {
  useKeepAwake('schockboard-live')
  return null
}

function setVisibility(visibility: 'hidden' | 'visible') {
  try {
    NavigationBar.setVisibilityAsync(visibility).catch(() => undefined)
  } catch {
    // Native module missing (e.g. Expo Go / web) – nothing to hide.
  }
}

/**
 * Hides the Android navigation bar while mounted (table mode) and restores it
 * on unmount. Failures (unsupported device / edge-to-edge quirks) are ignored.
 */
export function HideNavigationBar() {
  useEffect(() => {
    if (Platform.OS !== 'android') return
    setVisibility('hidden')
    return () => setVisibility('visible')
  }, [])
  return null
}
