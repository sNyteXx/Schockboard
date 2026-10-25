import { assertWritable } from '@/domain/write-access';
import { RemoteConfigStore } from '@/remote/config';
import Ionicons from "@expo/vector-icons/Ionicons";
import { View, Switch } from "react-native";

import { Alert } from "@/components/dialog";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";

import { PlayerAvatar } from "@/components/avatar";
import { PressableScale } from "@/components/motion";
import { restartTour } from "@/components/tour";
import {
  AppText,
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  EmptyState,
  Field,
  Grid,
  IconButton,
  Input,
  ListRow,
  LoadError,
  Notice,
  Screen,
  ScreenHeader,
  Segmented,
  SkeletonScreen,
  Split,
  Stack,
} from "@/components/ui";
import { formatCurrency } from "@/domain/format";
import type { AbsencePenaltyMode, ThemeId, ViewMode } from "@/domain/types";
import { parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useRuntime } from "@/providers/runtime-provider";
import { BackupService } from "@/services/backup-service";
import { Feedback } from "@/services/haptics";
import { SessionService } from "@/services/session-service";
import { THEMES, colors, radius, spacing } from "@/theme/tokens";

const absencePenaltyOptions: Array<{
  value: AbsencePenaltyMode;
  label: string;
  title: string;
  description: string;
  bullet: string;
}> = [
  {
    value: "none",
    label: "Keine Abwesenheitspenalty",
    title: "Keine automatische Belastung",
    description: "Fehlende Stammspieler bekommen beim Abschließen des Abends keinen automatischen Abwesenheitsbetrag.",
    bullet: "Keine Abwesenheitspenalty: Fehlende Stammspieler bekommen keinen automatischen Zuschlag.",
  },
  {
    value: "split_absent",
    label: "Penalty unter Abwesenden aufteilen",
    title: "Gemeinsamer Durchschnitt, fair aufgeteilt",
    description: "Der berechnete Abwesenheitsdurchschnitt wird einmal ermittelt und anschließend gleichmäßig auf alle fehlenden Stammspieler verteilt.",
    bullet: "Penalty unter Abwesenden aufteilen: Ein gemeinsamer Durchschnitt wird berechnet und gleichmäßig auf alle Fehlenden verteilt.",
  },
  {
    value: "full_average",
    label: "Jeder bekommt den vollen Durchschnitt",
    title: "Voller Durchschnitt pro fehlender Person",
    description: "Jeder fehlende Stammspieler erhält den kompletten Durchschnitt der anwesenden Stammspieler als eigenen Abwesenheitsbetrag.",
    bullet: "Jeder bekommt den vollen Durchschnitt: Jeder fehlende Stammspieler zahlt den kompletten Durchschnitt alleine.",
  },
];

const THEME_ORDER: Array<{ id: ThemeId; hint: string }> = [
  { id: "bvb09", hint: "Schwarzgelb mit Vereinswappen" },
  { id: "original", hint: "Warm & Gold" },
  { id: "midnight", hint: "Dunkel & Blau" },
];

