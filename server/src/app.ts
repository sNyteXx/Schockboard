import fs from 'node:fs'
import path from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { JWTVerifyGetKey } from 'jose'

import { initializeConnections } from './connections'
import { createAdminAuth, type AppEnv } from './auth'
import type { ServerConfig } from './config'
import { adminRoutes } from './routes/admin'
import { deviceRoutes } from './routes/device'
import { NoSnapshotError } from './snapshot-client'
import type { SnapshotManager } from './snapshot'
import type { Store } from './store'

export type AppDeps = {
  config: ServerConfig
  store: Store
  snapshots: SnapshotManager
  /** Override for tests; defaults to the Cloudflare Access team JWKS. */
  jwks?: JWTVerifyGetKey
  log?: (message: string) => void
}

export function createApp(deps: AppDeps) {
  const { config, store, snapshots } = deps
  initializeConnections(store)
  const log = deps.log ?? ((message: string) => console.log(message))
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: 'same-origin',
    })
  )

  app.onError((error, c) => {
    if (error instanceof NoSnapshotError) {
      return c.json({ error: 'no_snapshot' }, 409)
    }
    // Never log request headers/bodies: they may contain the device token.
    log(`[error] ${c.req.method} ${c.req.path}: ${error instanceof Error ? error.message : String(error)}`)
    return c.json({ error: 'internal_error' }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))

  app.route('/api/device', deviceRoutes({ config, store, snapshots }))

  // Everything else (admin API and the web UI itself) sits behind Cloudflare Access.
  const adminAuth = createAdminAuth(config, deps.jwks)
  app.use('/api/admin/*', adminAuth)
  app.route('/api/admin', adminRoutes({ config, store, snapshots }))
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  const publicDir = config.publicDir
  if (publicDir && fs.existsSync(path.join(publicDir, 'index.html'))) {
    const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    app.use('*', adminAuth)
    app.use('/assets/*', async (c, next) => {
      await next()
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
    })
    app.use('*', serveStatic({ root: publicDir }))
    // SPA fallback for client-side routes.
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache')
      return c.html(indexHtml)
    })
  } else {
    app.use('*', adminAuth)
    app.get('*', (c) => c.text('Web-Oberfläche nicht gebaut (npm run build:web).', 404))
  }

  return app
}
