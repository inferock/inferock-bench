import { describe, expect, it } from "vitest";
import type { CanonicalEventV1 } from "./canonical-event.js";
import {
  buildRetryAmplificationChainSignal,
  providerFaultStatusForRetryDollarization,
  runRetryAmplificationDetectors,
} from "./retry-amplification.js";

describe("retry amplification provider-fault classification", () => {
  it("retry-amplification-gemini-quota-default: keeps RESOURCE_EXHAUSTED quota out of provider-fault dollarization", () => {
    const event = geminiEvent({
      statusCode: 429,
      errorClass: "http_429:resource_exhausted",
      rawErrorType: "RESOURCE_EXHAUSTED",
      rawErrorCode: "429",
      content: "Quota exceeded for Gemini API.",
    });

    expect(providerFaultStatusForRetryDollarization(event)).toBeNull();
  });

  it("retry-amplification-gemini-capacity-evidence: requires provider-capacity evidence for Gemini 429 and 504", () => {
    const capacity429 = geminiEvent({
      statusCode: 429,
      errorClass: "http_429:provider_capacity",
      rawErrorType: "RESOURCE_EXHAUSTED",
      content: "Provider capacity exhausted.",
    });
    const ambiguous504 = geminiEvent({
      statusCode: 504,
      errorClass: "http_504:deadline_exceeded",
      rawErrorType: "DEADLINE_EXCEEDED",
      content: "Deadline exceeded.",
    });
    const provider504 = geminiEvent({
      statusCode: 504,
      errorClass: "http_504:unavailable",
      rawErrorType: "UNAVAILABLE",
      content: "Service unavailable.",
    });

    expect(providerFaultStatusForRetryDollarization(capacity429)).toEqual({
      providerFault: true,
      status: 429,
      reason: "gemini_provider_capacity_429",
    });
    expect(providerFaultStatusForRetryDollarization(ambiguous504)).toBeNull();
    expect(providerFaultStatusForRetryDollarization(provider504)).toEqual({
      providerFault: true,
      status: 504,
      reason: "gemini_provider_timeout_504",
    });
  });

  it("retry-amplification-availability-classifier: refuses generic 429 and unreceipted 5xx dollarization", () => {
    expect(providerFaultStatusForRetryDollarization(openAiEvent({
      statusCode: 429,
      errorClass: "http_429:rate_limit_exceeded",
      content: "Rate limit exceeded.",
    }))).toBeNull();

    expect(providerFaultStatusForRetryDollarization(openAiEvent({
      statusCode: 503,
      errorClass: "http_503:unavailable",
      content: "Service unavailable.",
    }))).toBeNull();

    expect(providerFaultStatusForRetryDollarization(openAiEvent({
      statusCode: 500,
      errorClass: "http_500:server_error",
      content: "server_error",
      providerRequestId: "req-provider-fault",
    }))).toEqual({
      providerFault: true,
      status: 500,
      reason: "provider_status_5xx",
    });
  });

  it("retry-amplification-gemini-tenant-quota-chain: emits no retry standard-loss dollars without provider fault", () => {
    const event = geminiEvent({
      statusCode: 429,
      errorClass: "http_429:resource_exhausted",
      rawErrorType: "RESOURCE_EXHAUSTED",
      rawErrorCode: "429",
      content: "Quota exceeded for Gemini API.",
    });
    const signal = buildRetryAmplificationChainSignal(event, {
      linkageTier: "stainless_retry_count",
      chainSize: 2,
      inducedEventCount: 1,
      inducedRank: 1,
      originalEventId: "evt-original",
      originalEventTime: "2026-07-06T12:00:00.000Z",
      originalRequestId: "req-original",
      inducedEventId: "evt-extra",
      inducedEventTime: "2026-07-06T12:00:01.000Z",
      chainStartAt: "2026-07-06T12:00:00.000Z",
      chainEndAt: "2026-07-06T12:00:02.000Z",
      chainEventIds: ["evt-extra", "evt-final"],
      chainRequestIds: ["req-extra", "req-final"],
      listPriceInducedSpendUsd: 0.01,
      listPricePricingStatus: "priced",
      providerDirected: false,
      providerDirectedReasons: [],
      extraAttemptEventCount: 1,
      extraAttemptSpendUsd: 0.01,
      providerFaultExtraAttemptSpendUsd: null,
      finalEventId: "evt-final",
      finalEventTime: "2026-07-06T12:00:02.000Z",
      finalRequestId: "req-final",
    });

    expect(signal.standardLossUsd).toBeNull();
    expect(signal.valueJson.standardLossUsd).toBeUndefined();
    expect(signal.valueJson.providerFaultStatus).toBeNull();
    expect(signal.valueJson.extraAttemptSpendUsd).toBe(0.01);
  });

  it("retry-amplification-gemini-transport-timeout: treats transport-only timeout as ambiguous", () => {
    const event = geminiEvent({
      statusCode: 502,
      errorClass: "transport:TimeoutError",
      content: "Provider request failed before a response was received.",
    });

    expect(providerFaultStatusForRetryDollarization(event)).toBeNull();
  });

  it("retry-amplification-local-origin-denominator: ignores local synthetic retry evidence", () => {
    const event = localOriginRetryEvent() as unknown as CanonicalEventV1;

    expect(providerFaultStatusForRetryDollarization(event)).toBeNull();
    expect(runRetryAmplificationDetectors(event)).toEqual([]);
  });
});

