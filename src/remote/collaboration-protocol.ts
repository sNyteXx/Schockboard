import { z } from 'zod'
import type { Achievement } from '@/domain/achievements'
import type { PlayerDebtSummary, SessionDetail } from '@/domain/types'

export const invitePurpose = z.enum(['join', 'transfer'])
export const inviteSchema = z.object({ purpose: invitePurpose })
export const claimSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) })
export const memberRoleSchema = z.object({ role: z.enum(['viewer', 'operator']) })
export const roundCommandSchema = z.object({
  requestId: z.string().uuid(),
  type: z.enum(['loss.record', 'beerround.record', 'payment.record']),
  payload: z.unknown(),
})
export type MemberRole = 'viewer' | 'operator'
export type RoundCommandType = z.infer<typeof roundCommandSchema>['type']
export type Invitation = { id: string; purpose: 'join' | 'transfer'; url: string; svg: string; expiresAt: string }
export type RoundMember = { deviceId: string; label: string; role: MemberRole; lastSeenAt: string | null }
export type TransferState = { id: string; hostId: string; guestId: string | null; status: 'waiting' | 'claimed' | 'completed' | 'cancelled'; expiresAt: string }
export type ConnectionState = {
  deviceId: string
  label: string
  host: { deviceId: string; label: string; role: MemberRole; lastSeenAt: string | null } | null
  members: RoundMember[]
  transfer: TransferState | null
  pendingTransferRequest: boolean
}
export type RoundState = {
  hostLabel: string
  role: MemberRole
  receivedAt: string | null
  session: {
    session: Pick<SessionDetail['session'], 'id' | 'title'>
    attendance: Array<Pick<SessionDetail['attendance'][number], 'playerId' | 'playerName' | 'present'>>
    losses: Array<Pick<SessionDetail['losses'][number], 'playerId' | 'isBeerRound'>>
  } | null
  balances: PlayerDebtSummary[]
  achievements: Achievement[]
  commands: Array<{ id: string; type: string; status: string; error: string | null }>
}

export function invitationCode(value: string) {
  const trimmed = value.trim()
  if (/^[A-Za-z0-9_-]{32,64}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'schockboard-next:' || url.hostname !== 'connect') return null
    return claimSchema.safeParse({ code: url.searchParams.get('code') }).success ? url.searchParams.get('code') : null
  } catch { return null }
}
