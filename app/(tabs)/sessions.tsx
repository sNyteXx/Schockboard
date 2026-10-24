import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { PlayerAvatar } from "@/components/avatar";
import { Sparkline, StackedBar } from "@/components/charts";
import { PressableScale } from "@/components/motion";
import {
  AppText,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Grid,
  IconButton,
  Input,
  LoadError,
  Notice,
  Row,
  Screen,
  ScreenHeader,
  SkeletonScreen,
  Split,
  StatTile,
} from "@/components/ui";
import { getSessionListCharts, type SessionPlayerTotal } from "@/db/chart-queries";
import { formatCurrency, formatDate, formatDateTime } from "@/domain/format";
import type { SessionOverview } from "@/domain/types";
import { parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useDeviceLayout } from "@/hooks/use-device-layout";
import { useRuntime } from "@/providers/runtime-provider";
import { Feedback } from "@/services/haptics";
import { SessionService } from "@/services/session-service";
import { colors, playerColor, radius, spacing } from "@/theme/tokens";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export default function SessionsScreen() {
  const router = useRouter();
  const runtime = useRuntime();
  const { isTablet } = useDeviceLayout();
  const data = useAsyncResource(
    () => ({
      settings: SessionService.getSettings(),
      sessions: SessionService.listSessions(),
      charts: getSessionListCharts(),
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
      setStake(centsToInput(configuredStake));
    }
  }, [configuredStake]);

  const overview = useMemo(() => {
    if (!data.data) return null;
    const closed = data.data.sessions.filter((session) => session.status === "closed");
    const totalCents = closed.reduce((sum, session) => sum + session.totalLossCents, 0);
    return { closedCount: closed.length, averageCents: closed.length ? Math.round(totalCents / closed.length) : 0 };
  }, [data.data]);

  if (data.error && !data.data) return <LoadError error={data.error} onRetry={data.reload} />;
  if (!data.data || !overview || !runtime.account) return <SkeletonScreen variant="list" />;

  const { sessions, charts } = data.data;
  const openSession = sessions.find((session) => session.status === "open") ?? null;
  const isAdvanced = runtime.viewMode === "advanced";
  const hasOpenSession = openSession !== null;

  function adjustStake(delta: number) {
    let current = configuredStake ?? 100;
    try {
      current = parseEuroToCents(stake);
    } catch {
      // keep the configured default as base
    }
    Feedback.tap();
    setStake(centsToInput(Math.max(10, current + delta)));
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
      setTitle("");
      setNotes("");
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

  const contextLine = overview.closedCount
    ? `${overview.closedCount} ${overview.closedCount === 1 ? "Abend" : "Abende"} · Ø ${formatCurrency(overview.averageCents)} pro Abend`
    : "Noch kein Abend abgeschlossen";

  return (
    <Screen>
      <ScreenHeader
        title="Spielabende"
        context={contextLine}
        actions={
          charts.totals.length > 1 ? (
            <View style={{ width: isTablet ? 180 : 96 }} accessibilityLabel="Verlauf der Abendsummen">
              <Sparkline data={charts.totals} height={isTablet ? 36 : 28} color={colors.accent} />
            </View>
          ) : null
        }
      />

      {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

      <Split weights={[5, 7]}>
        <Card>
          <CardHeader
            overline="Neuer Abend"
            title="Spielabend anlegen"
            icon="add-circle-outline"
            aside={hasOpenSession ? <Badge tone="warning">1 Abend offen</Badge> : <Badge tone="success">Bereit</Badge>}
          />
          {hasOpenSession ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.warningSoft }}>
              <Ionicons name="information-circle" size={20} color={colors.warning} />
              <AppText variant="caption" style={{ flex: 1 }}>Es läuft bereits ein Abend. Schließe ihn ab, bevor du einen neuen startest.</AppText>
            </View>
          ) : null}
          <Field label="Titel">
            <Input
              value={title}
              onChangeText={setTitle}
              editable={!hasOpenSession}
              placeholder={`Schockabend ${formatDate(new Date().toISOString())}`}
            />
          </Field>
          <Field label="Einsatz pro Verlust (€)">
            <Row gap={spacing.sm}>
              <IconButton icon="remove" size={48} accessibilityLabel="Einsatz verringern" onPress={() => adjustStake(-50)} disabled={hasOpenSession} />
              <Input
                value={stake}
                onChangeText={setStake}
                keyboardType="decimal-pad"
                editable={!hasOpenSession}
                style={{ flex: 1, textAlign: "center" }}
              />
              <IconButton icon="add" size={48} accessibilityLabel="Einsatz erhöhen" onPress={() => adjustStake(50)} disabled={hasOpenSession} />
            </Row>
          </Field>
          {isAdvanced ? (
            <Field label="Notiz">
              <Input multiline value={notes} onChangeText={setNotes} placeholder="Optional: Ort, Anlass oder Hausregel-Hinweis" editable={!hasOpenSession} />
            </Field>
          ) : null}
          {hasOpenSession ? (
            <Button tone="secondary" icon="play" onPress={() => router.push(`/session/${openSession.id}`)}>Offenen Abend öffnen</Button>
          ) : (
            <Button size="lg" icon="play" onPress={handleCreateSession} loading={submitting}>Spielabend starten</Button>
          )}
          {!hasOpenSession ? (
            <AppText variant="caption" tone="subtle">Alle aktiven Stammspieler werden automatisch geladen.</AppText>
          ) : null}
        </Card>

        {openSession ? (
          <Card tone="hero">
            <CardHeader overline={`Seit ${formatDateTime(openSession.startedAt)}`} title={openSession.title} icon="radio-outline" aside={<Badge tone="success" dot>LIVE</Badge>} />
            <Row gap={spacing.xs}>
              <StatTile label="Am Tisch" value={`${openSession.presentCount}`} icon="people-outline" />
              <StatTile label="Verluste" value={`${openSession.lossCount}`} icon="trending-down-outline" />
              <StatTile label="Einsatz" value={formatCurrency(openSession.stakeCents)} icon="pricetag-outline" />
            </Row>
            <SessionShare rows={charts.breakdown.get(openSession.id) ?? []} />
            <Button size="lg" icon="grid" iconRight="arrow-forward" onPress={() => router.push(`/session/${openSession.id}`)}>Weiterspielen</Button>
          </Card>
        ) : (
          <Card>
            <CardHeader overline="Status" title="Kein Abend offen" icon="moon-outline" />
            <EmptyState icon="dice-outline" title="Bereit für die nächste Runde">
              Lege links einen Abend an – danach geht es direkt zur Anwesenheit und aufs Live-Brett.
            </EmptyState>
          </Card>
        )}
      </Split>

      <CardHeader overline="Historie" title="Alle Spielabende" aside={<Badge>{sessions.length}</Badge>} />
      {sessions.length ? (
        <Grid columns={{ compact: 1, medium: 2, expanded: 2 }} gap={spacing.sm}>
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              breakdown={charts.breakdown.get(session.id) ?? []}
              isAdvanced={isAdvanced}
              onPress={() => router.push(`/session/${session.id}`)}
            />
          ))}
        </Grid>
      ) : (
        <Card>
          <EmptyState icon="calendar-outline" title="Noch keine Abende">Es wurden noch keine Spielabende erfasst.</EmptyState>
        </Card>
      )}
    </Screen>
  );
}

