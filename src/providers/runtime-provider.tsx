import { createContext, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text } from 'react-native'

import type { AuthAccount, FlashMessage, ThemeId, ViewMode } from '@/domain/types'
import { DatabaseService } from '@/services/database-service'
import { AuthService } from '@/services/auth-service'
import { SessionService } from '@/services/session-service'
import { UndoService } from '@/services/undo-service'
import { colors, setActiveTheme, spacing } from '@/theme/tokens'
import { BrandEmblem } from '@/components/brand'
import { UndoToast } from '@/components/undo-toast'
import { getTypeScale } from '@/theme/typography'
import { useRemoteSync } from '@/remote/use-remote-sync'

type RuntimeContextValue = {
  ready: boolean
  account: AuthAccount | null
  dataVersion: number
  flash: FlashMessage | null
  viewMode: ViewMode
  themeId: ThemeId
  refreshAuthState: () => Promise<void>
  bumpDataVersion: () => void
  setFlash: (flash: FlashMessage | null) => void
  setViewMode: (mode: ViewMode) => void
  setTheme: (themeId: ThemeId) => void
  resetApp: () => void
  scheduleUndo: (action: {
    type: 'loss' | 'beerround'
    sessionId: string
    playerId: string
    entryId: string
    label: string
  }) => void
  cancelUndo: () => void
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null)

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [account, setAccount] = useState<AuthAccount | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [viewMode, setViewModeState] = useState<ViewMode>('basic')
  const [themeId, setThemeIdState] = useState<ThemeId>('bvb09')

  async function refreshAuthState() {
    await DatabaseService.initialize()
    const currentAccount = await AuthService.ensureLocalAccount()

    setAccount(currentAccount)

    try {
      const settings = SessionService.getSettings()
      setViewModeState(settings.viewMode)
      setActiveTheme(settings.themeId)
      setThemeIdState(settings.themeId as ThemeId)
    } catch {
      // settings not yet available during initial setup
    }

    setReady(true)
  }

  useEffect(() => {
    void refreshAuthState()
  }, [])

  useRemoteSync({ ready, dataVersion, onRemoteChanges: () => setDataVersion((v) => v + 1) })

  const value: RuntimeContextValue = {
    ready,
    account,
    dataVersion,
    flash,
    viewMode,
    themeId,
    refreshAuthState,
    bumpDataVersion() {
      setDataVersion((value) => value + 1)
    },
    setFlash(next: FlashMessage | null) {
      setFlash(next)
      // Success banners fade away on their own; errors stay until replaced.
      if (next?.type === 'success') {
        setTimeout(() => setFlash((current) => (current === next ? null : current)), 4_000)
      }
    },
    setViewMode(mode: ViewMode) {
      if (account) {
        SessionService.updateViewMode({
          actor: { accountId: account.id, username: account.username },
          viewMode: mode,
        })
      }
      setViewModeState(mode)
    },
    setTheme(id: ThemeId) {
      if (account) {
        SessionService.updateTheme({
          actor: { accountId: account.id, username: account.username },
          themeId: id,
        })
      }
      setActiveTheme(id)
      setThemeIdState(id)
      setDataVersion((v) => v + 1)
    },
    resetApp() {
      Alert.alert(
        'App zurücksetzen',
        'Alle Daten (Spieler, Abende, Buchungen, Einstellungen) werden unwiderruflich gelöscht. Die App startet danach neu. Fortfahren?',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Alles löschen',
            style: 'destructive',
            async onPress() {
              try {
                UndoService.cancelPendingUndo()
                await AuthService.logout()
                await DatabaseService.reset()
                setActiveTheme('bvb09')
                setFlash(null)
                await refreshAuthState()
                setFlash({ type: 'success', message: 'App wurde zurückgesetzt.' })
              } catch (caught) {
                setFlash({
                  type: 'error',
                  message: caught instanceof Error ? caught.message : 'Reset fehlgeschlagen.',
                })
              }
            },
          },
        ]
      )
    },
    scheduleUndo(action) {
      UndoService.scheduleUndo(action, () => {})
    },
    cancelUndo() {
      UndoService.cancelPendingUndo()
    },
  }

  if (!ready) {
    return (
      <SafeAreaView style={[styles.loadingScreen, { backgroundColor: colors.bg }]}>
        <BrandEmblem size={56} themeId={themeId} />
        <Text style={[styles.loadingTitle, { color: colors.text }]}>Schockboard</Text>
        <ActivityIndicator color={colors.accent} size="small" />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Wird gestartet …</Text>
      </SafeAreaView>
    )
  }

  return (
    <RuntimeContext.Provider value={value}>
      {children}
      <UndoToast
        actor={account}
        themeId={themeId}
        onUndo={() => setDataVersion((v) => v + 1)}
        onError={(message) => {
          setFlash({ type: 'error', message })
          setDataVersion((v) => v + 1)
        }}
      />
    </RuntimeContext.Provider>
  )
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function useRuntime() {
  const context = useContext(RuntimeContext)

  if (!context) {
    throw new Error('RuntimeProvider fehlt.')
  }

  return context
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingTitle: { ...getTypeScale(1).title, marginBottom: spacing.xs },
  loadingText: getTypeScale(1).caption,
})
