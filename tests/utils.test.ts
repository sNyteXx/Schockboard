import { describe, expect, it } from "vitest";

import { cleanOptionalText, parseEuroToCents, parseSignedEuroToCents, slugify } from "@/domain/utils";

describe("utils", () => {
  it("slugifies names with umlauts and spaces", () => {
    expect(slugify(" Änne von Schock ")).toBe("anne-von-schock");
  });

  it("parses euro values", () => {
    expect(parseEuroToCents("2,50")).toBe(250);
    expect(parseSignedEuroToCents("-1,75")).toBe(-175);
  });

  it("cleans optional text", () => {
    expect(cleanOptionalText("  hallo  ")).toBe("hallo");
    expect(cleanOptionalText("   ")).toBeNull();
  });
});
