// Bundles the server (and the demo snapshot tool) into dist/ with esbuild.
// The app's query layer under ../src is compiled in; @/db/client and
// expo-crypto are swapped for Node implementations.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** @type {esbuild.Plugin} */
const aliasPlugin = {
  name: 'schockboard-alias',
  setup(build) {
    build.onResolve({ filter: /^@\/db\/client$/ }, () => ({ path: path.resolve(here, 'src/snapshot-client.ts') }))
    build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: path.resolve(here, 'src/shims/expo-crypto.ts') }))
    // ../src has no node_modules inside the Docker build; always use the server's copy.
    build.onResolve({ filter: /^zod(\/.*)?$/ }, (args) => ({ path: require.resolve(args.path) }))
    build.onResolve({ filter: /^@\// }, async (args) => {
      const result = await build.resolve(`./${args.path.slice(2)}`, {
        kind: args.kind,
        resolveDir: path.resolve(here, '../src'),
      })
      return result
    })
  },
}

const options = {
  entryPoints: {
    server: path.resolve(here, 'src/index.ts'),
    'make-demo-snapshot': path.resolve(here, 'scripts/make-demo-snapshot.ts'),
  },
  outdir: path.resolve(here, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  legalComments: 'none',
  plugins: [aliasPlugin],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
}

await esbuild.build(options)
