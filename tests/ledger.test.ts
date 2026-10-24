import { describe, expect, it } from "vitest";

import { calculateAbsenceAverageCents, calculateOpenDebtCents, getVoidedLossCorrectionCents, sortDebtors } from "@/domain/ledger";

describe("ledger", () => {
  it("calculates rounded absence averages", () => {
    expect(calculateAbsenceAverageCents(1000, 3)).toBe(333);
  });

  it("calculates open debt from all components", () => {
    expect(
      calculateOpenDebtCents({
        lossCents: 1500,
        absenceCents: 200,
        correctionCents: -100,
        paymentCents: 500,
      }),
    ).toBe(1100);
  });

  it("does not double-subtract a deleted loss", () => {
    const before = calculateOpenDebtCents({ lossCents: 100, absenceCents: 0, correctionCents: 0, paymentCents: 0 });
    const after = calculateOpenDebtCents({ lossCents: 0, absenceCents: 0, correctionCents: getVoidedLossCorrectionCents(), paymentCents: 0 });
    expect(before).toBe(100);
    expect(after).toBe(0);
    expect(before - after).toBe(100);
  });

  it("sorts debtors by debt desc and name asc", () => {
    const rows = sortDebtors([
      {
        playerId: "2",
        playerName: "Berta",
        isCore: true,
        isArchived: false,
        lossCents: 500,
        absenceCents: 0,
        correctionCents: 0,
        paymentCents: 0,
        openDebtCents: 500,
      },
      {
        playerId: "1",
        playerName: "Anton",
        isCore: true,
        isArchived: false,
        lossCents: 500,
        absenceCents: 0,
        correctionCents: 0,
        paymentCents: 0,
        openDebtCents: 500,
      },
      {
        playerId: "3",
        playerName: "Chris",
        isCore: false,
        isArchived: false,
        lossCents: 700,
        absenceCents: 0,
        correctionCents: 0,
        paymentCents: 0,
        openDebtCents: 700,
      },
    ]);

    expect(rows.map((row) => row.playerName)).toEqual(["Chris", "Anton", "Berta"]);
  });
});
