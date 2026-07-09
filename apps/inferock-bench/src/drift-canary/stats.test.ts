import { describe, expect, it } from "vitest";
import {
  fisherExactDropPValue,
  flagDriftByAccuracyDrop,
} from "./stats.js";

describe("drift canary statistics", () => {
  it("flags a one-sided Fisher exact accuracy drop below alpha", () => {
    const result = flagDriftByAccuracyDrop({
      baselinePassed: 135,
      baselineTotal: 150,
      currentPassed: 30,
      currentTotal: 50,
      alpha: 0.05,
    });

    expect(result.flagged).toBe(true);
    expect(result.baselineAccuracy).toBeCloseTo(0.9, 6);
    expect(result.currentAccuracy).toBeCloseTo(0.6, 6);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("does not flag improvements or statistically weak drops", () => {
    expect(flagDriftByAccuracyDrop({
      baselinePassed: 120,
      baselineTotal: 150,
      currentPassed: 43,
      currentTotal: 50,
      alpha: 0.05,
    }).flagged).toBe(false);

    expect(flagDriftByAccuracyDrop({
      baselinePassed: 120,
      baselineTotal: 150,
      currentPassed: 38,
      currentTotal: 50,
      alpha: 0.05,
    }).flagged).toBe(false);
  });

  it("keeps Fisher p-values inside probability bounds for edge tables", () => {
    expect(fisherExactDropPValue({
      baselinePassed: 0,
      baselineTotal: 10,
      currentPassed: 0,
      currentTotal: 10,
    })).toBeGreaterThanOrEqual(0);
    expect(fisherExactDropPValue({
      baselinePassed: 10,
      baselineTotal: 10,
      currentPassed: 0,
      currentTotal: 10,
    })).toBeLessThan(0.001);
  });
});
