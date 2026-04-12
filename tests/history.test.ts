import { describe, expect, it } from "vitest";

import { describeHistoryEntry } from "@/domain/history";

describe("history helpers", () => {
  it("normalizes loss copy", () => {
    const result = describeHistoryEntry({
      id: "loss_1",
      kind: "loss",
      createdAt: new Date().toISOString(),
      playerId: "player_1",
      playerName: "Mike",
      amountCents: 100,
      message: "Verlust geloggt",
      sessionId: "session_1",
      sessionTitle: "Freitag",
      actorUsername: "admin",
    });

    expect(result.title).toBe("Verlust");
    expect(result.detail).toBe("Mike · Freitag");
  });

  it("translates audit events", () => {
    const result = describeHistoryEntry({
      id: "audit_1",
      kind: "audit",
      createdAt: new Date().toISOString(),
      playerId: null,
      playerName: null,
      amountCents: null,
      message: "session.created",
      sessionId: "session_1",
      sessionTitle: "Freitag",
      actorUsername: "admin",
    });

    expect(result.title).toBe("Spielabend angelegt");
    expect(result.detail).toBe("Freitag");
  });
});
