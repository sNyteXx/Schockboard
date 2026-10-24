import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

import type { ServerConfig } from './config'
import type { DeviceRow, Store } from './store'

export type AppVariables = {
  adminEmail: string
  device: DeviceRow
}

export type AppEnv = { Variables: AppVariables }

export const CF_ACCESS_HEADER = 'cf-access-jwt-assertion'

/** Cloudflare Access verification: signature (team JWKS), issuer, optional audience, email allow-list. */
export function createAdminAuth(config: ServerConfig, jwks?: JWTVerifyGetKey): MiddlewareHandler<AppEnv> {
  const issuer = `https://${config.cfAccessTeamDomain}`
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  const allowed = new Set(config.adminEmails.map((email) => email.toLowerCase()))

  return async (c, next) => {
    if (config.devNoAuth) {
      c.set('adminEmail', 'dev@localhost')
      return next()
    }

    const assertion = c.req.header(CF_ACCESS_HEADER)
    if (!assertion) {
      return c.json({ error: 'unauthorized', message: 'Cloudflare-Access-Anmeldung fehlt.' }, 401)
    }

    let email: unknown
    try {
      const { payload } = await jwtVerify(assertion, keySet, {
        issuer,
        ...(config.cfAccessAud ? { audience: config.cfAccessAud } : {}),
        algorithms: ['RS256', 'ES256', 'EdDSA'],
      })
      email = payload.email
    } catch {
      return c.json({ error: 'unauthorized', message: 'Ungültiges Cloudflare-Access-Token.' }, 401)
    }

    if (typeof email !== 'string' || !allowed.has(email.toLowerCase())) {
      return c.json({ error: 'forbidden', message: 'Dieses Konto ist nicht freigeschaltet.' }, 403)
    }

    c.set('adminEmail', email.toLowerCase())
    return next()
  }
}

/** Bearer token of the paired device; every authenticated request refreshes lastSeenAt. */
export function createDeviceAuth(store: Store): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})\s*$/.exec(header)
    const device = match ? store.authenticateDevice(match[1]) : null
    if (!device) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'unauthorized' }, 401)
    }
    store.touchDevice(device.id)
    c.set('device', device)
    return next()
  }
}
