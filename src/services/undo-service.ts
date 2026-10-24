import { SessionService } from '@/services/session-service'

type UndoAction = {
  type: 'loss' | 'beerround'
  sessionId: string
  playerId: string
  entryId: string
  label: string
}

type Actor = {
  accountId: string
  username: string
}

let pendingUndo: (UndoAction & { timeoutId: ReturnType<typeof setTimeout> }) | null = null
const listeners = new Set<() => void>()

function clearPending() {
  if (pendingUndo) clearTimeout(pendingUndo.timeoutId)
  pendingUndo = null
}

function announceChange() {
  for (const listener of listeners) listener()
}

export const UndoService = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    listener()
    return () => { listeners.delete(listener) }
  },
  getPendingUndo() {
    return pendingUndo ? { ...pendingUndo, timeoutId: undefined } : null
  },

  scheduleUndo(action: UndoAction, onExpire: () => void, delayMs = 5000) {
    // Cancel any existing pending undo first
    clearPending()

    const timeoutId = setTimeout(() => {
      pendingUndo = null
      onExpire()
      announceChange()
    }, delayMs)

    pendingUndo = { ...action, timeoutId }
    announceChange()
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
        entryId: action.entryId,
      })
    }

    return action.label
  },

  cancelPendingUndo() {
    clearPending()
    announceChange()
  },
}
