import type { PlayerDebtSummary } from "@/domain/types";

export function calculateAbsenceAverageCents(totalPresentCoreLossCents: number, presentCoreCount: number) {
  if (presentCoreCount <= 0) {
    throw new Error("Mindestens ein anwesender Stammspieler ist erforderlich.");
  }

  return Math.round(totalPresentCoreLossCents / presentCoreCount);
}

export function calculateOpenDebtCents(input: {
  lossCents: number;
  absenceCents: number;
  correctionCents: number;
  paymentCents: number;
}) {
  return input.lossCents + input.absenceCents + input.correctionCents - input.paymentCents;
}

/**
 * A voided loss is removed from loss_entries. The correction row is a visible
 * receipt for that action, not a second financial transaction.
 */
export function getVoidedLossCorrectionCents() {
  return 0;
}

export function calculateCashboxTotalCents(paymentAmounts: number[]) {
  return paymentAmounts.reduce((sum, value) => sum + value, 0);
}

export function sortDebtors(rows: PlayerDebtSummary[]) {
  return [...rows].sort((left, right) => {
    if (right.openDebtCents !== left.openDebtCents) {
      return right.openDebtCents - left.openDebtCents;
    }

    return left.playerName.localeCompare(right.playerName, "de");
  });
}
