import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { syncBackgroundRegistration } from '@/remote/background'
import { RemoteConfigStore } from '@/remote/config'
import { SyncEngine } from '@/remote/sync-engine'

const CHANGE_DEBOUNCE_MS = 3_000
const FOREGROUND_INTERVAL_MS = 60_000

/**
 * Invisible sync: after local changes, when the app comes to the foreground,
 * once a minute while open, and every ~15 minutes in the background.
 */
export function useRemoteSync({ ready, dataVersion, onRemoteChanges }: {
  ready: boolean
  dataVersion: number
  onRemoteChanges: () => void
}) {
  const onRemoteChangesRef = useRef(onRemoteChanges)
  onRemoteChangesRef.current = onRemoteChanges

  useEffect(() => {
    if (!ready) return
    let interval: ReturnType<typeof setInterval> | null = null

    const start = () => {
      void SyncEngine.syncNow()
      interval ??= setInterval(() => void SyncEngine.syncNow(), FOREGROUND_INTERVAL_MS)
    }
    const stop = () => {
      if (interval) clearInterval(interval)
      interval = null
    }

    void RemoteConfigStore.get().then((config) => syncBackgroundRegistration(Boolean(config)))
    const unsubscribe = SyncEngine.subscribe((outcome) => {
      if (outcome.status === 'ok' && outcome.applied > 0) onRemoteChangesRef.current()
      if (outcome.status === 'not-paired') stop()
    })
    const appState = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()))
    start()

    return () => {
      stop()
      unsubscribe()
      appState.remove()
    }
  }, [ready])

  // Debounced upload after local bookings.
  useEffect(() => {
    if (!ready || dataVersion === 0) return
    const timer = setTimeout(() => void SyncEngine.syncNow(), CHANGE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [ready, dataVersion])
}
