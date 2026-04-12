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
