import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { PlayerAvatar } from "@/components/avatar";
import { BrandEmblem } from "@/components/brand";
import { BarChart, Donut, LineChart } from "@/components/charts";
import {
  AppText,
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  EmptyState,
  Grid,
  KpiTile,
  ListRow,
  LoadError,
  Notice,
  Row,
  Screen,
  ScreenHeader,
  SkeletonScreen,
  Split,
  Stack,
  StatTile,
} from "@/components/ui";
import { getDashboardCharts } from "@/db/chart-queries";
import { formatCurrency, formatDateTime } from "@/domain/format";
import { describeHistoryEntry } from "@/domain/history";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useDeviceLayout } from "@/hooks/use-device-layout";
import { hasActiveCorePlayers } from "@/hooks/use-onboarding";
import { useRuntime } from "@/providers/runtime-provider";
import { SessionService } from "@/services/session-service";
import { colors, spacing } from "@/theme/tokens";

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function euroAxis(cents: number) {
  return `${Math.round(cents / 100)} €`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const runtime = useRuntime();
  const { isTablet } = useDeviceLayout();
  const resource = useAsyncResource(() => {
    const snapshot = SessionService.getDashboardSnapshot();
    const charts = getDashboardCharts(
      { paidCents: snapshot.cashbox.totalPaymentsCents, openCents: snapshot.cashbox.totalOutstandingCents },
      shortDate,
    );
    return { snapshot, charts };
  }, [runtime.dataVersion]);

  const isAdvanced = runtime.viewMode === "advanced";
  const data = resource.data;

  const trendSeries = useMemo(() => {
    if (!data) return [];
    const series = [{ id: "loss", label: "Verluste", color: colors.accent, points: data.charts.trend.lossCents }];
    if (data.charts.trend.absenceCents.some((value) => value > 0)) {
      series.push({ id: "absence", label: "Abwesenheit", color: colors.info, points: data.charts.trend.absenceCents });
    }
    return series;
  }, [data]);

  const debtorBars = useMemo(() => {
    if (!data) return [];
    return data.snapshot.debtors
      .filter((debtor) => debtor.openDebtCents > 0)
      .slice(0, isAdvanced ? 6 : 3)
      .map((debtor) => ({
        id: debtor.playerId,
        label: debtor.playerName,
        value: debtor.openDebtCents,
        display: formatCurrency(debtor.openDebtCents),
        sublabel: isAdvanced ? `Verluste ${formatCurrency(debtor.lossCents)}` : debtor.isCore ? undefined : "Gast",
        avatar: { id: debtor.playerId, name: debtor.playerName },
      }));
  }, [data, isAdvanced]);

  const donutData = useMemo(() => {
    if (!data) return [];
    const { totalPaymentsCents, totalOutstandingCents } = data.snapshot.cashbox;
    return [
      { key: "paid", label: "Eingezahlt", value: totalPaymentsCents, color: colors.accent, display: formatCurrency(totalPaymentsCents) },
      { key: "open", label: "Noch offen", value: Math.max(0, totalOutstandingCents), color: colors.danger, display: formatCurrency(Math.max(0, totalOutstandingCents)) },
    ];
  }, [data]);

  if (resource.error && !data) return <LoadError error={resource.error} onRetry={resource.reload} />;
  if (!data) return <SkeletonScreen variant="dashboard" />;

  const { snapshot, charts } = data;
  const openSession = snapshot.openSession;
  const needsSetup = !openSession && !hasActiveCorePlayers();
  const goToEvening = () => router.push(openSession ? `/session/${openSession.id}` : "/(tabs)/sessions");
  const hasMoney = snapshot.cashbox.totalPaymentsCents > 0 || snapshot.cashbox.totalOutstandingCents > 0;

  return (
    <Screen>
      <ScreenHeader
        leading={<BrandEmblem size={isTablet ? 36 : 32} themeId={runtime.themeId} />}
        title="Schockboard"
        context={openSession ? `Live: ${openSession.title} · ${openSession.presentCount} am Tisch` : "Bereit für den nächsten Abend"}
        badge={openSession ? <Badge tone="success" dot>LIVE</Badge> : null}
        actions={
          isTablet ? (
            <>
              <Button tone="secondary" icon="wallet-outline" onPress={() => router.push("/(tabs)/cashbox")}>Zahlung</Button>
              <Button icon={openSession ? "play" : "add"} onPress={goToEvening}>{openSession ? "Weiterspielen" : "Abend starten"}</Button>
            </>
          ) : null
        }
      />

      {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

      {!isTablet ? (
        <Row gap={spacing.xs}>
          <Button icon={openSession ? "play" : "add"} onPress={goToEvening} style={{ flex: 1 }}>
            {openSession ? "Weiterspielen" : "Abend starten"}
          </Button>
          <Button tone="secondary" icon="wallet-outline" onPress={() => router.push("/(tabs)/cashbox")}>Zahlung</Button>
        </Row>
      ) : null}

      {needsSetup ? (
        <Card tone="accent">
          <CardHeader overline="Erste Schritte" title="Stammrunde einrichten" icon="rocket-outline" />
          <AppText tone="muted">Lege deine Stammspieler, den Einsatz und die Abwesenheitsregel in einem kurzen Assistenten fest.</AppText>
          <Button iconRight="arrow-forward" onPress={() => router.push("/onboarding")}>Einrichtung starten</Button>
        </Card>
      ) : null}

      {openSession ? (
        <Card tone="hero">
          <CardHeader
            overline={`Läuft seit ${formatDateTime(openSession.startedAt)}`}
            title={openSession.title}
            icon="radio-outline"
            aside={<Badge tone="success" dot>LIVE</Badge>}
          />
          <Row gap={spacing.xs}>
            <StatTile label="Am Tisch" value={`${openSession.presentCount}`} icon="people-outline" />
            <StatTile label="Verluste" value={`${openSession.lossCount}`} icon="trending-down-outline" />
            <StatTile label="Gebucht" value={formatCurrency(openSession.totalLossCents)} icon="cash-outline" />
          </Row>
          <Button size="lg" icon="grid" iconRight="arrow-forward" onPress={() => router.push(`/session/${openSession.id}`)}>Zum Brett</Button>
        </Card>
      ) : null}

      {isTablet ? (
        <Grid columns={{ compact: 1, medium: 3, expanded: 3 }} gap={spacing.md}>
        <KpiTile
          tone="hero"
          icon="wallet"
          label={snapshot.settings.cashboxLabel || "Kasse"}
          value={snapshot.cashbox.totalPaymentsCents}
          format={formatCurrency}
          sparkline={charts.cashSeries}
          hint="Alle erfassten Zahlungen"
        />
        <KpiTile
          icon="alert-circle-outline"
          label="Offene Schulden"
          value={snapshot.cashbox.totalOutstandingCents}
          format={formatCurrency}
          sparkline={charts.debtSeries}
          sparkColor={colors.danger}
          valueTone={snapshot.cashbox.totalOutstandingCents > 0 ? "default" : "success"}
          hint="Noch nicht eingezahlt"
        />
        <KpiTile
          icon="trending-down-outline"
          label="Verluste · letzte 5 Abende"
          value={charts.recentLossCents}
          format={formatCurrency}
          sparkline={charts.recentLossSeries}
          sparkColor={colors.muted}
          hint={charts.recentEveningCount ? `Aus ${charts.recentEveningCount} abgeschlossenen ${charts.recentEveningCount === 1 ? "Abend" : "Abenden"}` : "Noch kein Abend abgeschlossen"}
        />
        </Grid>
      ) : (
        // Phone: hero Kasse full width, the other two side by side.
        <Stack gap={spacing.sm}>
        <KpiTile
          tone="hero"
          icon="wallet"
          label={snapshot.settings.cashboxLabel || "Kasse"}
          value={snapshot.cashbox.totalPaymentsCents}
          format={formatCurrency}
          sparkline={charts.cashSeries}
          hint="Alle erfassten Zahlungen"
        />
          <Row gap={spacing.sm}>
        <KpiTile
          icon="alert-circle-outline"
          label="Offene Schulden"
          value={snapshot.cashbox.totalOutstandingCents}
          format={formatCurrency}
          sparkline={charts.debtSeries}
          sparkColor={colors.danger}
          valueTone={snapshot.cashbox.totalOutstandingCents > 0 ? "default" : "success"}
          hint="Noch nicht eingezahlt"
        />
        <KpiTile
          icon="trending-down-outline"
          label="Verluste · letzte 5 Abende"
          value={charts.recentLossCents}
          format={formatCurrency}
          sparkline={charts.recentLossSeries}
          sparkColor={colors.muted}
          hint={charts.recentEveningCount ? `Aus ${charts.recentEveningCount} abgeschlossenen ${charts.recentEveningCount === 1 ? "Abend" : "Abenden"}` : "Noch kein Abend abgeschlossen"}
        />
          </Row>
        </Stack>
      )}

      <Split weights={[7, 5]}>
        <Card>
          <CardHeader overline="Trend" title="Verluste pro Abend" icon="analytics-outline" aside={charts.trend.labels.length ? <Badge>{charts.trend.labels.length} Abende</Badge> : null} />
          {charts.trend.labels.length >= 2 ? (
            <LineChart series={trendSeries} labels={charts.trend.labels} height={isTablet ? 240 : 190} formatY={euroAxis} area legend={trendSeries.length > 1} />
          ) : (
            <EmptyState icon="analytics-outline" title="Noch zu wenig Daten">
              Nach zwei abgeschlossenen Abenden erscheint hier der Verlauf.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader overline="Kasse" title="Eingezahlt vs. offen" icon="pie-chart-outline" />
          {hasMoney ? (
            <Donut
              data={donutData}
              size={isTablet ? 150 : 128}
              centerValue={formatCurrency(snapshot.cashbox.totalPaymentsCents)}
              centerLabel="In der Kasse"
            />
          ) : (
            <EmptyState icon="wallet-outline">Noch keine Buchungen in der Kasse.</EmptyState>
          )}
          <Divider />
          <CardHeader overline="Offene Posten" title="Größte Zahler" />
          {debtorBars.length ? (
            <BarChart data={debtorBars} onPressItem={() => router.push("/(tabs)/cashbox")} />
          ) : (
            <EmptyState icon="checkmark-done-outline">Keine offenen Schulden – alles beglichen.</EmptyState>
          )}
        </Card>
      </Split>

      {isAdvanced ? (
        <Split weights={[7, 5]}>
          <Card>
            <CardHeader overline="Letzte Buchungen" title="Timeline" icon="time-outline" />
            {snapshot.recentHistory.length ? (
              <View>
                {snapshot.recentHistory.map((entry, index) => {
                  const display = describeHistoryEntry(entry);
                  return (
                    <View key={entry.id}>
                      {index > 0 ? <Divider /> : null}
                      <ListRow
                        leading={entry.playerId && entry.playerName ? <PlayerAvatar id={entry.playerId} name={entry.playerName} size={28} /> : <HistoryIcon kind={entry.kind} />}
                        title={display.title}
                        detail={[formatDateTime(entry.createdAt), display.detail].filter(Boolean).join(" · ")}
                        value={entry.amountCents !== null ? formatCurrency(entry.amountCents) : undefined}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <EmptyState icon="time-outline">Noch keine Buchungen.</EmptyState>
            )}
          </Card>

          <Card tone="accent">
            <CardHeader overline="Hausregeln" title={snapshot.settings.ruleProfile.title} icon="book-outline" aside={<Badge tone="accent">{snapshot.settings.ruleProfile.alias.general}</Badge>} />
            <AppText tone="muted">{snapshot.settings.ruleProfile.overview}</AppText>
            <Stack gap={spacing.xs}>
              {snapshot.settings.ruleProfile.ranking.map((item, index) => (
                <Row key={item} gap={spacing.xs} align="flex-start">
                  <AppText variant="numericSm" tone="accent" style={{ width: 20 }}>{index + 1}</AppText>
                  <AppText style={{ flex: 1 }}>{item}</AppText>
                </Row>
              ))}
            </Stack>
          </Card>
        </Split>
      ) : null}
    </Screen>
  );
}

function HistoryIcon({ kind }: { kind: string }) {
  const icon = kind === "payment" ? "wallet-outline" : kind === "correction" ? "construct-outline" : kind === "audit" ? "document-text-outline" : "ellipse-outline";
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft }}>
      <Ionicons name={icon} size={14} color={colors.muted} />
    </View>
  );
}
