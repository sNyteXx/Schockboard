import type { Actor, HistoryFilters, ThemeId, ViewMode } from '@/domain/types'
import {
  addBeerRoundEntry,
  addGuestToSession,
  addLossEntry,
  closeSession,
  createPlayer,
  createSession,
  deleteLastLoss,
  deletePlayer,
  getAppSettings,
  getDashboardSnapshot,
  getHistoryEntries,
  getSessionDetail,
  listPlayers,
  listSessionOverviews,
  toggleAttendance,
  updateAppSettings,
  updatePlayerFlags,
  updateSessionStake,
  updateTheme,
  updateViewMode,
} from '@/db/queries'

export const SessionService = {
  getDashboardSnapshot,
  getSettings: getAppSettings,
  getHistoryEntries(filters?: HistoryFilters & { sessionId?: string }) {
    return getHistoryEntries(filters)
  },
  listPlayers,
  listSessions: listSessionOverviews,
  getSessionDetail,
  createSession,
  toggleAttendance,
  addGuestToSession,
  updateSessionStake,
  addLossEntry,
  deleteLastLoss,
  addBeerRoundEntry,
  closeSession,
  createCorePlayer(input: { actor: Actor; name: string }) {
    return createPlayer({
      actor: input.actor,
      name: input.name,
      isCore: true,
    })
  },
  updatePlayerFlags,
  deletePlayer,
  updateAppSettings,
  updateViewMode,
  updateTheme,
}
