import { describe, expect, it } from "vitest";

import { countUpValue } from "@/components/motion-math";
import { createSingleFlight } from "@/services/single-flight";

describe("createSingleFlight", () => {
  it("runs the first call and ignores repeats within the cooldown", () => {
    let clock = 1000;
    const once = createSingleFlight(800, () => clock);
    let bookings = 0;

    expect(once(() => bookings++)).toBe(true);
    clock += 50;
    expect(once(() => bookings++)).toBe(false);
    clock += 700;
    expect(once(() => bookings++)).toBe(false);
    expect(bookings).toBe(1);

    clock += 100;
    expect(once(() => bookings++)).toBe(true);
    expect(bookings).toBe(2);
  });

  it("allows an immediate retry after a rejected booking", () => {
    const once = createSingleFlight(800, () => 0);
    expect(() => once(() => { throw new Error("Ungültiger Betrag"); })).toThrow("Ungültiger Betrag");
    let bookings = 0;
    expect(once(() => bookings++)).toBe(true);
    expect(bookings).toBe(1);
  });
});

describe("countUpValue", () => {
  it("is monotonic, whole cents and lands exactly on the target", () => {
    const steps = Array.from({ length: 11 }, (_, i) => countUpValue(0, 5000, i / 10));
    expect(steps[0]).toBe(0);
    expect(steps[10]).toBe(5000);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(steps.every(Number.isInteger)).toBe(true);
    expect(countUpValue(5000, 0, 1.4)).toBe(0);
  });
});
