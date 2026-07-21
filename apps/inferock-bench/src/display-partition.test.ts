import { describe, expect, it } from "vitest";
import {
  reconciledApproxTimePartition,
  reconciledUsdPartition,
} from "./display-partition.js";

describe("display partition reconciliation", () => {
  it("allocates residual cents by largest remainder so displayed money parts sum to displayed total", () => {
    const split = reconciledUsdPartition({
      total: 2263.196135,
      parts: [
        { key: "providerRecognized", value: 1813.172824 },
        { key: "recognitionGap", value: 450.023311 },
      ],
      fractionDigits: 2,
    });

    expect(split.total).toBe("$2,263.20");
    expect(split.parts.providerRecognized).toBe("$1,813.17");
    expect(split.parts.recognitionGap).toBe("$450.03");
    expect(cents(split.parts.providerRecognized) + cents(split.parts.recognitionGap))
      .toBe(cents(split.total));
  });

  it("uses the total time display unit so displayed time parts sum to displayed duration loss", () => {
    const split = reconciledApproxTimePartition({
      totalMs: 64_500,
      parts: [
        { key: "providerRecognized", value: 37_000 },
        { key: "recognitionGap", value: 27_500 },
      ],
    });

    expect(split.total).toBe("~1.1 min");
    expect(split.parts.providerRecognized).toBe("~0.6 min");
    expect(split.parts.recognitionGap).toBe("~0.5 min");
    expect(tenthsOfMinute(split.parts.providerRecognized) + tenthsOfMinute(split.parts.recognitionGap))
      .toBe(tenthsOfMinute(split.total));
  });
});

function cents(value: string): number {
  return Math.round(Number(value.replace(/[$,]/gu, "")) * 100);
}

function tenthsOfMinute(value: string): number {
  const match = value.match(/^~([0-9.]+) min$/u);
  if (!match?.[1]) throw new Error(`expected minute display, got ${value}`);
  return Math.round(Number(match[1]) * 10);
}
