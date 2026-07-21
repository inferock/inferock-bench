import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  classifyNoSloLatencyImpact,
  defaultLatencySloPolicyForEvent,
  detectLatencyBilled,
  recomputeLatencyTimeLoss,
  latencyPercentileBucket,
  latencyReasoningSegmentForUsageCategories,
  outputBearingCallMeetsTpsFloor,
  type LatencySloPolicy,
} from "./latency.js";
import { evaluateDefaultLatency, SLA_DEFAULTS } from "./sla-defaults.js";

describe("latency detector", () => {
  it("latency-no-slo-no-signal: does not emit from the legacy global threshold without an SLO", () => {
    expect(detectLatencyBilled(slowPricedEvent())).toBeNull();
  });

  it("latency-slo-breach-priced: emits a time-loss refundable candidate for a priced disclosed SLO breach", () => {
    const signal = detectLatencyBilled(slowPricedEvent(), {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    });

    expect(signal).toMatchObject({
      code: "LATENCY_BILLED",
      detector: "latency",
      failureClass: "latency",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      valueKind: "time_loss",
      recoverableBasis: null,
      pricingStatus: "priced",
      evidence: {
        latencyMs: 31_000,
        providerElapsedMs: 31_000,
        timingAttribution: "provider_elapsed",
        sloMs: 30_000,
        excessWaitMs: 1_000,
        timeLossMs: 1_000,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 1_000,
        dollarTranslationUsd: expect.any(Number),
        sloSource: "provider-slo://openai/chat-completions",
        sloVersion: "slo-v1",
        sloDisclosedAt: "2026-01-01T00:00:00.000Z",
        sloEffectiveFrom: "2026-01-01T00:00:00.000Z",
        route: "chat.completions",
        workloadClass: "interactive",
        coldStartExcluded: false,
      },
      valueJson: {
        latencyMs: 31_000,
        providerElapsedMs: 31_000,
        timingAttribution: "provider_elapsed",
        sloMs: 30_000,
        excessWaitMs: 1_000,
        timeLossPrimary: true,
        timeLossKind: "latency_excess",
        timeLossMethodId: "latency_excess_v1",
        timeLossMs: 1_000,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 1_000,
        dollarTranslationUsd: expect.any(Number),
        thresholdProposalId: "00000000-0000-4000-8000-000000000901",
        thresholdConfirmed: true,
        acceptableStartMs: 30_000,
        acceptableMsPerOutputToken: 0,
        providerRecognizedCreditUsd: expect.any(Number),
        timeLossTrace: {
          methodId: "latency_excess_v1",
          inputs: {
            observedProviderElapsedMs: 31_000,
            timingAttribution: "provider_elapsed",
          },
          outputs: {
            timeLossMs: 1_000,
            providerRecognizedTimeLossMs: 0,
            recognitionGapTimeMs: 1_000,
          },
        },
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
    expect(signal?.valueJson.dollarTranslationUsd).toBeCloseTo(0.025556, 6);
  });

  it("latency-disclosed-slo-uses-provider-elapsed-not-gateway-delay: ignores non-provider delay for provider-recognized candidates", () => {
    const signal = detectLatencyBilled(slowPricedEvent({
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        providerRequestStartedAt: "2026-06-14T12:00:30.000Z",
        providerResponseEndedAt: "2026-06-14T12:00:31.000Z",
        endedAt: "2026-06-14T12:00:31.000Z",
        latencyMs: 31_000,
        providerElapsedMs: 1_000,
        gatewayOverheadMs: 30_000,
      },
    }), {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    });

    expect(signal).toBeNull();
  });

  it("latency-disclosed-slo-missing-provider-elapsed-no-signal: does not fall back to gateway total latency", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
        route: "chat.completions",
        workloadClass: "interactive",
      },
      usage: {
        input: 100,
        output: 10,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:00:31.000Z",
        latencyMs: 31_000,
      },
    });

    expect(detectLatencyBilled(event, {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    })).toBeNull();
  });

  it("latency-below-slo-no-signal: does not emit when latency is within policy", () => {
    expect(detectLatencyBilled(slowPricedEvent(), {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 35_000 }),
    })).toBeNull();
  });

  it("latency-unbilled-no-signal: does not flag unbilled slow calls", () => {
    const event = buildCanonicalEvent({
      usage: {
        input: 0,
        output: 0,
        cache: { read: 0, creation: 0 },
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:00.000Z",
        latencyMs: 60_000,
      },
    });

    expect(detectLatencyBilled(event, {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    })).toBeNull();
  });

  it("latency-downtime-no-signal: defers to downtime", () => {
    const event = buildCanonicalEvent({
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "overloaded",
        errorClass: "http_503:overloaded_error",
      },
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:00.000Z",
        latencyMs: 60_000,
      },
    });

    expect(detectLatencyBilled(event, {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    })).toBeNull();
  });

  it("latency-not-suppressed-by-success-content: emits SLO signal when successful answer text mentions capacity terms", () => {
    const signal = detectLatencyBilled(slowPricedEvent({
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "For request timeout and overloaded capacity planning, use exponential backoff.",
      },
    }), {
      latencySloPolicy: latencySloPolicy({ totalSloMs: 30_000 }),
    });

    expect(signal).toMatchObject({
      code: "LATENCY_BILLED",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      valueKind: "time_loss",
      recoverableBasis: null,
      evidence: {
        latencyMs: 31_000,
        sloMs: 30_000,
        excessWaitMs: 1_000,
      },
    });
  });

  it("latency-slo-without-credit-basis-triage: emits triage-only time loss without candidate dollars", () => {
    const signal = detectLatencyBilled(slowPricedEvent(), {
      latencySloPolicy: latencySloPolicy({
        totalSloMs: 30_000,
        creditBasis: null,
      }),
    });

    expect(signal).toMatchObject({
      code: "LATENCY_BILLED",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      valueKind: "time_loss",
      recoverableBasis: null,
      providerRecoverableLossUsd: null,
    });
  });

  it("latency-slo-unknown-pricing-triage: emits triage-only time loss for unknown pricing", () => {
    const signal = detectLatencyBilled(slowPricedEvent({
      request: {
        provider: "openai",
        model: "unknown-model",
      },
    }), {
      latencySloPolicy: latencySloPolicy({
        model: "unknown-model",
        totalSloMs: 30_000,
      }),
    });

    expect(signal).toMatchObject({
      code: "LATENCY_BILLED",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      pricingStatus: "pricing_unknown",
      providerRecoverableLossUsd: null,
    });
  });

  it("latency-default-standard-loss: emits unrecognized standard loss with excess-only computation trace", () => {
    const event = slowPricedEvent({
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
        providerResponseEndedAt: "2026-06-14T12:01:27.700Z",
        endedAt: "2026-06-14T12:02:00.000Z",
        latencyMs: 120_000,
        providerElapsedMs: 87_700,
        gatewayOverheadMs: 32_300,
      },
    });
    const signal = detectLatencyBilled(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    });

    expect(signal).toMatchObject({
      code: "LATENCY_BILLED",
      status: "candidate",
      evidenceGrade: "unrecognized_standard_loss",
      creditCandidate: false,
      valueKind: "time_loss",
      providerRecoverableLossUsd: 0,
      valueJson: {
        latencyMs: 87_700,
        timingAttribution: "provider_elapsed",
        timingClockLabel: "provider-clock",
        providerElapsedMs: 87_700,
        gatewayTotalMs: 120_000,
        gatewayElapsedMs: 120_000,
        gatewayOverheadMs: 32_300,
        providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
        sloMs: 10_000,
        excessWaitMs: 77_700,
        providerRecognizedLossUsd: 0,
      },
      evidence: {
        timingAttribution: "provider_elapsed",
        timingClockLabel: "provider-clock",
        providerElapsedMs: 87_700,
        gatewayTotalMs: 120_000,
        gatewayElapsedMs: 120_000,
        gatewayOverheadMs: 32_300,
        providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
        activeLatencySegment: {
          segmentId: "interactive_streaming_non_reasoning",
        },
        timeValueRate: {
          usdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
          label: SLA_DEFAULTS.timeValueRate.label,
        },
        computationTrace: {
          methodId: "latency_excess_v1",
          methodVersion: "2026-07-20",
          inputs: {
            observedDefaultLatencyMs: 87_700,
            timingAttribution: "provider_elapsed",
            timingClockLabel: "provider-clock",
            gatewayTotalMs: 120_000,
            gatewayElapsedMs: 120_000,
            providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
            acceptableTotalMs: 10_000,
            rateUsdPerHour: 92,
          },
          intermediateSteps: {
            excessMs: 77_700,
            standardLossFormula: "77700 * 92 / 3600000",
          },
          outputs: {
            providerRecognizedLossUsd: 0,
          },
        },
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBe(0);
    expect(signal?.valueJson.standardLossUsd).toBeCloseTo(1.985667, 6);
    expect(signal?.valueJson.recognitionGapUsd).toBeCloseTo(1.985667, 6);
  });

  it("latency-default-provider-clean: does not count gateway overhead as provider default latency", () => {
    const event = slowPricedEvent({
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        providerRequestStartedAt: "2026-06-14T12:01:51.000Z",
        providerResponseEndedAt: "2026-06-14T12:02:00.000Z",
        endedAt: "2026-06-14T12:02:00.000Z",
        latencyMs: 120_000,
        providerElapsedMs: 9_000,
        gatewayOverheadMs: 111_000,
      },
    });

    const evaluation = evaluateDefaultLatency(event);
    expect(evaluation.observed).toMatchObject({
      totalMs: 9_000,
      timingAttribution: "provider_elapsed",
      clockLabel: "provider-clock",
      providerElapsedMs: 9_000,
      gatewayTotalMs: 120_000,
      gatewayOverheadMs: 111_000,
      nonProviderDiagnosticSegments: [{
        segmentId: "gateway_overhead",
        elapsedMs: 111_000,
        providerAttributed: false,
      }],
    });
    expect(evaluation.excessMs).toBe(0);
    expect(detectLatencyBilled(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    })).toBeNull();
  });

  it("latency-time-loss-primitive: persists time as primary and dollars as secondary translation", () => {
    const event = slowPricedEvent({
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:27.700Z",
        latencyMs: 87_700,
        providerElapsedMs: 87_700,
        gatewayOverheadMs: 0,
      },
    });
    const signal = detectLatencyBilled(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    });

    expect(signal).toMatchObject({
      valueKind: "time_loss",
      valueJson: {
        timeLossPrimary: true,
        timeLossKind: "latency_excess",
        timeLossMethodId: "latency_excess_v1",
        timeLossMs: 77_700,
        timeLossSeconds: 77.7,
        observedMs: 87_700,
        timingAttribution: "provider_elapsed",
        timingClockLabel: "provider-clock",
        providerElapsedMs: 87_700,
        gatewayElapsedMs: 87_700,
        acceptableMs: 10_000,
        excessMs: 77_700,
        thresholdProposalId: "inferock-default:interactive_streaming_non_reasoning",
        thresholdSourceLabel: "Inferock provisional default (pending external calibration)",
        thresholdConfirmed: false,
        dollarTranslationUsd: expect.any(Number),
        dollarTranslationRateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
        dollarTranslationConfirmed: false,
        providerRecognizedTimeLossMs: 0,
        providerRecognizedCreditUsd: null,
        recognitionGapTimeMs: 77_700,
        providerRecognitionLine:
          "Estimated recoverable (our arithmetic): no configured provider latency credit basis for this receipt",
        timeLossTrace: {
          methodId: "latency_excess_v1",
          outputs: {
            timeLossMs: 77_700,
            dollarTranslationUsd: expect.any(Number),
          },
        },
      },
    });
    expect(signal?.valueJson.dollarTranslationUsd).toBeCloseTo(1.985667, 6);
  });

  it("latency-default-uses-provider-clock-when-provider-elapsed-exists", () => {
    const event = slowPricedEvent({
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:30.000Z",
        latencyMs: 90_000,
        providerRequestStartedAt: "2026-06-14T12:00:30.000Z",
        providerResponseEndedAt: "2026-06-14T12:00:50.000Z",
        providerElapsedMs: 20_000,
      },
    });
    const signal = detectLatencyBilled(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    });

    expect(signal).toMatchObject({
      valueJson: {
        timeLossMs: 10_000,
        observedMs: 20_000,
        gatewayElapsedMs: 90_000,
        providerElapsedMs: 20_000,
        timingAttribution: "provider_elapsed",
        timingClockLabel: "provider-clock",
        providerRequestStartedAt: "2026-06-14T12:00:30.000Z",
      },
      evidence: {
        timingAttribution: "provider_elapsed",
        timingClockLabel: "provider-clock",
        observedLatency: {
          totalMs: 20_000,
          clockLabel: "provider-clock",
        },
      },
    });
    expect(signal?.valueJson.dollarTranslationUsd).toBeCloseTo(0.255556, 6);
  });

  it("latency-default-provider-clock-below-threshold-suppresses-gateway-delay", () => {
    const event = slowPricedEvent({
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:30.000Z",
        latencyMs: 90_000,
        providerRequestStartedAt: "2026-06-14T12:00:30.000Z",
        providerResponseEndedAt: "2026-06-14T12:00:35.000Z",
        providerElapsedMs: 5_000,
      },
    });

    expect(detectLatencyBilled(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    })).toBeNull();
  });

  it("latency-threshold-edit-reprices-time-and-dollar-translation-while-rate-only-reprices-dollar", () => {
    const base = recomputeLatencyTimeLoss({
      observedMs: 120_000,
      outputTokens: 0,
      acceptableStartMs: 10_000,
      acceptableMsPerOutputToken: 23,
      rateUsdPerHour: 92,
    });
    const thresholdEdited = recomputeLatencyTimeLoss({
      observedMs: 120_000,
      outputTokens: 0,
      acceptableStartMs: 90_000,
      acceptableMsPerOutputToken: 23,
      rateUsdPerHour: 92,
    });
    const rateEdited = recomputeLatencyTimeLoss({
      observedMs: 120_000,
      outputTokens: 0,
      acceptableStartMs: 10_000,
      acceptableMsPerOutputToken: 23,
      rateUsdPerHour: 184,
    });

    expect(base).toMatchObject({
      acceptableTotalMs: 10_000,
      timeLossMs: 110_000,
      dollarTranslationUsd: expect.any(Number),
    });
    expect(thresholdEdited.timeLossMs).toBe(30_000);
    expect(thresholdEdited.dollarTranslationUsd).toBeLessThan(base.dollarTranslationUsd);
    expect(rateEdited.timeLossMs).toBe(base.timeLossMs);
    expect(rateEdited.dollarTranslationUsd).toBeCloseTo(base.dollarTranslationUsd * 2, 6);
  });

  it("latency-threshold-edit-zero-floor: below and equal thresholds produce zero time and dollar translation", () => {
    const equal = recomputeLatencyTimeLoss({
      observedMs: 30_000,
      outputTokens: 0,
      acceptableStartMs: 30_000,
      acceptableMsPerOutputToken: 0,
      rateUsdPerHour: 92,
    });
    const below = recomputeLatencyTimeLoss({
      observedMs: 29_999,
      outputTokens: 0,
      acceptableStartMs: 30_000,
      acceptableMsPerOutputToken: 0,
      rateUsdPerHour: 92,
    });

    expect(equal).toEqual({
      acceptableTotalMs: 30_000,
      timeLossMs: 0,
      dollarTranslationUsd: 0,
    });
    expect(below).toEqual({
      acceptableTotalMs: 30_000,
      timeLossMs: 0,
      dollarTranslationUsd: 0,
    });
  });

  it("latency-default-segments: selects signed-off reasoning and batch defaults", () => {
    const reasoning = evaluateDefaultLatency(slowPricedEvent({
      request: {
        model: "o3",
        generation: {
          reasoningEffort: "high",
        },
      },
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        latencyMs: 499_999,
        providerElapsedMs: 499_999,
      },
    }));
    const batch = evaluateDefaultLatency(slowPricedEvent({
      request: {
        workloadClass: "batch",
      },
      usage: {
        input: 100,
        output: 0,
      },
      timing: {
        latencyMs: 3_600_001,
        providerElapsedMs: 3_600_001,
      },
    }));

    expect(reasoning.segment.segmentId).toBe("interactive_streaming_reasoning");
    expect(reasoning.acceptableTotalMs).toBe(500_000);
    expect(reasoning.excessMs).toBe(0);
    expect(batch.segment.segmentId).toBe("batch_non_reasoning");
    expect(batch.acceptableTotalMs).toBe(3_600_000);
    expect(batch.excessMs).toBe(1);
  });

  it("latency-standard-bucket-assignment: assigns stable percentile-of-own-traffic buckets", () => {
    expect(latencyPercentileBucket(0.50)).toBe("p50_or_below");
    expect(latencyPercentileBucket(0.51)).toBe("p50_p75");
    expect(latencyPercentileBucket(0.76)).toBe("p75_p90");
    expect(latencyPercentileBucket(0.91)).toBe("p90_p95");
    expect(latencyPercentileBucket(0.96)).toBe("p95_p99");
    expect(latencyPercentileBucket(1)).toBe("p99_plus");
  });

  it("latency-standard-tps-floor: output-bearing calls above the TPS floor are not impact eligible", () => {
    expect(outputBearingCallMeetsTpsFloor({
      latencyMs: 60_000,
      outputTokens: 600,
      minimumOutputTokensPerSecond: 5,
    })).toBe(true);
    expect(outputBearingCallMeetsTpsFloor({
      latencyMs: 60_000,
      outputTokens: 10,
      minimumOutputTokensPerSecond: 5,
    })).toBe(false);

    const rows = classifyNoSloLatencyImpact([
      latencySample("tenant-a", "req-a-fast-1", 100, 1),
      latencySample("tenant-a", "req-a-fast-2", 200, 1),
      latencySample("tenant-a", "req-a-slow-good-throughput", 60_000, 600),
    ], {
      minimumOutputTokensPerSecond: 5,
      impactBuckets: ["p99_plus"],
    });

    expect(rows.find((row) => row.requestId === "req-a-slow-good-throughput"))
      .toMatchObject({
        bucket: "p99_plus",
        outputTokensPerSecond: 10,
        impactEligible: false,
      });
  });

  it("latency-standard-reasoning-segmentation: uses captured usage categories, never output text", () => {
    expect(latencyReasoningSegmentForUsageCategories([
      { category: "reasoning", tokens: 8 },
    ])).toBe("reasoning");
    expect(latencyReasoningSegmentForUsageCategories([
      { category: "output", tokens: 8, sourceField: "assistant_text_mentions_reasoning" },
    ])).toBe("non_reasoning");
  });

  it("latency-standard-tenant-owned-buckets: does not mix tenant distributions", () => {
    const rows = classifyNoSloLatencyImpact([
      latencySample("tenant-a", "req-a-1", 100, 1),
      latencySample("tenant-a", "req-a-2", 200, 1),
      latencySample("tenant-a", "req-a-3", 300, 1),
      latencySample("tenant-b", "req-b-1", 10_000, 1),
      latencySample("tenant-b", "req-b-2", 20_000, 1),
      latencySample("tenant-b", "req-b-3", 30_000, 1),
    ]);

    expect(rows.find((row) => row.requestId === "req-a-3")).toMatchObject({
      tenantId: "tenant-a",
      bucket: "p99_plus",
      reasoningSegment: "non_reasoning",
    });
    expect(rows.find((row) => row.requestId === "req-b-1")).toMatchObject({
      tenantId: "tenant-b",
      bucket: "p50_or_below",
    });
  });
});

