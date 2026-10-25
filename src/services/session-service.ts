import { BackupService } from '@/services/backup-service'
import type { Actor, HistoryFilters, ThemeId, ViewMode } from '@/domain/types'
import {
  addBeerRoundEntry,
  addGuestToSession,
  addLossEntry,
  closeSession,
  cancelSession,
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
  closeSession(input: Parameters<typeof closeSession>[0]) {
    const result = closeSession(input)
    let backupError: string | null = null
    if (getAppSettings().autoBackup) {
      try { BackupService.saveLocal('evening') } catch (error) { backupError = error instanceof Error ? error.message : 'Automatische Sicherung fehlgeschlagen.' }
    }
    return { ...result, backupError }
  },
  cancelSession,
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
