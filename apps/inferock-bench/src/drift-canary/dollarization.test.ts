import { describe, expect, it } from "vitest";
import { dollarizeDriftCanaryRegression } from "./dollarization.js";

describe("drift canary dollarization", () => {
  it("computes the standard-loss floor for canary and lower-grade customer calls in the affected window", () => {
    const result = dollarizeDriftCanaryRegression({
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      baseline: {
        runIds: ["run-1", "run-2", "run-3"],
        passed: 135,
        total: 150,
        accuracy: 0.9,
      },
      current: {
        runId: "run-flagged",
        passed: 30,
        total: 50,
        accuracy: 0.6,
      },
      alpha: 0.05,
      pValue: 0.0002,
      lastGoodRunId: "run-3",
      firstFlaggedRunId: "run-flagged",
      window: {
        since: "2026-07-04T10:00:00.000Z",
        until: "2026-07-04T11:00:00.000Z",
      },
      affectedCalls: [
        { requestId: "canary-1", kind: "canary", costUsd: 0.00001 },
        { requestId: "canary-2", kind: "canary", costUsd: 0.00002 },
        { requestId: "customer-1", kind: "customer", costUsd: 0.25 },
      ],
    });

    expect(result).toMatchObject({
      methodId: "drift_canary_floor_v1",
      standardLossUsd: 0.25003,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0.25003,
      evidenceGrade: "unrecognized_standard_loss",
      failureClass: "drift_regression",
      affectedCallCount: 3,
      canaryCallCount: 2,
      customerCallCount: 1,
    });
    expect(result.computationTrace).toMatchObject({
      methodId: "drift_canary_floor_v1",
      basis: "failed_to_deliver_drift_regression",
      inputs: {
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        evidenceGrades: {
          canaryCalls: "higher",
          customerCalls: "lower",
        },
      },
      sourceRefs: {
        nonDeterminism: "arXiv:2506.09501",
      },
    });
  });
});