/** Stacked share bar + overlapping avatars of the evening's biggest payers. */
function SessionShare({ rows }: { rows: SessionPlayerTotal[] }) {
  const segments = useMemo(
    () => rows.map((row) => ({ key: row.playerId, value: row.totalCents, color: playerColor(row.playerId) })),
    [rows],
  );
  if (!rows.length) return null;
  const shown = rows.slice(0, 4);
  return (
    <Row gap={spacing.sm}>
      <View style={{ flexDirection: "row" }}>
        {shown.map((row, index) => (
          <View key={row.playerId} style={{ marginLeft: index === 0 ? 0 : -8, borderRadius: 13, borderWidth: 2, borderColor: colors.bgElevated }}>
            <PlayerAvatar id={row.playerId} name={row.playerName} size={22} />
          </View>
        ))}
        {rows.length > shown.length ? <AppText variant="caption" tone="subtle" style={{ marginLeft: 4, alignSelf: "center" }}>+{rows.length - shown.length}</AppText> : null}
      </View>
      <View style={{ flex: 1 }}>
        <StackedBar segments={segments} height={6} />
      </View>
    </Row>
  );
}

function SessionRow({
  session,
  breakdown,
  isAdvanced,
  onPress,
}: {
  session: SessionOverview;
  breakdown: SessionPlayerTotal[];
  isAdvanced: boolean;
  onPress: () => void;
}) {
  const date = new Date(session.startedAt);
  const live = session.status === "open";
  const meta = [
    `${session.lossCount} Verluste`,
    `${formatCurrency(session.stakeCents)} Einsatz`,
    isAdvanced ? `Abwesenheit ${formatCurrency(session.totalAbsenceCents)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${session.title} öffnen`}
      onPress={onPress}
      pressedScale={0.985}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        padding: spacing.sm,
        borderRadius: radius.lg,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: live ? colors.accent : colors.border,
      }}
    >
      <View style={{ width: 52, alignItems: "center", paddingVertical: spacing.xxs, borderRadius: radius.md, backgroundColor: live ? colors.accentSoft : colors.surface }}>
        <AppText variant="numericLg" tone={live ? "accent" : "default"}>{date.getDate()}</AppText>
        <AppText variant="overline" tone="muted">{MONTHS[date.getMonth()]}</AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Row gap={spacing.xs}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{session.title}</AppText>
          {live ? <Badge tone="success" dot>LIVE</Badge> : <Badge>Beendet</Badge>}
        </Row>
        <AppText variant="caption" tone="muted" numberOfLines={1}>{meta}</AppText>
        <SessionShare rows={breakdown} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <AppText variant="numericSm">{formatCurrency(session.totalLossCents + session.totalAbsenceCents)}</AppText>
        <AppText variant="caption" tone="subtle">{date.getFullYear()}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
    </PressableScale>
  );
}
