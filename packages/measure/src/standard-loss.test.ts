import { describe, expect, it } from "vitest";
import type { CanonicalEventV1 } from "./canonical-event.js";
import { ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID } from "./anthropic-token-crosscheck.js";
import { buildLossSignal } from "./signal.js";
import {
  applyStandardLossEconomicsToSignals,
  publicTimeLossTotalsForSignals,
  type PublicTimeLossEvent,
  type PublicTimeLossSignal,
} from "./standard-loss.js";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import type { LossSignal } from "./types.js";

describe("standard loss economics", () => {
  it("standard-loss-floor-supersession: attributes call-cost floor once across whole-call failure signals", () => {
    const event = pricedEvent({
      provider: "anthropic",
      model: "claude-sonnet-5-20260614",
      requestId: "req-standard-floor-once",
    });
    const signals = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "BROKEN_OUTPUT",
        detector: "broken-output",
        failureClass: "broken_output",
      }),
      lossSignal(event, {
        code: "ANTHROPIC_TOKEN_CROSSCHECK",
        detector: "billing-integrity",
        failureClass: "anthropic_token_crosscheck",
      }),
    ]);

    const totalStandardLoss = standardLossTotal(signals);
    const nonzero = signals.filter((signal) => (signal.standardLossUsd ?? 0) > 0);
    expect(totalStandardLoss).toBeCloseTo(nonzero[0]?.costUsd ?? -1, 6);
    expect(totalStandardLoss).toBeCloseTo(signals[0]?.costUsd ?? -1, 6);
    expect(nonzero).toHaveLength(1);
    expect(nonzero[0]).toMatchObject({
      standardLossStatus: "computed",
      standardLossGrade: "unrecognized_standard_loss",
      evidenceGrade: "unrecognized_standard_loss",
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: nonzero[0]?.standardLossUsd,
      computationTrace: {
        method: "call_cost_floor_v1",
        basis: "failed_to_deliver_usable_output",
        grade: "unrecognized_standard_loss",
      },
    });
    expect(nonzero[0]?.computationTrace?.oneLine).toContain("full-call floor standard loss");
    expect(signals.every((signal) => signal.computationTrace)).toBe(true);
    expect(signals.filter((signal) =>
      signal.computationTrace?.method === "call_cost_floor_superseded_v1"
    )).toHaveLength(1);
    expect(signals.filter((signal) =>
      signal.evidenceGrade === "triage_only" && (signal.standardLossUsd ?? 0) > 0
    )).toEqual([]);
    expect(signals.filter((signal) =>
      signal.status === "triage_only" && (signal.standardLossUsd ?? 0) > 0
    )).toEqual([]);
  });

  it("standard-loss-floor-plus-delta: caps exact overcharge deltas inside one call-cost floor", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-floor-plus-delta",
    });
    const floor = lossSignal(event, {
      code: "BROKEN_OUTPUT",
      detector: "broken-output",
      failureClass: "broken_output",
    });
    const delta = lossSignal(event, {
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      detector: "billing-integrity",
      failureClass: "token_recount_mismatch",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      recoverableBasis: "overcharge_delta",
      providerRecoverableLossUsd: 0.000004,
      expectedChargeUsd: 0.000018,
      observedChargeUsd: 0.000022,
      valueJson: { overchargeUsd: 0.000004 },
    });

    const signals = applyStandardLossEconomicsToSignals(event, [floor, delta]);
    const floorSignal = signals.find((signal) => signal.code === "BROKEN_OUTPUT");
    const deltaSignal = signals.find((signal) => signal.code === "OPENAI_TOKEN_RECOUNT_MISMATCH");

    // Bill-bound: the same-call overcharge delta is inside the failed call's price, not on top of it.
    expect(standardLossTotal(signals)).toBeCloseTo(floor.costUsd, 6);
    expect(standardLossTotal(signals)).toBeLessThanOrEqual(floor.costUsd);
    expect(providerRecognizedTotal(signals)).toBeCloseTo(0.000004, 6);
    expect(recognitionGapTotal(signals)).toBeCloseTo(floor.costUsd - 0.000004, 6);
    expect(floorSignal?.standardLossUsd).toBeCloseTo(floor.costUsd - 0.000004, 6);
    expect(floorSignal?.recognitionGapUsd).toBeCloseTo(floor.costUsd - 0.000004, 6);
    expect(floorSignal?.computationTrace?.inputs).toMatchObject({
      billBoundedCap: {
        callExpectedChargeUsd: floor.costUsd,
        application: "ex_post_clamp",
      },
    });
    expect(floorSignal?.computationTrace?.oneLine).toContain("bill-bounded ex-post clamp applied");
    expect(deltaSignal).toMatchObject({
      standardLossUsd: 0.000004,
      providerRecognizedLossUsd: 0.000004,
      recognitionGapUsd: 0,
      computationTrace: {
        method: "measure_specific_delta_v1",
        basis: "token_overcharge_delta",
      },
    });
  });

  it("standard-loss-heuristic-only-whole-call-floor: explicit ineligible evidence is not dollarized", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-heuristic-only",
    });
    const [signal] = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "REFUSAL_BILLED",
        detector: "refusal",
        failureClass: "refusal",
        valueJson: {
          standardLossEligible: false,
          standardLossEligibility: "regex_only_triage",
        },
      }),
    ]);

    expect(signal).toMatchObject({
      code: "REFUSAL_BILLED",
      standardLossStatus: "not_applicable",
      standardLossMethod: "not_applicable_v1",
      standardLossGrade: "triage_only",
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
      computationTrace: {
        method: "not_applicable_v1",
        basis: "not_standard_loss",
      },
      valueJson: {
        standardLossEligible: false,
        standardLossEligibility: "regex_only_triage",
      },
    });
  });

  it("standard-loss-anthropic-recount-delta: absorbs provider-assisted grade-B recount delta into a failed-call floor", () => {
    const event = pricedEvent({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      requestId: "req-standard-anthropic-floor-plus-delta",
    });
    const floor = lossSignal(event, {
      code: "BROKEN_OUTPUT",
      detector: "broken-output",
      failureClass: "broken_output",
    });
    const delta = lossSignal(event, {
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      detector: "billing-integrity",
      failureClass: "anthropic_token_crosscheck",
      status: "candidate",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      recoverableBasis: "overcharge_delta",
      providerRecoverableLossUsd: 0,
      valueJson: {
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        standardLossUsd: 0.000125,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0.000125,
        methodMetadata: {
          evidenceGradeCap: "B",
          sourceRefs: {
            recountOracle: "https://platform.claude.com/docs/en/build-with-claude/token-counting",
          },
        },
      },
    });

    const signals = applyStandardLossEconomicsToSignals(event, [floor, delta]);
    const anthropic = signals.find((signal) => signal.code === "ANTHROPIC_TOKEN_CROSSCHECK");

    expect(standardLossTotal(signals)).toBeCloseTo(floor.costUsd, 6);
    expect(standardLossTotal(signals)).toBeLessThanOrEqual(floor.costUsd);
    expect(providerRecognizedTotal(signals)).toBeCloseTo(0, 6);
    expect(recognitionGapTotal(signals)).toBeCloseTo(floor.costUsd, 6);
    expect(anthropic).toMatchObject({
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
      evidenceGrade: "unrecognized_standard_loss",
      standardLossGrade: "unrecognized_standard_loss",
      computationTrace: {
        method: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        basis: "token_overcharge_delta",
        confidence: "computed_measure_delta",
        inputs: {
          methodMetadata: {
            evidenceGradeCap: "B",
          },
          billBoundedCap: {
            callExpectedChargeUsd: floor.costUsd,
          },
        },
      },
    });
  });

  it("standard-loss-delivered-token-crosscheck-without-delta: does not add a call-cost floor", () => {
    const event = pricedEvent({
      provider: "anthropic",
      model: "claude-sonnet-5-20260614",
      requestId: "req-standard-delivered-token-crosscheck",
      content: "complete answer",
    });

    const [signal] = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "ANTHROPIC_TOKEN_CROSSCHECK",
        detector: "billing-integrity",
        failureClass: "anthropic_token_crosscheck",
        status: "triage_only",
        evidenceGrade: "triage_only",
        providerRecoverableLossUsd: null,
      }),
    ]);

    expect(signal).toMatchObject({
      status: "triage_only",
      evidenceGrade: "triage_only",
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
      standardLossStatus: "not_applicable",
      computationTrace: {
        method: "not_applicable_v1",
        basis: "not_standard_loss",
      },
    });
  });

  it("standard-loss-cache-discount-at-risk: stacks a delivered-call at-risk delta without a call floor", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-cache-discount-at-risk",
      content: "usable cached answer",
      cacheRead: 20_000,
    });
    const [signal] = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "CACHE_DISCOUNT_AT_RISK",
        detector: "billing-integrity",
        failureClass: "cache_discount_at_risk",
        valueKind: "money",
        recoverableBasis: "overcharge_delta",
        providerRecoverableLossUsd: 0,
        expectedChargeUsd: 0.0015,
        valueJson: {
          cacheReadTokens: 20_000,
          fullInputRateUsdPerMillion: 0.15,
          cacheReadRateUsdPerMillion: 0.075,
          cacheDiscountAtRiskUsd: 0.0015,
          methodId: "cache_discount_at_risk_v1",
          methodMetadata: {
            methodId: "cache_discount_at_risk_v1",
            formula: "cache_read_tokens * (full_input_rate - cache_read_rate)",
            invoiceVerification: "verify_against_invoice",
          },
        },
      }),
    ]);

    expect(signal).toMatchObject({
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
      standardLossStatus: "computed",
      standardLossGrade: "triage_only",
      evidenceGrade: "triage_only",
      valueJson: {
        invoiceCheckExposureUsd: 0.0015,
        invoiceCheckExposureLabel: "invoice-check exposure",
        ledgerPlacement: "invoice_check_exposure_not_headline_money_loss",
      },
      computationTrace: {
        method: "cache_discount_at_risk_v1",
        basis: "cache_discount_at_risk",
        basisDetail: "cache_discount_at_risk_verify_invoice",
        formulas: {
          invoiceCheckExposureUsd:
            "cacheReadTokens * (fullInputRateUsdPerMillion - cacheReadRateUsdPerMillion) / 1000000",
          standardLossUsd: "0; invoice-check exposure is not headline standard-loss dollars",
          recognitionGapUsd: "0; invoice-check exposure is not recognition-gap dollars",
        },
        inputs: {
          invoiceCheckExposureUsd: 0.0015,
          invoiceCheckExposureLabel: "invoice-check exposure",
          ledgerPlacement: "invoice_check_exposure_not_headline_money_loss",
          methodMetadata: {
            invoiceVerification: "verify_against_invoice",
          },
        },
        outputs: {
          standardLossUsd: 0,
          recognitionGapUsd: 0,
          invoiceCheckExposureUsd: 0.0015,
          invoiceCheckExposureLabel: "invoice-check exposure",
          ledgerPlacement: "invoice_check_exposure_not_headline_money_loss",
        },
      },
    });
    expect(signal?.computationTrace?.oneLine).toContain(
      "cache discount at risk — verify your invoice: invoice-check exposure $0.001500; not standard-loss or recognition-gap dollars",
    );
    expect(signal?.standardLossUsd).not.toBeCloseTo(signal?.costUsd ?? -1, 6);
  });

  it("standard-loss-delivered-latency: uses time-excess dollars without adding call-cost floor", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-latency",
      content: "usable answer",
    });
    const [signal] = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "LATENCY_BILLED",
        detector: "latency",
        failureClass: "latency",
        valueKind: "time_loss",
      evidenceGrade: "unrecognized_standard_loss",
      providerRecoverableLossUsd: 0,
      recoverableBasis: null,
      valueJson: {
          timeLossMs: 90_000,
          timeLossMethodId: "latency_excess_v1",
          timeLossTrace: {
            methodId: "latency_excess_v1",
            outputs: {
              timeLossMs: 90_000,
              dollarTranslationUsd: 1.25,
            },
          },
          excessWaitMs: 90_000,
          standardLossUsd: 1.25,
          dollarTranslationUsd: 1.25,
          providerRecognizedLossUsd: 0,
          recognitionGapUsd: 1.25,
      },
      }),
    ]);

    expect(signal).toMatchObject({
      standardLossUsd: 1.25,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 1.25,
      standardLossGrade: "unrecognized_standard_loss",
      computationTrace: {
        method: "measure_specific_delta_v1",
        basis: "latency_time_excess",
        timeLossTrace: {
          methodId: "latency_excess_v1",
          outputs: {
            timeLossMs: 90_000,
            dollarTranslationUsd: 1.25,
          },
        },
      },
    });
    expect(signal?.valueJson.timeLossTrace).toMatchObject({
      methodId: "latency_excess_v1",
      outputs: {
        timeLossMs: 90_000,
        dollarTranslationUsd: 1.25,
      },
    });
    expect(signal?.standardLossUsd).not.toBeCloseTo(signal?.costUsd ?? -1, 6);
  });

  it("standard-loss-idempotent: preserves provider-recognized latency on re-enrichment", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-idempotent-latency",
      content: "usable answer",
    });
    const latency = lossSignal(event, {
      code: "LATENCY_BILLED",
      detector: "latency",
      failureClass: "latency",
      valueKind: "time_loss",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      providerRecoverableLossUsd: 0.000086,
      valueJson: {
        latencyMs: 31_000,
        sloMs: 30_000,
        excessWaitMs: 1_000,
      },
    });

    const [once] = applyStandardLossEconomicsToSignals(event, [latency]);
    const [twice] = applyStandardLossEconomicsToSignals(event, once ? [once] : []);

    expect(once).toMatchObject({
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      providerRecoverableLossUsd: 0.000086,
      standardLossUsd: 0.000086,
      providerRecognizedLossUsd: 0.000086,
      recognitionGapUsd: 0,
      standardLossStatus: "computed",
      computationTrace: {
        method: "measure_specific_delta_v1",
        basis: "latency_time_excess",
      },
    });
    expect(twice).toMatchObject({
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      providerRecoverableLossUsd: 0.000086,
      standardLossUsd: 0.000086,
      providerRecognizedLossUsd: 0.000086,
      recognitionGapUsd: 0,
      standardLossStatus: "computed",
      computationTrace: once?.computationTrace,
    });
  });

  it("standard-loss-pricing-unknown: is the only no-dollar state and carries an explicit trace", () => {
    const event = pricedEvent({
      provider: "openai",
      model: "missing-model-price",
      requestId: "req-standard-pricing-unknown",
    });
    const [signal] = applyStandardLossEconomicsToSignals(event, [
      lossSignal(event, {
        code: "BROKEN_OUTPUT",
        detector: "broken-output",
        failureClass: "broken_output",
      }),
    ]);

    expect(signal).toMatchObject({
      pricingStatus: "pricing_unknown",
      standardLossUsd: null,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: null,
      standardLossStatus: "pricing_unknown",
      computationTrace: {
        method: "pricing_unknown_v1",
        basis: "pricing_unknown_add_model_price",
      },
    });
  });

  it("time-loss-logical-operation-union: demotes covered retry-chain intervals from public totals", () => {
    const event = logicalOperationEvent(pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-retry-latency",
    }), {
      requestId: "req-standard-retry-latency",
      operationId: "op-standard-retry",
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:02:00.000Z",
      latencyMs: 120_000,
    });
    const retryEvent = logicalOperationEvent(pricedEvent({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-standard-retry-attempt",
    }), {
      requestId: "req-standard-retry-attempt",
      operationId: "op-standard-retry",
      startedAt: "2026-06-14T12:00:30.000Z",
      endedAt: "2026-06-14T12:01:30.000Z",
      latencyMs: 60_000,
    });
    const latency = lossSignal(event, {
      code: "LATENCY_BILLED",
      detector: "latency",
      failureClass: "latency",
      valueKind: "time_loss",
      evidenceGrade: "unrecognized_standard_loss",
      valueJson: {
        timeLossMs: 120_000,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 120_000,
        dollarTranslationUsd: 2,
        timeLossPrimary: true,
      },
    });
    const retry: PublicTimeLossSignal = {
      code: "RETRY_AMPLIFICATION_CHAIN",
      failureClass: "retry_amplification",
      valueKind: "time_loss",
      valueJson: {
        timeLossMs: 60_000,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 60_000,
        dollarTranslationUsd: 1,
        chainStartAt: "2026-06-14T12:00:30.000Z",
        chainEndAt: "2026-06-14T12:01:30.000Z",
      },
      evidence: {
        reason: "retry_chain_attempt_diagnostic",
      },
    };

    const totals = publicTimeLossTotalsForSignals([
      { event, signal: latency },
      { event: retryEvent, signal: retry },
    ]);

    expect(totals.rawTimeLossMs).toBe(180_000);
    expect(totals.timeLossMs).toBe(120_000);
    expect(totals.recognitionGapTimeMs).toBe(120_000);
    expect(totals.dollarTranslationUsd).toBe(2);
    expect(totals.intervals.find((interval) =>
      interval.signalCode === "RETRY_AMPLIFICATION_CHAIN"
    )).toMatchObject({
      rawTimeLossMs: 60_000,
      publicTimeLossMs: 0,
      demoted: true,
      demotionReason: "logical_operation_interval_already_counted",
    });
  });
});

