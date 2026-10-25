import type { SnapshotManager } from './snapshot'
import type { Store } from './store'

/**
 * Startup step after openStore() (which already upgraded server.db in one
 * transaction): moves the single-device `snapshot.sqlite` to
 * `snapshots/<deviceId>.sqlite` of the device that inherited it. Idempotent:
 * without a pending owner or legacy file nothing happens.
 */
export function migrateLegacySnapshot(store: Store, snapshots: SnapshotManager, log: (message: string) => void = console.log) {
  const owner = store.pendingLegacySnapshotOwner()
  const result = snapshots.migrateLegacy(owner)
  if (result === 'moved') log(`[schockboard] snapshot.sqlite → snapshots/${owner}.sqlite verschoben.`)
  if (result === 'kept') log('[schockboard] snapshot.sqlite (altes Format) bleibt unverändert liegen: kein Zielgerät oder Ziel existiert schon.')
  if (owner && result !== 'kept') store.clearLegacySnapshotOwner()
  return result
}