function openAiEvent(input: {
  readonly statusCode: number;
  readonly errorClass: string;
  readonly content?: string;
  readonly providerRequestId?: string;
}): CanonicalEventV1 & {
  readonly response: CanonicalEventV1["response"] & {
    readonly errorClass: string;
    readonly providerRequestId?: string;
  };
} {
  return {
    request: {
      tenantId: "tenant-retry",
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-retry",
      expectCompletion: true,
    },
    response: {
      statusCode: input.statusCode,
      finishReason: "error",
      content: input.content ?? "",
      errorClass: input.errorClass,
      ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    },
    usage: {
      input: 0,
      output: 0,
    },
    timing: {
      startedAt: "2026-07-06T12:00:00.000Z",
      endedAt: "2026-07-06T12:00:01.000Z",
      latencyMs: 1_000,
    },
    meta: {
      attemptIndex: 0,
      schemaVersion: "v1",
    },
  };
}

function geminiEvent(input: {
  readonly statusCode: number;
  readonly errorClass: string;
  readonly rawErrorType?: string;
  readonly rawErrorCode?: string;
  readonly content?: string;
}): CanonicalEventV1 & {
  readonly response: CanonicalEventV1["response"] & {
    readonly errorClass: string;
    readonly rawErrorType?: string;
    readonly rawErrorCode?: string;
  };
} {
  return {
    request: {
      tenantId: "tenant-retry",
      provider: "gemini",
      model: "gemini-2.5-flash",
      requestId: "req-retry",
      expectCompletion: true,
    },
    response: {
      statusCode: input.statusCode,
      finishReason: "error",
      content: input.content ?? "",
      errorClass: input.errorClass,
      ...(input.rawErrorType ? { rawErrorType: input.rawErrorType } : {}),
      ...(input.rawErrorCode ? { rawErrorCode: input.rawErrorCode } : {}),
    },
    usage: {
      input: 0,
      output: 0,
    },
    timing: {
      startedAt: "2026-07-06T12:00:00.000Z",
      endedAt: "2026-07-06T12:00:01.000Z",
      latencyMs: 1_000,
    },
    meta: {
      attemptIndex: 0,
      schemaVersion: "v1",
    },
  };
}

function localOriginRetryEvent() {
  return {
    schemaVersion: "v2",
    request: {
      tenantId: "tenant-retry",
      provider: "openai",
      requestId: "req-local-retry",
      requestedModel: "gpt-4o-mini",
      model: "gpt-4o-mini",
      attemptIndex: 1,
      expectCompletion: true,
    },
    response: {
      statusCode: 429,
      finishReason: "error",
      content: "Agent call budget exhausted before provider dispatch.",
      servedModel: "gpt-4o-mini",
      errorClass: "http_429:agent_call_budget_exhausted",
      errorOrigin: "local",
    },
    usage: {
      input: 0,
      output: 0,
      usageSource: "missing",
      categories: [],
    },
    timing: {
      startedAt: "2026-07-06T12:00:00.000Z",
      endedAt: "2026-07-06T12:00:01.000Z",
      latencyMs: 1_000,
      chunkCount: 0,
      terminalStatus: "error",
    },
    attempts: [
      {
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-4o-mini",
        status: "retry",
        timing: {
          startedAt: "2026-07-06T12:00:00.000Z",
          endedAt: "2026-07-06T12:00:00.500Z",
          latencyMs: 500,
        },
        retryReason: "local_budget_probe",
        statusCode: 429,
        errorOrigin: "local",
        finalSelected: false,
      },
      {
        attemptNumber: 1,
        provider: "openai",
        model: "gpt-4o-mini",
        status: "error",
        timing: {
          startedAt: "2026-07-06T12:00:00.500Z",
          endedAt: "2026-07-06T12:00:01.000Z",
          latencyMs: 500,
        },
        errorClass: "http_429:agent_call_budget_exhausted",
        statusCode: 429,
        errorOrigin: "local",
        finalSelected: true,
      },
    ],
  };
}
