import * as SecureStore from 'expo-secure-store'

const CONFIG_KEY = 'schockboard.remote.config'
const FINGERPRINT_KEY = 'schockboard.remote.uploaded'

export type RemoteConfig = { server: string; token: string; pairedAt: string }

// A pairing link uploads the whole database, so it must never point to a
// foreign server, even if someone sends a crafted link.
const ALLOWED_SERVER_HOSTS = ['sh0ckb04rd.snytex.de']

export function normalizeServerOrigin(input: string) {
  const url = new URL(input)
  if (url.protocol !== 'https:') throw new Error('Der Server muss per HTTPS erreichbar sein.')
  if (!ALLOWED_SERVER_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(`Unbekannter Server ${url.hostname} – Kopplung abgelehnt.`)
  }
  return url.origin
}

export const RemoteConfigStore = {
  async get(): Promise<RemoteConfig | null> {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as RemoteConfig
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
  getUploadedFingerprint() {
    return SecureStore.getItemAsync(FINGERPRINT_KEY)
  },
  setUploadedFingerprint(value: string) {
    return SecureStore.setItemAsync(FINGERPRINT_KEY, value)
  },
}
