import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'

import { SessionService } from '@/services/session-service'

const ONBOARDING_SKIPPED_KEY = 'schockboard.onboarding.skipped'

export function hasActiveCorePlayers() {
  try {
    return SessionService.listPlayers().some((player) => player.isCore && !player.isArchived)
  } catch {
    return true // never trap the user in onboarding because of a read error
  }
}

export async function markOnboardingSkipped() {
  try {
    await SecureStore.setItemAsync(ONBOARDING_SKIPPED_KEY, '1')
  } catch {
    // Not persisted – the assistant simply shows up again next start.
  }
}

async function wasOnboardingSkipped() {
  try {
    return (await SecureStore.getItemAsync(ONBOARDING_SKIPPED_KEY)) === '1'
  } catch {
    return false
  }
}

/** Resolves where the app should start: onboarding on a fresh install, else the tabs. */
export function useStartTarget() {
  const [target, setTarget] = useState<'/onboarding' | '/(tabs)' | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const needsOnboarding = !hasActiveCorePlayers() && !(await wasOnboardingSkipped())
      if (active) setTarget(needsOnboarding ? '/onboarding' : '/(tabs)')
    })()
    return () => {
      active = false
    }
  }, [])

  return target
}
