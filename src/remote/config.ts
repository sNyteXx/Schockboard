import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { DEFAULT_REMOTE_SERVER } from '@/remote/protocol'

const CONFIG_KEY = 'schockboard.remote.config'
const FINGERPRINT_KEY = 'schockboard.remote.uploaded'
const LINK_KEY = 'schockboard.round.host'
const ENROLL_ATTEMPT_KEY = 'schockboard.remote.enroll-attempt'

export type RemoteConfig = { server: string; token: string; pairedAt: string }

/** Built into the app; a dev build may point elsewhere via EXPO_PUBLIC_SCHOCKBOARD_SERVER. */
export function getRemoteServer() {
  return process.env.EXPO_PUBLIC_SCHOCKBOARD_SERVER || DEFAULT_REMOTE_SERVER
}

export function getDeviceName() {
  const name = Constants.deviceName?.trim()
  return `Next · ${name || `${Platform.OS === 'android' ? 'Android' : Platform.OS}-Gerät`}`.slice(0, 80)
}

export const RemoteConfigStore = {
  getLinkedHost() { return SecureStore.getItemAsync(LINK_KEY) },
  setLinkedHost(host: string | null) { return host ? SecureStore.setItemAsync(LINK_KEY, host) : SecureStore.deleteItemAsync(LINK_KEY) },
  async get(): Promise<RemoteConfig | null> {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY)
    if (!raw) return null
    try {
      const config = JSON.parse(raw) as RemoteConfig
      // A token always belongs to the server it was issued by.
      return config.server === getRemoteServer() ? config : null
    } catch {
      return null
    }
  },
  async set(config: RemoteConfig) {
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config))
    await SecureStore.deleteItemAsync(FINGERPRINT_KEY)
  },
  async clear() {
    await SecureStore.deleteItemAsync(CONFIG_KEY)
    await SecureStore.deleteItemAsync(FINGERPRINT_KEY)
  },
  clearUploadedFingerprint() { return SecureStore.deleteItemAsync(FINGERPRINT_KEY) },
  getUploadedFingerprint() {
    return SecureStore.getItemAsync(FINGERPRINT_KEY)
  },
  setUploadedFingerprint(value: string) {
    return SecureStore.setItemAsync(FINGERPRINT_KEY, value)
  },
  async getLastEnrollAttempt() {
    const raw = await SecureStore.getItemAsync(ENROLL_ATTEMPT_KEY)
    return raw ? Number(raw) : 0
  },
  setLastEnrollAttempt(at: number) {
    return SecureStore.setItemAsync(ENROLL_ATTEMPT_KEY, String(at))
  },
}
