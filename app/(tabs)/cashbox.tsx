import { ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";

import { Button, Card, EmptyState, Field, Notice, Screen, SectionTitle, Select, Split, Stack, StatCard, ListRow, Input } from "@/components/ui";
import { formatCurrency } from "@/domain/format";
import { cleanOptionalText, parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useRuntime } from "@/providers/runtime-provider";
import { CashboxService } from "@/services/cashbox-service";
import { SessionService } from "@/services/session-service";
import { colors } from "@/theme/tokens";

export default function CashboxScreen() {
  const runtime = useRuntime();
  const data = useAsyncResource(
    () => ({
      cashbox: CashboxService.getCashboxSummary(),
      debtors: CashboxService.getDebtSummaries(),
      players: SessionService.listPlayers(),
      sessions: SessionService.listSessions(),
    }),
    [runtime.dataVersion],
  );
  const [playerId, setPlayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!data.data) {
      return;
    }

    const defaultPlayerId = data.data.players.find((player) => !player.isArchived)?.id ?? "";

    if (!playerId) {
      setPlayerId(defaultPlayerId);
    }
  }, [data.data, playerId]);

  if (data.loading || !data.data || !runtime.account) {
    return (
      <Screen>
        <ActivityIndicator color={colors.accentStrong} size="large" />
      </Screen>
    );
  }

  const isAdvanced = runtime.viewMode === "advanced";

  async function handleRecordPayment() {
    try {
      setSubmitting(true);
      CashboxService.recordPayment({
        actor: {
          accountId: runtime.account!.id,
          username: runtime.account!.username,
        },
        playerId,
        amountCents: parseEuroToCents(amount),
        note: cleanOptionalText(note),
        sessionId: sessionId || null,
      });
      runtime.bumpDataVersion();
      runtime.setFlash({
        type: "success",
        message: "Zahlung verbucht.",
      });
      setAmount("");
      setNote("");
      setSessionId("");
    } catch (caught) {
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Zahlung konnte nicht verbucht werden.",
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
          <StatCard label="Kassenstand" value={formatCurrency(data.data.cashbox.totalPaymentsCents)} hint="Bereits eingezahlt" />
          <StatCard label="Offene Schulden" value={formatCurrency(data.data.cashbox.totalOutstandingCents)} hint="Noch nicht in der Kasse" />
        </Split>

        <Split>
          <Card>
            <SectionTitle eyebrow="Zahlung" title="In die Kasse buchen" />
            <Field label="Spieler">
              <Select
                selectedValue={playerId}
                onValueChange={setPlayerId}
                items={data.data.players.filter((player) => !player.isArchived).map((player) => ({
                  label: player.name,
                  value: player.id,
                }))}
              />
            </Field>
            <Field label="Betrag (€)">
              <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="5,00" />
            </Field>
            {isAdvanced ? (
              <Field label="Zuordnung zum Abend">
                <Select
                  selectedValue={sessionId}
                  onValueChange={setSessionId}
                  items={[
                    { label: "Ohne Zuordnung", value: "" },
                    ...data.data.sessions.map((session) => ({
                      label: session.title,
                      value: session.id,
                    })),
                  ]}
                />
              </Field>
            ) : null}
            <Field label="Notiz">
              <Input value={note} onChangeText={setNote} placeholder="Optional: Bar, PayPal, Rundung ..." />
            </Field>
            <Button onPress={handleRecordPayment} disabled={submitting}>
              {submitting ? "Verbucht…" : "Zahlung verbuchen"}
            </Button>
          </Card>

          <Card>
            <SectionTitle eyebrow="Offene Schulden" title="Wer muss noch zahlen?" />
            <Stack>
              {data.data.debtors.filter((row) => row.openDebtCents > 0).length > 0 ? (
                data.data.debtors
                  .filter((row) => row.openDebtCents > 0)
                  .map((row) => (
                    <ListRow
                      key={row.playerId}
                      title={row.playerName}
                      detail={isAdvanced ? `Verluste ${formatCurrency(row.lossCents)} · Abwesenheit ${formatCurrency(row.absenceCents)}` : undefined}
                      value={formatCurrency(row.openDebtCents)}
                    />
                  ))
              ) : (
                <EmptyState>Aktuell sind keine offenen Schulden mehr vorhanden.</EmptyState>
              )}
            </Stack>
          </Card>
        </Split>
      </Stack>
    </Screen>
  );
}
