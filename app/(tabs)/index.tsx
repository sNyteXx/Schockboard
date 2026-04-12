import { useRouter } from "expo-router";
import { ActivityIndicator, Text } from "react-native";

import { Badge, Button, Card, EmptyState, ListRow, Notice, Screen, SectionTitle, Split, Stack, StatCard } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/domain/format";
import { describeHistoryEntry } from "@/domain/history";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useRuntime } from "@/providers/runtime-provider";
import { SessionService } from "@/services/session-service";
import { colors } from "@/theme/tokens";

export default function DashboardScreen() {
  const router = useRouter();
  const runtime = useRuntime();
  const snapshot = useAsyncResource(() => SessionService.getDashboardSnapshot(), [runtime.dataVersion]);

  if (snapshot.loading || !snapshot.data) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    );
  }

  const openSession = snapshot.data.openSession;
  const isAdvanced = runtime.viewMode === "advanced";

  return (
    <Screen>
      <Stack>
        {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

        <Card tone="accent">
          <SectionTitle eyebrow="Live-Übersicht" title="Schuldenboard" />
          <Split>
            <Button onPress={() => router.push("/(tabs)/sessions")}>🎲 Spielabend öffnen</Button>
            <Button tone="secondary" onPress={() => router.push("/(tabs)/cashbox")}>
              💰 Zahlung buchen
            </Button>
          </Split>
        </Card>

        <Split>
          <StatCard
            label="Getränkekasse"
            value={formatCurrency(snapshot.data.cashbox.totalPaymentsCents)}
            hint="Alle erfassten Zahlungen"
          />
          <StatCard
            label="Offene Schulden"
            value={formatCurrency(snapshot.data.cashbox.totalOutstandingCents)}
            hint="Noch nicht eingezahlte Beträge"
          />
        </Split>

        <Split>
          <Card>
            <SectionTitle
              eyebrow="Aktiver Abend"
              title="Session-Status"
            aside={openSession ? <Badge tone="success">Offen</Badge> : <Badge>Kein Abend offen</Badge>}
          />
            {openSession ? (
              <Stack>
                <ListRow
                  title={openSession.title}
                  detail={formatDateTime(openSession.startedAt)}
                  value=""
                />
                <Text style={{ color: colors.muted }}>
                  {openSession.presentCount} anwesend · {openSession.lossCount} Verluste · {formatCurrency(openSession.totalLossCents)} geloggt
                </Text>
                <Button onPress={() => router.push(`/session/${openSession.id}`)}>Zum Abend</Button>
              </Stack>
            ) : (
              <EmptyState>Aktuell ist kein Spielabend offen. Über „Spielabend öffnen“ legst du direkt den nächsten Abend an.</EmptyState>
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Offene Posten" title="Größte Zahler" />
            <Stack>
              {snapshot.data.debtors.slice(0, isAdvanced ? 6 : 3).length > 0 ? (
                snapshot.data.debtors.slice(0, isAdvanced ? 6 : 3).map((debtor) => (
                  <ListRow
                    key={debtor.playerId}
                    title={debtor.playerName}
                    detail={isAdvanced ? `${debtor.isCore ? "Stammrunde" : "Gast"} · Verluste ${formatCurrency(debtor.lossCents)}` : `${debtor.isCore ? "Stammrunde" : "Gast"}`}
                    value={formatCurrency(debtor.openDebtCents)}
                  />
                ))
              ) : (
                <EmptyState>Noch keine offenen Schulden vorhanden.</EmptyState>
              )}
            </Stack>
          </Card>
        </Split>

        {isAdvanced ? (
          <Split>
            <Card>
              <SectionTitle eyebrow="Letzte Buchungen" title="Timeline" />
              <Stack>
                {snapshot.data.recentHistory.map((entry) => {
                  const display = describeHistoryEntry(entry);
                  const detail = [display.detail, entry.amountCents !== null ? formatCurrency(entry.amountCents) : null]
                    .filter(Boolean)
                    .join(" · ");

                  return <ListRow key={entry.id} title={display.title} detail={`${formatDateTime(entry.createdAt)} · ${detail}`} />;
                })}
              </Stack>
            </Card>

            <Card tone="accent">
              <SectionTitle eyebrow="Hausregeln" title={snapshot.data.settings.ruleProfile.title} aside={<Badge>{snapshot.data.settings.ruleProfile.alias.general}</Badge>} />
              <Text style={{ color: colors.muted }}>{snapshot.data.settings.ruleProfile.overview}</Text>
              <Stack>
                {snapshot.data.settings.ruleProfile.ranking.map((item) => (
                  <Text key={item} style={{ color: colors.text }}>
                    • {item}
                  </Text>
                ))}
              </Stack>
            </Card>
          </Split>
        ) : null}
      </Stack>
    </Screen>
  );
}
