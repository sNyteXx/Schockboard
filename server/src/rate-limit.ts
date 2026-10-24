import type { Context, MiddlewareHandler } from 'hono'

/** Client IP as seen behind Cloudflare Tunnel; falls back to the socket address. */
export function clientIp(c: Context) {
  const forwarded = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]
  if (forwarded) return forwarded.trim()
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

/** Small in-memory fixed-window limiter (single instance deployment). */
export function rateLimit(options: { limit: number; windowMs: number; now?: () => number }): MiddlewareHandler {
  const now = options.now ?? Date.now
  const buckets = new Map<string, { count: number; resetAt: number }>()

  return async (c, next) => {
    const at = now()
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key)
    }
    const key = clientIp(c)
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= at) {
      bucket = { count: 0, resetAt: at + options.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count++
    if (bucket.count > options.limit) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - at) / 1000)))
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }
}
