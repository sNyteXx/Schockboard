import { z } from 'zod'

/**
 * Wire contract between the Schockboard app (the authoritative database) and
 * the remote admin server at sh0ckb04rd.snytex.de.
 *
 * Direction up:   the device uploads a full SQLite snapshot after changes.
 * Direction down: the web admin queues commands; the device pulls, applies
 *                 them locally and reports a result per command. The server
 *                 never edits data. Admin commands are silent: they write no
 *                 audit events and no receipts into the app.
 *
 * Enrollment (no token; the app does this by itself on first start):
 *   POST /api/device/enroll              ← EnrollRequest → EnrollResponse, or 403 enrollment_closed
 *   Open only while no device was ever enrolled, or for a short window the
 *   admin opens in the web UI ("Neues Gerät zulassen").
 * Device endpoints (Authorization: Bearer <device token>):
 *   GET  /api/device/commands            → DeviceCommandsResponse (pending, oldest first)
 *   POST /api/device/commands/results    ← CommandResultsRequest
 *   PUT  /api/device/snapshot            ← raw SQLite bytes, Content-Type application/vnd.sqlite3,
 *                                          headers X-Schockboard-Schema, X-Snapshot-Created-At
 *   GET  /api/device/ping                → { ok: true }
 */

export const PROTOCOL_VERSION = 1

const id = z.string().min(1).max(80)
const cents = z.number().int().min(-1_000_000).max(1_000_000)

export const commandSchemas = {
  'loss.record': z.object({ sessionId: id, playerId: id, note: z.string().trim().max(200).nullable().optional() }),
  'beerround.record': z.object({ sessionId: id, playerId: id, amountCents: cents.refine(value => value > 0), note: z.string().trim().max(200).nullable().optional() }),
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
    hapticsEnabled: z.boolean().optional(),
    achievementAnimations: z.boolean().optional(),
    autoBackup: z.boolean().optional(),
  }),
  /** Removes a booked loss or beer round of an evening that is still open. */
  'loss.void': z.object({
    sessionId: id,
    playerId: id,
    entryId: id,
  }),

  // ---- admin overrides: edit history directly, open or closed evenings ----
  /** Deletes any booking; nothing in the app's log points to the change. */
  'entry.delete': z.object({
    kind: z.enum(['loss', 'payment', 'correction', 'absence', 'withdrawal']),
    entryId: id,
  }),
  /** Changes amount and/or note of any booking (loss incl. beer round). */
  'entry.update': z.object({
    kind: z.enum(['loss', 'payment', 'correction', 'absence', 'withdrawal']),
    entryId: id,
    amountCents: cents.optional(),
    note: z.string().trim().max(200).nullable().optional(),
  }),
  'player.rename': z.object({
    playerId: id,
    name: z.string().trim().min(1).max(60),
  }),
  /** Title/stake of an evening; a changed stake does not reprice old bookings. */
  'session.update': z.object({
    sessionId: id,
    title: z.string().trim().min(1).max(80).optional(),
    stakeCents: z.number().int().min(0).max(100_000).optional(),
  }),
  /** Removes an evening with all its bookings and absence charges. */
  'session.delete': z.object({
    sessionId: id,
  }),
  /** Takes money out of the cashbox (purchases); player balances unchanged. */
  'cashbox.withdraw': z.object({
    amountCents: cents.refine((value) => value > 0, 'Betrag muss positiv sein.'),
    note: z.string().trim().min(1).max(200),
  }),
  /** Removes individual entries of the app's log (audit_events). */
  'audit.delete': z.object({
    auditIds: z.array(id).min(1).max(500),
  }),
  /** Empties the app's log, optionally only entries created before a date. */
  'audit.purge': z.object({
    before: z.string().datetime().optional(),
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

/** Admin server every app build talks to; there is no user-facing pairing. */
export const DEFAULT_REMOTE_SERVER = 'https://sh0ckb04rd.snytex.de'

export const enrollRequestSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
})
export const enrollResponseSchema = z.object({
  token: z.string().min(20),
  deviceId: id,
})
export type EnrollResponse = z.infer<typeof enrollResponseSchema>
