import { createContext, useContext, useEffect, useState } from "react";
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text } from "react-native";

import type { AuthAccount, FlashMessage, ThemeId, ViewMode } from "@/domain/types";
import { DatabaseService } from "@/services/database-service";
import { AuthService } from "@/services/auth-service";
import { SessionService } from "@/services/session-service";
import { colors, setActiveTheme, spacing } from "@/theme/tokens";

type RuntimeContextValue = {
  ready: boolean;
  account: AuthAccount | null;
  dataVersion: number;
  flash: FlashMessage | null;
  viewMode: ViewMode;
  themeId: ThemeId;
  refreshAuthState: () => Promise<void>;
  bumpDataVersion: () => void;
  setFlash: (flash: FlashMessage | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (themeId: ThemeId) => void;
  resetApp: () => void;
};

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>("basic");
  const [themeId, setThemeIdState] = useState<ThemeId>("original");

  async function refreshAuthState() {
    await DatabaseService.initialize();
    const currentAccount = await AuthService.ensureLocalAccount();

    setAccount(currentAccount);

    try {
      const settings = SessionService.getSettings();
      setViewModeState(settings.viewMode);
      setActiveTheme(settings.themeId);
      setThemeIdState(settings.themeId as ThemeId);
    } catch {
      // settings not yet available during initial setup
    }

    setReady(true);
  }

  useEffect(() => {
    void refreshAuthState();
  }, []);

  const value: RuntimeContextValue = {
    ready,
    account,
    dataVersion,
    flash,
    viewMode,
    themeId,
    refreshAuthState,
    bumpDataVersion() {
      setDataVersion((value) => value + 1);
    },
    setFlash,
    setViewMode(mode: ViewMode) {
      if (account) {
        SessionService.updateViewMode({
          actor: { accountId: account.id, username: account.username },
          viewMode: mode,
        });
      }
      setViewModeState(mode);
    },
    setTheme(id: ThemeId) {
      if (account) {
        SessionService.updateTheme({
          actor: { accountId: account.id, username: account.username },
          themeId: id,
        });
      }
      setActiveTheme(id);
      setThemeIdState(id);
      setDataVersion((v) => v + 1);
    },
    resetApp() {
      Alert.alert(
        "App zurücksetzen",
        "Alle Daten (Spieler, Abende, Buchungen, Einstellungen) werden unwiderruflich gelöscht. Die App startet danach neu. Fortfahren?",
        [
          { text: "Abbrechen", style: "cancel" },
          {
            text: "Alles löschen",
            style: "destructive",
            async onPress() {
              try {
                await AuthService.logout();
                await DatabaseService.reset();
                setActiveTheme("original");
                setFlash(null);
                await refreshAuthState();
                setFlash({ type: "success", message: "App wurde zurückgesetzt." });
              } catch (caught) {
                setFlash({
                  type: "error",
                  message: caught instanceof Error ? caught.message : "Reset fehlgeschlagen.",
                });
              }
            },
          },
        ],
      );
    },
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={colors.accentStrong} size="large" />
        <Text style={styles.loadingText}>Schockboard wird gestartet…</Text>
      </SafeAreaView>
    );
  }

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useRuntime() {
  const context = useContext(RuntimeContext);

  if (!context) {
    throw new Error("RuntimeProvider fehlt.");
  }

  return context;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  loadingText: {
    color: colors.text,
    fontSize: 16,
  },
});
