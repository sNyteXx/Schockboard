import path from 'node:path'

export type ServerConfig = {
  port: number
  host: string
  dataDir: string
  publicOrigin: string
  /** Directory with the built web UI; null disables static serving. */
  publicDir: string | null
  /** Full access incl. device management. */
  adminEmails: string[]
  /** Data and override commands, but no device management. */
  managerEmails: string[]
  /** Finished commands (applied/rejected/cancelled) older than this are deleted. */
  commandRetentionDays: number
  cfAccessTeamDomain: string
  cfAccessAud: string | null
  devNoAuth: boolean
  maxSnapshotBytes: number
  deviceRateLimitPerMinute: number
}

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024

function parseList(value: string | undefined, fallback: string) {
  return (value ?? fallback)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function stripOrigin(value: string) {
  const url = new URL(value)
  return url.origin
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, defaultPublicDir: string | null = null): ServerConfig {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? 'snytex.cloudflareaccess.com')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR ?? '/data'),
    publicOrigin: stripOrigin(env.PUBLIC_ORIGIN ?? 'https://sh0ckb04rd.snytex.de'),
    publicDir: env.PUBLIC_DIR ? path.resolve(env.PUBLIC_DIR) : defaultPublicDir,
    adminEmails: parseList(env.ADMIN_EMAILS, 'snytex@snytex.de'),
    managerEmails: parseList(env.MANAGER_EMAILS, ''),
    commandRetentionDays: Math.max(1, Number(env.COMMAND_RETENTION_DAYS ?? 30) || 30),
    cfAccessTeamDomain: teamDomain,
    cfAccessAud: env.CF_ACCESS_AUD?.trim() || null,
    devNoAuth: env.DEV_NO_AUTH === '1',
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    deviceRateLimitPerMinute: Number(env.DEVICE_RATE_LIMIT_PER_MINUTE ?? 120),
  }
}
