import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { BottomSheet } from "@/components/bottom-sheet";
import { PlayerAvatar } from "@/components/avatar";
import { BarChart, Donut, type BarDatum } from "@/components/charts";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  Divider,
  EmptyState,
  Field,
  Input,
  KpiTile,
  ListRow,
  LoadError,
  Notice,
  Row,
  Screen,
  ScreenHeader,
  Select,
  SkeletonScreen,
  Split,
  Stack,
} from "@/components/ui";
import { formatCurrency } from "@/domain/format";
import { cleanOptionalText, parseEuroToCents } from "@/domain/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useDeviceLayout } from "@/hooks/use-device-layout";
import { useRuntime } from "@/providers/runtime-provider";
import { CashboxService } from "@/services/cashbox-service";
import { Feedback } from "@/services/haptics";
import { SessionService } from "@/services/session-service";
import { colors, spacing } from "@/theme/tokens";

const AMOUNT_PRESETS = [500, 1000, 2000];

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export default function CashboxScreen() {
  const runtime = useRuntime();
  const { isTablet } = useDeviceLayout();
  const data = useAsyncResource(
    () => ({
      cashbox: CashboxService.getCashboxSummary(),
      debtors: CashboxService.getDebtSummaries(),
      players: SessionService.listPlayers(),
      sessions: SessionService.listSessions(),
      cashboxLabel: SessionService.getSettings().cashboxLabel,
    }),
    [runtime.dataVersion],
  );
  const [playerId, setPlayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!data.data) {
      return;
    }

    const defaultPlayerId = data.data.players.find((player) => !player.isArchived)?.id ?? "";

    if (!playerId) {
      setPlayerId(defaultPlayerId);
    }
  }, [data.data, playerId]);

  const isAdvanced = runtime.viewMode === "advanced";

  const derived = useMemo(() => {
    if (!data.data) return null;
    const open = data.data.debtors.filter((row) => row.openDebtCents > 0);
    const credit = data.data.debtors.filter((row) => row.openDebtCents < 0);
    const bars: BarDatum[] = open.map((row) => ({
      id: row.playerId,
      label: row.playerName,
      value: row.openDebtCents,
      display: formatCurrency(row.openDebtCents),
      sublabel: isAdvanced ? `Verluste ${formatCurrency(row.lossCents)} · Abwesenheit ${formatCurrency(row.absenceCents)}` : row.isCore ? undefined : "Gast",
      avatar: { id: row.playerId, name: row.playerName },
    }));
    const paid = data.data.cashbox.totalPaymentsCents;
    const outstanding = Math.max(0, data.data.cashbox.totalOutstandingCents);
    const donut = [
      { key: "paid", label: "Eingezahlt", value: paid, color: colors.accent, display: formatCurrency(paid) },
      { key: "open", label: "Noch offen", value: outstanding, color: colors.danger, display: formatCurrency(outstanding) },
    ];
    return { open, credit, bars, donut };
  }, [data.data, isAdvanced]);

  if (data.error && !data.data) return <LoadError error={data.error} onRetry={data.reload} />;
  if (!data.data || !derived || !runtime.account) return <SkeletonScreen variant="dashboard" />;

  // Archived players can still settle what they owe.
  const owing = new Set(data.data.debtors.filter((row) => row.openDebtCents > 0).map((row) => row.playerId));
  const activePlayers = data.data.players.filter((player) => !player.isArchived || owing.has(player.id));
  const { cashbox } = data.data;
  const hasMoney = cashbox.totalPaymentsCents > 0 || cashbox.totalOutstandingCents > 0;

  function openPayment(targetPlayerId: string, cents: number) {
    Feedback.tap();
    setPlayerId(targetPlayerId);
    setAmount(cents > 0 ? centsToInput(cents) : "");
    if (!isTablet) setSheetOpen(true);
  }

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
      Feedback.success();
      runtime.bumpDataVersion();
      runtime.setFlash({
        type: "success",
        message: "Zahlung verbucht.",
      });
      setAmount("");
      setNote("");
      setSessionId("");
      setSheetOpen(false);
    } catch (caught) {
      Feedback.error();
      runtime.setFlash({
        type: "error",
        message: caught instanceof Error ? caught.message : "Zahlung konnte nicht verbucht werden.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDebt = data.data.debtors.find((row) => row.playerId === playerId)?.openDebtCents ?? 0;

  const paymentForm = (
    <Stack gap={spacing.md}>
      <Field label="Spieler">
        <Select
          selectedValue={playerId}
          onValueChange={setPlayerId}
          items={activePlayers.map((player) => ({
            label: player.name,
            value: player.id,
          }))}
        />
      </Field>
      <Field label="Betrag (€)" hint={selectedDebt > 0 ? `Offen: ${formatCurrency(selectedDebt)}` : undefined}>
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="5,00" />
        <Row gap={spacing.xs} wrap>
          {selectedDebt > 0 ? (
            <Chip label={`Alles · ${formatCurrency(selectedDebt)}`} icon="checkmark-done" selected={amount === centsToInput(selectedDebt)} onPress={() => setAmount(centsToInput(selectedDebt))} />
          ) : null}
          {AMOUNT_PRESETS.map((cents) => (
            <Chip key={cents} label={formatCurrency(cents)} selected={amount === centsToInput(cents)} onPress={() => setAmount(centsToInput(cents))} />
          ))}
        </Row>
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
        <Input value={note} onChangeText={setNote} placeholder="Optional: Bar, PayPal, Rundung …" />
      </Field>
      <Button size="lg" icon="checkmark" onPress={handleRecordPayment} loading={submitting} disabled={!playerId || !amount.trim()}>
        Zahlung verbuchen
      </Button>
    </Stack>
  );

  const debtsCard = (
    <Card>
      <CardHeader
        overline="Offene Schulden"
        title="Wer muss noch zahlen?"
        icon="people-outline"
        aside={derived.open.length ? <Badge tone="danger">{derived.open.length} offen</Badge> : <Badge tone="success" icon="checkmark">Alles bezahlt</Badge>}
      />
      {derived.bars.length ? (
        <BarChart
          data={derived.bars}
          color={colors.danger}
          highlightFirst={false}
          trailing={(item) => (
            <Button size="sm" tone="secondary" icon="cash-outline" accessibilityLabel={`Zahlung für ${item.label} buchen`} onPress={() => openPayment(item.id, item.value)}>
              Zahlen
            </Button>
          )}
        />
      ) : (
        <EmptyState icon="checkmark-done-outline" title="Alles beglichen">Aktuell sind keine offenen Schulden mehr vorhanden.</EmptyState>
      )}
      {derived.credit.length ? (
        <>
          <Divider />
          <CardHeader overline="Guthaben" title="Im Plus" icon="trending-up-outline" />
          <View>
            {derived.credit.map((row) => (
              <ListRow
                key={row.playerId}
                leading={<PlayerAvatar id={row.playerId} name={row.playerName} size={32} />}
                title={row.playerName}
                detail="Hat mehr eingezahlt als offen war"
                value={`+${formatCurrency(-row.openDebtCents)}`}
                valueTone="success"
              />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );

  return (
    <>
    <Screen>
      <ScreenHeader
        title="Kasse"
        context={`${data.data.cashboxLabel || "Getränkekasse"} · Zahlungen verbuchen, offene Beträge im Blick`}
        actions={
          !isTablet ? (
            <Button size="sm" icon="add" onPress={() => openPayment(playerId, 0)}>Zahlung</Button>
          ) : null
        }
      />

      {runtime.flash ? <Notice message={runtime.flash.message} type={runtime.flash.type} /> : null}

      <Split weights={[5, 7]}>
        <Card>
          <CardHeader overline="Überblick" title="Eingezahlt vs. offen" icon="pie-chart-outline" />
          {hasMoney ? (
            <Donut
              data={derived.donut}
              size={isTablet ? 160 : 136}
              centerValue={formatCurrency(cashbox.totalPaymentsCents)}
              centerLabel="Kassenstand"
            />
          ) : (
            <EmptyState icon="wallet-outline">Noch keine Buchungen in der Kasse.</EmptyState>
          )}
        </Card>
        <Row gap={isTablet ? spacing.md : spacing.sm} align="stretch">
          <KpiTile tone="hero" icon="wallet" label="Kassenstand" value={cashbox.totalPaymentsCents} format={formatCurrency} hint="Bereits eingezahlt" />
          <KpiTile
            icon="alert-circle-outline"
            label="Offene Schulden"
            value={cashbox.totalOutstandingCents}
            format={formatCurrency}
            valueTone={cashbox.totalOutstandingCents > 0 ? "danger" : "success"}
            hint="Noch nicht in der Kasse"
          />
        </Row>
      </Split>

      {isTablet ? (
        <Split weights={[7, 5]}>
          {debtsCard}
          <Card tone="accent">
            <CardHeader overline="Zahlung" title="In die Kasse buchen" icon="cash-outline" />
            {paymentForm}
          </Card>
        </Split>
      ) : (
        <>
          <Button tone="secondary" icon="cash-outline" onPress={() => openPayment(playerId, 0)}>Zahlung buchen</Button>
          {debtsCard}
        </>
      )}
    </Screen>
    <BottomSheet visible={sheetOpen && !isTablet} onClose={() => setSheetOpen(false)} eyebrow="Zahlung" title="In die Kasse buchen">
      {paymentForm}
    </BottomSheet>
    </>
  );
}
