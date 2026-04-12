import { ActivityIndicator, Alert, Pressable, Text } from "react-native";
import { useEffect, useState } from "react";

import { Badge, Button, Card, Field, Input, Notice, Screen, SectionTitle, Select, Split, Stack } from "@/components/ui";
import { formatCurrency } from "@/domain/format";
import type { AbsencePenaltyMode, ThemeId, ViewMode } from "@/domain/types";
import { parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useRuntime } from "@/providers/runtime-provider";
import { SessionService } from "@/services/session-service";
import { colors } from "@/theme/tokens";

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

export default function SettingsScreen() {
  const runtime = useRuntime();
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

  useEffect(() => {
    if (!data.data) {
      return;
    }

    setDefaultStake((data.data.settings.defaultStakeCents / 100).toFixed(2).replace(".", ","));
    setCashboxLabel(data.data.settings.cashboxLabel);
    setAbsencePenaltyMode(data.data.settings.absencePenaltyMode);
  }, [data.data]);

  if (data.loading || !data.data || !runtime.account) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    );
  }

  async function handleSaveSettings() {
    try {
      SessionService.updateAppSettings({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        defaultStakeCents: parseEuroToCents(defaultStake),
        cashboxLabel: cashboxLabel.trim(),
        absencePenaltyMode,
      });
      runtime.bumpDataVersion();
      runtime.setFlash({
        type: "success",
        message: "Einstellungen gespeichert.",
      });
    } catch (caught) {
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Einstellungen konnten nicht gespeichert werden.",
      });
    }
  }

  async function handleAddPlayer() {
    try {
      SessionService.createCorePlayer({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        name: newPlayer.trim(),
      });
      data.reload();
      runtime.setFlash({
        type: "success",
        message: "Stammspieler hinzugefügt.",
      });
      setNewPlayer("");
    } catch (caught) {
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Stammspieler konnte nicht angelegt werden.",
      });
    }
  }

  async function handlePlayerUpdate(playerId: string, changes: { isCore?: boolean; isArchived?: boolean }) {
    try {
      SessionService.updatePlayerFlags({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        playerId,
        ...changes,
      });
      data.reload();
    } catch (caught) {
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Spielerstatus konnte nicht geändert werden.",
      });
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
                actor: {
                  accountId: runtime.account!.id,
                  username: runtime.account!.username,
                },
                playerId,
              });
              data.reload();
              runtime.setFlash({ type: "success", message: `„${playerName}" wurde gelöscht.` });
            } catch (caught) {
              runtime.setFlash({
                type: "error",
                message: caught instanceof Error ? caught.message : "Spieler konnte nicht gelöscht werden.",
              });
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

  const isAdvanced = runtime.viewMode === "advanced";

  return (
    <Screen>
      <Stack>
        {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

        <Card tone="accent">
          <SectionTitle eyebrow="Ansicht" title="Darstellung" />
          <Field label="Anzeigemodus">
            <Select
              selectedValue={runtime.viewMode}
              onValueChange={(value) => runtime.setViewMode(value as ViewMode)}
              items={[
                { label: "Basic – weniger Details", value: "basic" },
                { label: "Erweitert – alle Infos", value: "advanced" },
              ]}
            />
          </Field>
          <Field label="Farbschema">
            <Select
              selectedValue={runtime.themeId}
              onValueChange={(value) => runtime.setTheme(value as ThemeId)}
              items={[
                { label: "Original – Warm & Gold", value: "original" },
                { label: "BVB 09 – Schwarz & Gelb", value: "bvb09" },
                { label: "Midnight – Dunkel & Blau", value: "midnight" },
              ]}
            />
          </Field>
        </Card>

        <Split>
          <Card>
            <SectionTitle eyebrow="Basis" title="App-Einstellungen" />
            <Field label="Standard-Einsatz (€)">
              <Input value={defaultStake} onChangeText={setDefaultStake} keyboardType="decimal-pad" />
            </Field>
            <Field label="Name der Kasse">
              <Input value={cashboxLabel} onChangeText={setCashboxLabel} />
            </Field>
            <Stack>
              <SectionTitle
                eyebrow="Abwesenheit"
                title="Abwesenheitspenalty"
                aside={
                  <InfoButton
                    label="Info zur Abwesenheitspenalty"
                    onPress={showAbsencePenaltyInfo}
                  />
                }
              />
              <Text style={{ color: colors.muted }}>
                Beim Abschließen eines Spielabends bestimmt diese Regel, ob und wie automatische Abwesenheitsbeträge für fehlende Stammspieler entstehen.
              </Text>
              <Field label="Automatik für fehlende Stammspieler">
                <Select
                  selectedValue={absencePenaltyMode}
                  onValueChange={(value) => setAbsencePenaltyMode(value as AbsencePenaltyMode)}
                  items={absencePenaltyOptions.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                />
              </Field>
            </Stack>
            <Button onPress={handleSaveSettings}>Einstellungen speichern</Button>
          </Card>
        </Split>

        <Split>
          <Card>
            <SectionTitle eyebrow="Stammrunde" title="Neuen Stammspieler anlegen" />
            <Field label="Name">
              <Input value={newPlayer} onChangeText={setNewPlayer} placeholder="Name eingeben" />
            </Field>
            <Button onPress={handleAddPlayer}>Hinzufügen</Button>
          </Card>

          {isAdvanced ? (
            <Card>
              <SectionTitle eyebrow="Profil" title="Hausregel-Info" aside={<Badge>{data.data.settings.ruleProfile.alias.general}</Badge>} />
              <Text style={{ color: colors.muted }}>{data.data.settings.ruleProfile.overview}</Text>
              <Text style={{ color: colors.muted }}>
                Aktueller Standard-Einsatz: <Text style={{ color: colors.text }}>{formatCurrency(data.data.settings.defaultStakeCents)}</Text>
              </Text>
            </Card>
          ) : null}
        </Split>

        <Card>
          <SectionTitle eyebrow="Spielerverwaltung" title="Stammspieler und Gäste" />
          <Stack>
            {data.data.players.map((player) => (
              <Card key={player.id}>
                <SectionTitle
                  eyebrow="Spieler"
                  title={player.name}
                  aside={
                    <Stack>
                      <Badge tone={player.isCore ? "warning" : "default"}>{player.isCore ? "Stammrunde" : "Gast"}</Badge>
                      {player.isArchived ? <Badge>Archiviert</Badge> : null}
                    </Stack>
                  }
                />
                <Split>
                  <Button tone="secondary" onPress={() => void handlePlayerUpdate(player.id, { isCore: !player.isCore })}>
                    {player.isCore ? "Zu Gast machen" : "Zur Stammrunde"}
                  </Button>
                  <Button tone="secondary" onPress={() => void handlePlayerUpdate(player.id, { isArchived: !player.isArchived })}>
                    {player.isArchived ? "Reaktivieren" : "Archivieren"}
                  </Button>
                </Split>
                <Button tone="secondary" onPress={() => handleDeletePlayer(player.id, player.name)}>
                  Spieler löschen
                </Button>
              </Card>
            ))}
          </Stack>
        </Card>

        <Button tone="secondary" onPress={() => runtime.resetApp()}>
          App zurücksetzen (alle Daten löschen)
        </Button>
      </Stack>
    </Screen>
  );
}

function InfoButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.bgElevated,
      })}
    >
      <Text style={{ color: colors.accentStrong, fontSize: 16, fontWeight: "800" }}>i</Text>
    </Pressable>
  );
}
