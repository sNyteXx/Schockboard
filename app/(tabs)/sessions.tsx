import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";

import { BrandHero } from "@/components/brand";
import { Badge, Button, Card, EmptyState, Field, Input, ListRow, Notice, Screen, SectionTitle, Split, Stack, LoadError } from "@/components/ui";
import { formatCurrency, formatDate, formatDateTime } from "@/domain/format";
import { parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useRuntime } from "@/providers/runtime-provider";
import { SessionService } from "@/services/session-service";
import { colors, radius, spacing } from "@/theme/tokens";

export default function SessionsScreen() {
  const router = useRouter();
  const runtime = useRuntime();
  const stakeStyles = useStakeStyles();
  const data = useAsyncResource(
    () => ({
      settings: SessionService.getSettings(),
      sessions: SessionService.listSessions(),
    }),
    [runtime.dataVersion],
  );
  const [title, setTitle] = useState("");
  const [stake, setStake] = useState("1,00");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // The configured default stake must be the starting value for new nights.
  const configuredStake = data.data?.settings.defaultStakeCents;
  useEffect(() => {
    if (configuredStake !== undefined) {
      setStake((configuredStake / 100).toFixed(2).replace(".", ","));
    }
  }, [configuredStake]);

  if (data.error && !data.loading) return <LoadError error={data.error} onRetry={data.reload} />

  if (data.loading || !data.data || !runtime.account) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    );
  }

  const openSession = data.data.sessions.find((session) => session.status === "open") ?? null;
  const isAdvanced = runtime.viewMode === "advanced";
  const hasOpenSession = openSession !== null;

  function adjustStake(delta: number) {
    const current = parseEuroToCents(stake);
    const next = Math.max(10, current + delta);
    setStake((next / 100).toFixed(2).replace(".", ","));
  }

  async function handleCreateSession() {
    try {
      setSubmitting(true);
      const sessionId = SessionService.createSession({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        title: title.trim() || `Schockabend ${formatDate(new Date().toISOString())}`,
        notes: notes.trim() || null,
        stakeCents: parseEuroToCents(stake),
      });
      runtime.bumpDataVersion();
      runtime.setFlash({
        type: "success",
        message: "Spielabend angelegt.",
      });
      router.push(`/session/${sessionId}`);
    } catch (caught) {
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Spielabend konnte nicht angelegt werden.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Stack>
        {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}
        <BrandHero title="Spielabende" subtitle="Neue Runde starten, weiterspielen oder vergangene Abende ansehen." themeId={runtime.themeId} />
        <Split>
          <Card>
            <SectionTitle
              eyebrow="Neuer Abend"
              title="Spielabend anlegen"
              aside={openSession ? <Badge tone="warning">1 Abend offen</Badge> : <Badge tone="success">Bereit</Badge>}
            />
            <Field label="Titel">
              <Input value={title} onChangeText={setTitle} editable={!hasOpenSession} />
            </Field>
            <Field label="Einsatz pro Verlust (€)">
              <View style={stakeStyles.row}>
                <Pressable
                  onPress={() => adjustStake(-50)}
                  disabled={hasOpenSession}
                  style={({ pressed }) => [stakeStyles.btn, pressed && stakeStyles.btnPressed]}
                >
                  <Text style={stakeStyles.btnText}>−</Text>
                </Pressable>
                <Input
                  value={stake}
                  onChangeText={setStake}
                  keyboardType="decimal-pad"
                  editable={!hasOpenSession}
                  style={{ flex: 1, textAlign: "center" }}
                />
                <Pressable
                  onPress={() => adjustStake(50)}
                  disabled={hasOpenSession}
                  style={({ pressed }) => [stakeStyles.btn, pressed && stakeStyles.btnPressed]}
                >
                  <Text style={stakeStyles.btnText}>＋</Text>
                </Pressable>
              </View>
            </Field>
            {isAdvanced ? (
              <Field label="Notiz">
                <Input multiline value={notes} onChangeText={setNotes} placeholder="Optional: Ort, Anlass oder Hausregel-Hinweis" />
              </Field>
            ) : null}
            <Button onPress={handleCreateSession} disabled={submitting || hasOpenSession}>
              {hasOpenSession ? "Erst offenen Abend abschließen" : submitting ? "Speichere…" : "Spielabend starten"}
            </Button>
          </Card>

          <Card tone="accent">
            <SectionTitle eyebrow="Status" title="Aktueller Fokus" />
            {openSession ? (
              <Stack>
                <Text style={{ color: colors.text, fontWeight: "700" }}>{openSession.title}</Text>
                <Text style={{ color: colors.muted }}>{formatDateTime(openSession.startedAt)}</Text>
                <Text style={{ color: colors.muted }}>
                  {openSession.presentCount} anwesend · {openSession.lossCount} Verluste · {formatCurrency(openSession.stakeCents)} Einsatz
                </Text>
                <Button onPress={() => router.push(`/session/${openSession.id}`)}>Abend öffnen</Button>
              </Stack>
            ) : (
              <EmptyState>Noch kein offener Abend. Beim Anlegen werden alle aktiven Stammspieler automatisch geladen.</EmptyState>
            )}
          </Card>
        </Split>

        <Card>
          <SectionTitle eyebrow="Historie" title="Alle Spielabende" />
          <Stack>
            {data.data.sessions.length > 0 ? (
              data.data.sessions.map((session) => (
                <Pressable
                  key={session.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${session.title} öffnen`}
                  onPress={() => router.push(`/session/${session.id}`)}
                  style={({ pressed }) => ({
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.md,
                    gap: 7,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>{session.title}</Text></View>
                    <Badge tone={session.status === "open" ? "success" : "default"}>{session.status === "open" ? "LIVE" : "Beendet"}</Badge>
                  </View>
                  <Text style={{ color: colors.muted }}>
                    {formatDate(session.startedAt)} · {session.lossCount} Verluste · {formatCurrency(session.stakeCents)} Einsatz
                  </Text>
                  {isAdvanced ? <Text style={{ color: colors.muted }}>Abwesenheit: {formatCurrency(session.totalAbsenceCents)}</Text> : null}
                  <Text style={{ color: colors.accentStrong, fontWeight: "800" }}>{session.status === "open" ? "Weiterspielen →" : "Zusammenfassung →"}</Text>
                </Pressable>
              ))
            ) : (
              <EmptyState>Es wurden noch keine Spielabende erfasst.</EmptyState>
            )}
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}

function useStakeStyles() {
  return useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
        btn: {
          width: 48, height: 48, borderRadius: radius.pill,
          backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border,
          alignItems: "center", justifyContent: "center",
        },
        btnPressed: { backgroundColor: colors.accent, transform: [{ scale: 0.95 }] },
        btnText: { fontSize: 22, fontWeight: "800", color: colors.accentStrong },
      }),
    [colors.id],
  );
}
