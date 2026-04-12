import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState, Field, Input, ListRow, Notice, Screen, SectionTitle, Split, Stack } from "@/components/ui";
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
                <Card key={session.id}>
                  <SectionTitle
                    eyebrow="Spielabend"
                    title={session.title}
                    aside={<Badge tone={session.status === "open" ? "success" : "default"}>{session.status === "open" ? "Offen" : "Abgeschlossen"}</Badge>}
                  />
                  <Text style={{ color: colors.muted }}>
                    {formatDate(session.startedAt)}
                    {session.closedAt ? ` bis ${formatDate(session.closedAt)}` : ""}
                  </Text>
                  {isAdvanced ? (
                    <Text style={{ color: colors.muted }}>
                      {formatCurrency(session.stakeCents)} Einsatz · {session.lossCount} Verluste · {formatCurrency(session.totalAbsenceCents)} Abwesenheit
                    </Text>
                  ) : null}
                  <Button tone="secondary" onPress={() => router.push(`/session/${session.id}`)}>
                    Öffnen
                  </Button>
                </Card>
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
