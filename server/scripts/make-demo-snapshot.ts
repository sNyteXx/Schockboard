import fs from 'node:fs'
import path from 'node:path'

import { buildDemoSnapshot } from './demo-data'

/**
 * Usage: node dist/make-demo-snapshot.js <out.sqlite> [--wal] [--plain]
 * Writes a demo DB built with the app's queries (incl. two cashbox withdrawals unless --plain).
 */
const out = path.resolve(process.argv[2] ?? 'demo-snapshot.sqlite')
fs.rmSync(out, { force: true })
const ids = buildDemoSnapshot(out, { wal: process.argv.includes('--wal'), withdrawals: !process.argv.includes('--plain') })
console.log(JSON.stringify({ file: out, ...ids }, null, 2))
