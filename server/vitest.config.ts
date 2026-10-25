import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // node:sqlite databases and module-level state (active snapshot) are per worker.
    fileParallelism: false,
  },
  resolve: {
    alias: [
      { find: /^@\/db\/client$/, replacement: path.resolve(here, 'src/snapshot-client.ts') },
      { find: /^@\//, replacement: `${path.resolve(here, '../src')}/` },
      { find: /^expo-crypto$/, replacement: path.resolve(here, 'src/shims/expo-crypto.ts') },
      { find: /^zod$/, replacement: require.resolve('zod') },
    ],
  },
})