export default function SettingsScreen() {
  const runtime = useRuntime();
  const router = useRouter();
  const data = useAsyncResource(
    () => ({
      settings: SessionService.getSettings(),
      players: SessionService.listPlayers(),
    }),
    [runtime.dataVersion],
  );
  const [defaultStake, setDefaultStake] = useState("1,00");
  const [cashboxLabel, setCashboxLabel] = useState("Getränkekasse");
  const [absencePenaltyMode, setAbsencePenaltyMode] = useState<AbsencePenaltyMode>("full_average");
  const [newPlayer, setNewPlayer] = useState("");
  const [preferences, setPreferences] = useState({ hapticsEnabled: true, achievementAnimations: true, autoBackup: true });
  const [backups, setBackups] = useState(() => BackupService.listLocal());
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    if (!data.data) {
      return;
    }

    setBackups(BackupService.listLocal());
    setPreferences({ hapticsEnabled: data.data.settings.hapticsEnabled, achievementAnimations: data.data.settings.achievementAnimations, autoBackup: data.data.settings.autoBackup });
    setDefaultStake((data.data.settings.defaultStakeCents / 100).toFixed(2).replace(".", ","));
    setCashboxLabel(data.data.settings.cashboxLabel);
    setAbsencePenaltyMode(data.data.settings.absencePenaltyMode);
  }, [data.data]);

  if (data.error && !data.data) return <LoadError error={data.error} onRetry={data.reload} />;

  if (!data.data || !runtime.account) return <SkeletonScreen variant="form" />;

  const actor = { accountId: runtime.account.id, username: runtime.account.username };

  async function handleSaveSettings() {
    try {
      SessionService.updateAppSettings({
        actor,
        defaultStakeCents: parseEuroToCents(defaultStake),
        cashboxLabel: cashboxLabel.trim(),
        absencePenaltyMode,
        ...preferences,
      });
      Feedback.success();
      runtime.bumpDataVersion();
      runtime.setFlash({
        type: "success",
        message: "Einstellungen gespeichert.",
      });
    } catch (caught) {
      Feedback.error();
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Einstellungen konnten nicht gespeichert werden.",
      });
    }
  }

  async function handleAddPlayer() {
    try {
      SessionService.createCorePlayer({
        actor,
        name: newPlayer.trim(),
      });
      Feedback.success();
      data.reload();
      runtime.setFlash({
        type: "success",
        message: "Stammspieler hinzugefügt.",
      });
      setNewPlayer("");
    } catch (caught) {
      Feedback.error();
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Stammspieler konnte nicht angelegt werden.",
      });
    }
  }

  async function handlePlayerUpdate(playerId: string, changes: { isCore?: boolean; isArchived?: boolean }) {
    try {
      SessionService.updatePlayerFlags({
        actor,
        playerId,
        ...changes,
      });
      Feedback.tap();
      runtime.bumpDataVersion();
    } catch (caught) {
      // A dialog, not the banner at the top: the player list is far down the page.
      Feedback.error();
      Alert.alert("Nicht möglich", caught instanceof Error ? caught.message : "Spielerstatus konnte nicht geändert werden.");
    }
  }

  function handleDeletePlayer(playerId: string, playerName: string) {
    Alert.alert(
      "Spieler löschen",
      `„${playerName}" und alle zugehörigen Buchungen (Verluste, Abwesenheiten, Zahlungen, Korrekturen) werden unwiderruflich gelöscht. Fortfahren?`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Endgültig löschen",
          style: "destructive",
          onPress() {
            try {
              SessionService.deletePlayer({
                actor,
                playerId,
              });
              Feedback.success();
              runtime.bumpDataVersion();
              Alert.alert("Gelöscht", `„${playerName}" wurde gelöscht.`);
            } catch (caught) {
              Feedback.error();
              Alert.alert("Nicht möglich", caught instanceof Error ? caught.message : "Spieler konnte nicht gelöscht werden.");
            }
          },
        },
      ],
    );
  }

  function showAbsencePenaltyInfo() {
    Alert.alert(
      "Abwesenheitspenalty",
      [
        "Beim Abschließen eines Spielabends kannst du festlegen, ob und wie fehlende Stammspieler automatisch belastet werden.",
        ...absencePenaltyOptions.map((option) => `• ${option.bullet}`),
      ].join("\n\n"),
    );
  }

  async function handleShareBackup() {
    try {
      setBackupBusy(true);
      await BackupService.shareBackup();
      runtime.setFlash({ type: "success", message: "Sicherung zum Speichern oder Teilen bereitgestellt." });
    } catch (caught) {
      runtime.setFlash({ type: "error", message: caught instanceof Error ? caught.message : "Sicherung fehlgeschlagen." });
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup() {
    try {
      setBackupBusy(true);
      const backupBytes = await BackupService.pickAndValidateBackup();
      if (!backupBytes) return;
      Alert.alert(
        "Sicherung wiederherstellen?",
        "Spieler, Spielabende, Buchungen und Einstellungen werden durch die ausgewählte Sicherung ersetzt. Vorher wird der aktuelle Stand automatisch als Sicherheitskopie gespeichert.",
        [
          { text: "Abbrechen", style: "cancel" },
          {
            text: "Daten ersetzen",
            style: "destructive",
            async onPress() {
              try {
                // A pending undo refers to entries of the database being replaced.
                runtime.cancelUndo();
                assertWritable();
                BackupService.saveLocal('before-restore');
                BackupService.restoreValidatedBackup(backupBytes);
                await RemoteConfigStore.clearUploadedFingerprint();
                setBackups(BackupService.listLocal());
                await runtime.refreshAuthState();
                runtime.bumpDataVersion();
                runtime.setFlash({ type: "success", message: "Sicherung erfolgreich wiederhergestellt." });
              } catch (caught) {
                runtime.setFlash({ type: "error", message: caught instanceof Error ? caught.message : "Wiederherstellung fehlgeschlagen." });
              }
            },
          },
        ],
      );
    } catch (caught) {
      runtime.setFlash({ type: "error", message: caught instanceof Error ? caught.message : "Datei konnte nicht geprüft werden." });
    } finally {
      setBackupBusy(false);
    }
  }

  const isAdvanced = runtime.viewMode === "advanced";
  const activePlayers = data.data.players.filter((player) => !player.isArchived);
  const archivedPlayers = data.data.players.filter((player) => player.isArchived);

  const renderPlayer = (player: (typeof data.data.players)[number]) => (
    <ListRow
      key={player.id}
      leading={<PlayerAvatar id={player.id} name={player.name} size={36} muted={player.isArchived} />}
      title={player.name}
      detail={[player.isCore ? "Stammrunde" : "Gast", player.isArchived ? "Archiviert" : null].filter(Boolean).join(" · ")}
      trailing={
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginLeft: spacing.xs }}>
          <IconButton
            icon={player.isCore ? "person-outline" : "people-outline"}
            accessibilityLabel={player.isCore ? `${player.name} zu Gast machen` : `${player.name} zur Stammrunde`}
            onPress={() => void handlePlayerUpdate(player.id, { isCore: !player.isCore })}
            size={36}
          />
          <IconButton
            icon={player.isArchived ? "arrow-undo-outline" : "archive-outline"}
            accessibilityLabel={player.isArchived ? `${player.name} reaktivieren` : `${player.name} archivieren`}
            onPress={() => void handlePlayerUpdate(player.id, { isArchived: !player.isArchived })}
            size={36}
          />
          <IconButton
            icon="trash-outline"
            accessibilityLabel={`${player.name} löschen`}
            onPress={() => handleDeletePlayer(player.id, player.name)}
            size={36}
            color={colors.danger}
          />
        </View>
      }
    />
  );

  return (
    <Screen maxWidth={1100}>
      <ScreenHeader title="Setup" context="Darstellung, Hausregeln, Spieler und Datensicherung" />
      {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

      <Card>
        <CardHeader title="Runde & Geräte" icon="qr-code-outline" />
        <Split><Button icon="qr-code-outline" onPress={() => router.push('/connect')}>Geräte verbinden / umziehen</Button><Button tone="secondary" icon="trophy-outline" onPress={() => router.push('/achievements')}>Erfolge & Rückblick</Button></Split>
        <Button tone="secondary" icon="lock-closed-outline" onPress={() => runtime.setTableLocked(true)}>Tisch gegen versehentliche Eingaben sperren</Button>
      </Card>
      <Card>
        <CardHeader overline="Ansicht" title="Darstellung" icon="color-palette-outline" />
        <Field label="Anzeigemodus" hint={runtime.viewMode === "advanced" ? "Alle Details, Notizen, Export und Korrekturen" : "Das Wichtigste für den Spieltisch"}>
          <Segmented<ViewMode>
            options={[
              { value: "basic", label: "Basic", icon: "flash-outline" },
              { value: "advanced", label: "Erweitert", icon: "options-outline" },
            ]}
            value={runtime.viewMode}
            onChange={(value) => { Feedback.tap(); runtime.setViewMode(value); }}
          />
        </Field>
        <Field label="Farbschema">
          <Grid columns={{ compact: 1, medium: 3, expanded: 3 }}>
            {THEME_ORDER.map((item) => (
              <ThemeTile
                key={item.id}
                themeId={item.id}
                hint={item.hint}
                selected={runtime.themeId === item.id}
                onPress={() => { Feedback.tap(); runtime.setTheme(item.id); }}
              />
            ))}
          </Grid>
        </Field>
      </Card>

      <Card>
        <CardHeader overline="Hausregeln" title="App-Einstellungen" icon="options-outline" />
        <Split>
          <Field label="Standard-Einsatz (€)" hint="Gilt für neue Abende, pro Abend anpassbar">
            <Input value={defaultStake} onChangeText={setDefaultStake} keyboardType="decimal-pad" />
          </Field>
          <Field label="Name der Kasse">
            <Input value={cashboxLabel} onChangeText={setCashboxLabel} />
          </Field>
        </Split>
        {([['hapticsEnabled', 'Vibration'], ['achievementAnimations', 'Animation bei neuen Erfolgen'], ['autoBackup', 'Beim Abendabschluss automatisch sichern']] as const).map(([key, label]) => <Split key={key}><AppText>{label}</AppText><Switch accessibilityLabel={label} value={preferences[key]} onValueChange={value => setPreferences(current => ({ ...current, [key]: value }))} /></Split>)}
        <AppText tone="muted">Es bleiben zehn automatische Sicherungen erhalten. Sicherheitskopien vor einem Umzug oder einer Wiederherstellung bleiben zusätzlich erhalten.</AppText>
        <Divider />
        <CardHeader
          overline="Abwesenheit"
          title="Wer fehlt, zahlt?"
          aside={<IconButton icon="information-circle-outline" accessibilityLabel="Info zur Abwesenheitspenalty" onPress={showAbsencePenaltyInfo} size={36} tone="ghost" color={colors.accentStrong} />}
        />
        <AppText variant="body" tone="muted">
          Beim Abschließen eines Spielabends bestimmt diese Regel, ob und wie automatische Abwesenheitsbeträge für fehlende Stammspieler entstehen.
        </AppText>
        <Stack gap={spacing.xs}>
          {absencePenaltyOptions.map((option) => (
            <OptionCard
              key={option.value}
              selected={absencePenaltyMode === option.value}
              title={option.title}
              description={option.description}
              onPress={() => { Feedback.tap(); setAbsencePenaltyMode(option.value); }}
            />
          ))}
        </Stack>
        <Button icon="checkmark" onPress={handleSaveSettings}>Einstellungen speichern</Button>
      </Card>

      <Card>
        <CardHeader overline="Stammrunde" title="Spieler verwalten" icon="people-outline" aside={<Badge>{`${activePlayers.length} aktiv`}</Badge>} />
        <View style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Input value={newPlayer} onChangeText={setNewPlayer} placeholder="Neuer Stammspieler" returnKeyType="done" onSubmitEditing={() => { if (newPlayer.trim()) void handleAddPlayer(); }} />
          </View>
          <IconButton icon="add" tone="primary" size={48} accessibilityLabel="Stammspieler hinzufügen" disabled={!newPlayer.trim()} onPress={() => void handleAddPlayer()} />
        </View>
        {data.data.players.length === 0 ? (
          <EmptyState icon="person-add-outline">Noch keine Spieler angelegt.</EmptyState>
        ) : (
          <View>
            {activePlayers.map(renderPlayer)}
            {archivedPlayers.length ? (
              <>
                <AppText variant="overline" tone="subtle" style={{ marginTop: spacing.sm }}>Archiviert</AppText>
                {archivedPlayers.map(renderPlayer)}
              </>
            ) : null}
          </View>
        )}
        <AppText variant="caption" tone="subtle">Symbole: Stammrunde/Gast wechseln · archivieren · löschen</AppText>
      </Card>

      {isAdvanced ? (
        <Card>
          <CardHeader overline="Profil" title="Hausregel-Info" icon="book-outline" aside={<Badge>{data.data.settings.ruleProfile.alias.general}</Badge>} />
          <AppText tone="muted">{data.data.settings.ruleProfile.overview}</AppText>
          <AppText tone="muted">
            Aktueller Standard-Einsatz: <AppText variant="bodyStrong">{formatCurrency(data.data.settings.defaultStakeCents)}</AppText>
          </AppText>
        </Card>
      ) : null}

      <Card>
        <CardHeader overline="Hilfe" title="Einführung" icon="sparkles-outline" />
        <AppText tone="muted">Die kurze Tour zeigt dir Schritt für Schritt, wie ein Spielabend läuft – vom Start bis zur Kasse. Es wird dabei nichts gebucht.</AppText>
        <Button
          tone="secondary"
          icon="play-circle-outline"
          onPress={() => {
            Feedback.tap();
            restartTour();
            router.navigate("/(tabs)");
          }}
        >
          Einführung erneut zeigen
        </Button>
      </Card>

      <Card>
        <CardHeader overline="Datenhoheit" title="Sicherung und Wiederherstellung" icon="shield-checkmark-outline" />
        <AppText tone="muted">
          Vollständige Offline-Sicherung mit allen Spielern, Abenden, Buchungen und Einstellungen. Die App speichert weiterhin alles lokal auf diesem Gerät.
        </AppText>
        <Split>
          <Button tone="secondary" icon="cloud-upload-outline" loading={backupBusy} onPress={() => void handleShareBackup()}>Sicherung exportieren</Button>
          <Button tone="secondary" icon="cloud-download-outline" disabled={backupBusy} onPress={() => void handleRestoreBackup()}>Sicherung wiederherstellen</Button>
        </Split>
        {backups.map(backup => <View key={backup.name} style={{ gap: spacing.xs }}>
          <AppText>{new Date(backup.at).toLocaleString('de-DE')} · {(backup.size / 1024).toFixed(0)} KB</AppText>
          <AppText variant="caption" tone="muted">{backup.name.startsWith('evening-') ? 'Abendabschluss' : 'Sicherheitskopie vor Datenwechsel'}</AppText>
          <Split><Button tone="secondary" disabled={backupBusy} onPress={() => void BackupService.shareLocal(backup.name).catch(error => runtime.setFlash({ type: 'error', message: error.message }))}>Exportieren</Button>
          <Button tone="secondary" disabled={backupBusy} onPress={() => Alert.alert('Sicherung wiederherstellen?', 'Der aktuelle Stand wird vorher gesichert und danach vollständig ersetzt.', [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Wiederherstellen', style: 'destructive', onPress: async () => {
            try { assertWritable(); runtime.cancelUndo(); BackupService.restoreLocal(backup.name); await RemoteConfigStore.clearUploadedFingerprint(); await runtime.refreshAuthState(); runtime.bumpDataVersion(); setBackups(BackupService.listLocal()); }
            catch (error) { runtime.setFlash({ type: 'error', message: (error as Error).message }); }
          } }])}>Wiederherstellen</Button></Split>
        </View>)}
        <AppText variant="caption" tone="subtle">Vor Gerätewechseln oder größeren Updates eine Sicherung außerhalb der App speichern.</AppText>
      </Card>

      <Card style={{ borderColor: colors.dangerSoft }}>
        <CardHeader overline="Gefahrenzone" title="App zurücksetzen" icon="warning-outline" />
        <AppText tone="muted">Löscht alle Spieler, Abende, Buchungen und Einstellungen auf diesem Gerät.</AppText>
        <Button tone="danger" icon="trash-outline" onPress={() => runtime.resetApp()}>Alle Daten löschen</Button>
      </Card>
    </Screen>
  );
}

