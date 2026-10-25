import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadConfig } from './config'
import { migrateLegacySnapshot } from './migrate'
import { createSnapshotManager } from './snapshot'
import { openStore } from './store'

const here = path.dirname(fileURLToPath(import.meta.url))
const config = loadConfig(process.env, path.join(here, 'public'))

fs.mkdirSync(config.dataDir, { recursive: true })
const store = openStore(path.join(config.dataDir, 'server.db'))
const snapshots = createSnapshotManager(config.dataDir)

// One-time move of the single-device snapshot.sqlite to snapshots/<deviceId>.sqlite (idempotent).
try {
  migrateLegacySnapshot(store, snapshots)
} catch (error) {
  console.error(`[schockboard] Snapshot-Umstellung fehlgeschlagen: ${(error as Error).message}`)
}
const devices = store.listActiveDevices()
console.log(`[schockboard] ${devices.length} aktive(s) Gerät(e), ${devices.filter((device) => snapshots.has(device.id)).length} mit Datenstand.`)

if (config.devNoAuth) {
  const banner = '!'.repeat(72)
  console.warn(`${banner}\n!! DEV_NO_AUTH=1: Admin-Authentifizierung ist DEAKTIVIERT.\n!! Niemals so in Produktion betreiben!\n${banner}`)
}

// Retention of the command history: finished commands older than COMMAND_RETENTION_DAYS (counts only, no payloads).
function purgeOldCommands() {
  const deleted = store.purgeFinishedCommands(config.commandRetentionDays)
  if (deleted > 0) console.log(`[schockboard] ${deleted} abgeschlossene Aufträge (älter als ${config.commandRetentionDays} Tage) gelöscht.`)
}
purgeOldCommands()
const retentionTimer = setInterval(purgeOldCommands, 24 * 60 * 60 * 1000)
retentionTimer.unref()

const app = createApp({ config, store, snapshots })
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[schockboard] Server läuft auf http://${config.host}:${info.port} (Daten: ${config.dataDir})`)
})

function shutdown(signal: string) {
  console.log(`[schockboard] ${signal} empfangen, beende…`)
  clearInterval(retentionTimer)
  server.close(() => {
    snapshots.close()
    store.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
