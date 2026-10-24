import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/session-service', () => ({
  SessionService: { deleteLastLoss: vi.fn() },
}))

import { UndoService } from '@/services/undo-service'
import { SessionService } from '@/services/session-service'

const actor = { accountId: 'local', username: 'Dieses Gerät' }

describe('precise undo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(SessionService.deleteLastLoss).mockReset()
    UndoService.cancelPendingUndo()
  })

  afterEach(() => {
    UndoService.cancelPendingUndo()
    vi.useRealTimers()
  })

  it('undoes the exact recorded entry, not just the newest entry for a player', async () => {
    UndoService.scheduleUndo({ type: 'loss', sessionId: 'evening', playerId: 'player', entryId: 'loss_123', label: 'Verlust' }, () => {})
    await UndoService.executeUndo(actor)
    expect(SessionService.deleteLastLoss).toHaveBeenCalledWith({ actor, sessionId: 'evening', playerId: 'player', entryId: 'loss_123' })
    expect(UndoService.getPendingUndo()).toBeNull()
  })

  it('expires and notifies subscribers without a permanent polling timer', () => {
    const listener = vi.fn()
    const unsubscribe = UndoService.subscribe(listener)
    UndoService.scheduleUndo({ type: 'beerround', sessionId: 'evening', playerId: 'player', entryId: 'beer_123', label: 'Bierrunde' }, () => {}, 5000)
    expect(UndoService.getPendingUndo()?.entryId).toBe('beer_123')
    vi.advanceTimersByTime(5001)
    expect(UndoService.getPendingUndo()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3) // immediate, scheduled, expired
    unsubscribe()
  })
})
