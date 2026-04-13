import { SessionService } from '@/services/session-service'

type UndoAction = {
  type: 'loss' | 'beerround'
  sessionId: string
  playerId: string
  label: string
}

type Actor = {
  accountId: string
  username: string
}

let pendingUndo: (UndoAction & { timeoutId: ReturnType<typeof setTimeout> }) | null = null

export const UndoService = {
  getPendingUndo() {
    return pendingUndo ? { ...pendingUndo, timeoutId: undefined } : null
  },

  scheduleUndo(action: UndoAction, onExpire: () => void, delayMs = 5000) {
    // Cancel any existing pending undo first
    this.cancelPendingUndo()

    const timeoutId = setTimeout(() => {
      pendingUndo = null
      onExpire()
    }, delayMs)

    pendingUndo = { ...action, timeoutId }
  },

  async executeUndo(actor: Actor) {
    if (!pendingUndo) {
      throw new Error('Kein Undo verfügbar.')
    }

    const action = { ...pendingUndo }
    this.cancelPendingUndo()

    if (action.type === 'loss' || action.type === 'beerround') {
      await SessionService.deleteLastLoss({
        actor,
        sessionId: action.sessionId,
        playerId: action.playerId,
      })
    }

    return action.label
  },

  cancelPendingUndo() {
    if (pendingUndo) {
      clearTimeout(pendingUndo.timeoutId)
      pendingUndo = null
    }
  },
}