/** Preview tile with the theme's own palette. */
function ThemeTile({ themeId, hint, selected, onPress }: { themeId: ThemeId; hint: string; selected: boolean; onPress: () => void }) {
  const theme = THEMES[themeId];
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={theme.label}
      onPress={onPress}
      style={{
        borderRadius: radius.lg,
        padding: spacing.sm,
        gap: spacing.sm,
        backgroundColor: theme.bgElevated,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.accent : theme.borderStrong,
      }}
    >
      <View style={{ height: 56, borderRadius: radius.md, backgroundColor: theme.bg, padding: spacing.xs, flexDirection: "row", gap: 6, alignItems: "flex-end" }}>
        <View style={{ flex: 1, height: 22, borderRadius: radius.xs, backgroundColor: theme.surface }} />
        <View style={{ flex: 1, height: 34, borderRadius: radius.xs, backgroundColor: theme.surfaceSoft }} />
        <View style={{ flex: 1, height: 40, borderRadius: radius.xs, backgroundColor: theme.accent }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" numberOfLines={1} style={{ color: theme.text }}>{theme.label}</AppText>
          <AppText variant="caption" numberOfLines={1} style={{ color: theme.muted }}>{hint}</AppText>
        </View>
        <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={22} color={selected ? theme.accent : theme.subtle} />
      </View>
    </PressableScale>
  );
}

function OptionCard({ selected, title, description, onPress }: { selected: boolean; title: string; description: string; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.985}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.sm,
        borderRadius: radius.md,
        padding: spacing.sm,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
      }}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.accentStrong : colors.subtle} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" tone="muted">{description}</AppText>
      </View>
    </PressableScale>
  );
}
