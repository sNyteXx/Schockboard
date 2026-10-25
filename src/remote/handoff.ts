import * as SecureStore from 'expo-secure-store'
import { setHandoffLocked } from '@/domain/write-access'

export type Handoff = { kind: 'source' | 'receiver'; id?: string; backup?: string }
const KEY = 'schockboard.handoff'
export const HandoffStore = {
  async get(): Promise<Handoff | null> {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    // An unreadable transfer marker must keep this device locked.
    try { return JSON.parse(raw) as Handoff } catch { return { kind: 'source' } }
  },
  async set(value: Handoff | null) {
    if (value) {
      setHandoffLocked(true)
      await SecureStore.setItemAsync(KEY, JSON.stringify(value))
    } else {
      await SecureStore.deleteItemAsync(KEY)
      setHandoffLocked(false)
    }
  },
  async initialize() { setHandoffLocked(Boolean(await this.get())) },
}