function pricedEvent(input: {
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly model: string;
  readonly requestId: string;
  readonly content?: string;
  readonly cacheRead?: number;
}): CanonicalEventV1 {
  return buildCanonicalEvent({
    request: {
      tenantId: "tenant-standard-loss",
      provider: input.provider,
      model: input.model,
      requestId: input.requestId,
    },
    response: {
      content: input.content ?? "",
    },
    usage: {
      input: 100,
      output: 5,
      cache: { read: input.cacheRead ?? 0, creation: 0 },
    },
  });
}

function logicalOperationEvent(
  event: CanonicalEventV1,
  input: {
    readonly requestId: string;
    readonly operationId: string;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly latencyMs: number;
  },
): PublicTimeLossEvent {
  return {
    ...event,
    request: {
      ...event.request,
      requestId: input.requestId,
      operationId: input.operationId,
    },
    timing: {
      ...event.timing,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      latencyMs: input.latencyMs,
      providerRequestStartedAt: input.startedAt,
      providerResponseEndedAt: input.endedAt,
      providerElapsedMs: input.latencyMs,
    },
  };
}

function lossSignal(
  event: CanonicalEventV1,
    input: {
      readonly code: LossSignal["code"];
      readonly detector: LossSignal["detector"];
      readonly failureClass: string;
      readonly status?: LossSignal["status"];
      readonly valueKind?: LossSignal["valueKind"];
      readonly evidenceGrade?: LossSignal["evidenceGrade"];
    readonly creditCandidate?: boolean;
    readonly recoverableBasis?: LossSignal["recoverableBasis"];
    readonly providerRecoverableLossUsd?: number | null;
    readonly observedChargeUsd?: number | null;
    readonly expectedChargeUsd?: number | null;
    readonly valueJson?: Record<string, unknown>;
  },
): LossSignal {
  return buildLossSignal({
    code: input.code,
    detector: input.detector,
    event,
    failureClass: input.failureClass,
    status: input.status,
    evidenceGrade: input.evidenceGrade ?? "triage_only",
    creditCandidate: input.creditCandidate ?? false,
    valueKind: input.valueKind,
    recoverableBasis: input.recoverableBasis,
    providerRecoverableLossUsd: input.providerRecoverableLossUsd,
    observedChargeUsd: input.observedChargeUsd,
    expectedChargeUsd: input.expectedChargeUsd,
    valueJson: input.valueJson,
    evidence: {
      testId: "standard-loss-economics",
      code: input.code,
    },
  });
}

function standardLossTotal(signals: readonly LossSignal[]): number {
  return sum(signals.map((signal) => signal.standardLossUsd ?? 0));
}

function providerRecognizedTotal(signals: readonly LossSignal[]): number {
  return sum(signals.map((signal) => signal.providerRecognizedLossUsd ?? 0));
}

function recognitionGapTotal(signals: readonly LossSignal[]): number {
  return sum(signals.map((signal) => signal.recognitionGapUsd ?? 0));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