type EventOverrides = Parameters<typeof buildCanonicalEvent>[0];

function slowPricedEvent(overrides: EventOverrides = {}) {
  return buildCanonicalEvent({
    request: {
      provider: "openai",
      model: "gpt-4o-mini",
      route: "chat.completions",
      workloadClass: "interactive",
      ...overrides.request,
    },
    usage: {
      input: 100,
      output: 10,
      ...overrides.usage,
    },
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:00:31.000Z",
      latencyMs: 31_000,
      providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
      providerResponseEndedAt: "2026-06-14T12:00:31.000Z",
      providerElapsedMs: 31_000,
      gatewayOverheadMs: 0,
      ...overrides.timing,
    },
    response: {
      ...overrides.response,
    },
    meta: {
      ...overrides.meta,
    },
  });
}

function latencySloPolicy(
  overrides: Partial<LatencySloPolicy> = {},
): LatencySloPolicy {
  return {
    policyId: "00000000-0000-4000-8000-000000000901",
    tenantId: "tenant-test",
    provider: "openai",
    model: "gpt-4o-mini",
    route: "chat.completions",
    workloadClass: "interactive",
    totalSloMs: 30_000,
    sloSource: "provider-slo://openai/chat-completions",
    sloVersion: "slo-v1",
    disclosedAt: "2026-01-01T00:00:00.000Z",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    creditBasis: "billed_wait",
    ...overrides,
  };
}

function latencySample(
  tenantId: string,
  requestId: string,
  latencyMs: number,
  outputTokens: number,
) {
  return {
    tenantId,
    requestId,
    provider: "openai" as const,
    model: "gpt-4o-mini",
    route: "chat.completions",
    workloadClass: "interactive",
    latencyMs,
    outputTokens,
    usageCategories: [{ category: "output", tokens: outputTokens }],
  };
}
