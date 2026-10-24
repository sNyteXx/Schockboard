import fs from 'node:fs'
import path from 'node:path'

import { buildDemoSnapshot } from './demo-data'

/** Usage: node dist/make-demo-snapshot.js <out.sqlite> — writes a demo DB built with the app's queries. */
const out = path.resolve(process.argv[2] ?? 'demo-snapshot.sqlite')
fs.rmSync(out, { force: true })
const ids = buildDemoSnapshot(out, { wal: process.argv.includes('--wal') })
console.log(JSON.stringify({ file: out, ...ids }, null, 2))
