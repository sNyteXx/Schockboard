import { z } from 'zod'

/**
 * Wire contract between the Schockboard app (the authoritative database) and
 * the remote admin server at sh0ckb04rd.snytex.de.
 *
 * Direction up:   the device uploads a full SQLite snapshot after changes.
 * Direction down: the web admin queues commands; the device pulls, applies
 *                 them locally through the normal domain functions and
 *                 reports a result per command. The server never edits data.
 *
 * Device endpoints (Authorization: Bearer <device token>):
 *   GET  /api/device/commands            → DeviceCommandsResponse (pending, oldest first)
 *   POST /api/device/commands/results    ← CommandResultsRequest
 *   PUT  /api/device/snapshot            ← raw SQLite bytes, Content-Type application/vnd.sqlite3,
 *                                          headers X-Schockboard-Schema, X-Snapshot-Created-At
 *   GET  /api/device/ping                → { ok: true }
 * Pairing link shown as QR code in the web admin:
 *   schockboard://pair?server=<https origin>&token=<device token>
 */

export const PROTOCOL_VERSION = 1

const id = z.string().min(1).max(80)
const cents = z.number().int().min(-1_000_000).max(1_000_000)

export const commandSchemas = {
  'correction.record': z.object({
    playerId: id,
    amountCents: cents.refine((value) => value !== 0, 'Betrag darf nicht 0 sein.'),
    reason: z.string().trim().min(1).max(200),
    sessionId: id.nullable().optional(),
  }),
  'payment.record': z.object({
    playerId: id,
    amountCents: cents.refine((value) => value > 0, 'Zahlung muss positiv sein.'),
    note: z.string().trim().max(200).nullable().optional(),
  }),
  'player.create': z.object({
    name: z.string().trim().min(1).max(60),
    isCore: z.boolean(),
  }),
  'player.update': z.object({
    playerId: id,
    isCore: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  }),
  'settings.update': z.object({
    defaultStakeCents: z.number().int().min(0).max(100_000),
    cashboxLabel: z.string().trim().min(1).max(60),
    absencePenaltyMode: z.enum(['none', 'full_average', 'split_absent']),
  }),
  /** Removes a booked loss or beer round of an evening that is still open. */
  'loss.void': z.object({
    sessionId: id,
    playerId: id,
    entryId: id,
  }),
} as const

export type CommandType = keyof typeof commandSchemas
export const COMMAND_TYPES = Object.keys(commandSchemas) as CommandType[]

export type CommandPayload<T extends CommandType> = z.infer<(typeof commandSchemas)[T]>

export const remoteCommandSchema = z.object({
  id,
  type: z.enum(COMMAND_TYPES as [CommandType, ...CommandType[]]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  /** Email of the admin who queued the command (Cloudflare Access identity). */
  createdBy: z.string().max(200),
})
export type RemoteCommand = z.infer<typeof remoteCommandSchema>

export const deviceCommandsResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commands: z.array(remoteCommandSchema),
})
export type DeviceCommandsResponse = z.infer<typeof deviceCommandsResponseSchema>

export const commandResultSchema = z.object({
  id,
  status: z.enum(['applied', 'rejected']),
  error: z.string().max(500).nullable().optional(),
  appliedAt: z.string(),
})
export type CommandResult = z.infer<typeof commandResultSchema>

export const commandResultsRequestSchema = z.object({
  results: z.array(commandResultSchema).max(200),
})

/** Validates a command's payload for its type; throws a ZodError on mismatch. */
export function parseCommandPayload<T extends CommandType>(type: T, payload: unknown): CommandPayload<T> {
  return commandSchemas[type].parse(payload) as CommandPayload<T>
}

export function buildPairingUrl(server: string, token: string) {
  return `schockboard://pair?server=${encodeURIComponent(server)}&token=${encodeURIComponent(token)}`
}
