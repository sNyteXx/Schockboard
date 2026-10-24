import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${path.resolve(here, '../../src')}/` }],
  },
  build: {
    outDir: path.resolve(here, '../dist/public'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
})
