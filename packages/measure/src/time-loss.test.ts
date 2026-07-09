import { describe, expect, it } from "vitest";
import { formatApproxTimeLost } from "./time-loss.js";

describe("time-loss display", () => {
  it.each([
    [0, "~0s"],
    [1_499, "~1s"],
    [59_600, "~60s"],
    [60_000, "~1.0 min"],
    [90_000, "~1.5 min"],
    [3_599_999, "~60.0 min"],
    [3_600_000, "~1.0 hr"],
    [5_400_000, "~1.5 hr"],
  ])("time-loss-rounding-ratified: formats %sms as %s", (ms, expected) => {
    expect(formatApproxTimeLost(ms)).toBe(expected);
  });
});
