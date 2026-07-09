import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeCanonicalEvent,
  type CanonicalEventV2,
} from "./canonical-event.js";
import { detectServedModelMismatch } from "./model-identity.js";
import {
  clearModelPricing,
  registerDefaultModelPricing,
} from "./pricing.js";
import { runStatelessDetectors } from "./stateless.js";

afterEach(() => {
  clearModelPricing();
  registerDefaultModelPricing();
});

describe("served model mismatch detection", () => {
  it("served-model-mismatch-triage-only: emits identity triage with provider-response provenance", () => {
    const event = normalizeCanonicalEvent(v2Event({
      request: {
        requestedModel: "gpt-5.4",
        model: "gpt-5.4",
      },
      response: {
        servedModel: "gpt-5.4-mini",
        servedModelSource: "provider_response",
      },
    }));

    const signal = detectServedModelMismatch(event);

    expect(signal).toMatchObject({
      code: "SERVED_MODEL_MISMATCH",
      detector: "model-identity",
      domain: "usage",
      failureClass: "served_model_mismatch",
      status: "triage_only",
      evidenceGrade: "triage_only",
      liabilityParty: "unknown",
      creditCandidate: false,
      valueKind: "triage",
      recoverableBasis: null,
      providerRecoverableLossUsd: 0,
      pricingStatus: "priced",
      valueJson: {
        requestedModel: "gpt-5.4",
        servedModel: "gpt-5.4-mini",
        servedModelSource: "provider_response",
        evidenceMode: "identity_triage",
        standardLossUsd: 0,
      },
      evidence: {
        evidenceRequirements: {
          canonicalSchemaVersion: "v2",
          requestedModelPresent: true,
          servedModelPresent: true,
          servedModelSource: "provider_response",
        },
        falsePositiveGuards: {
          documentedAliasRolloverSuppressed: true,
          serviceTierOnlyIgnored: true,
          systemFingerprintOnlyIgnored: true,
        },
        computationTrace: {
          methodId: "served_model_mismatch_identity_triage_v1",
          outputs: {
            standardLossUsd: 0,
            providerRecognizedLossUsd: 0,
            recognitionGapUsd: 0,
          },
        },
      },
    });
  });

  it("served-model-mismatch-overcharge-delta: emits refundable candidate only with priced models and proven billed basis", () => {
    const event = normalizeCanonicalEvent(v2Event({
      request: {
        requestedModel: "gpt-5.4",
        model: "gpt-5.4",
      },
      response: {
        servedModel: "gpt-5.4-mini",
        servedModelSource: "provider_response",
      },
      usage: {
        input: 1_000,
        output: 100,
        categories: [
          { category: "input", tokens: 1_000, provider: "openai" },
          { category: "output", tokens: 100, provider: "openai" },
        ],
      },
    }));

    const signal = detectServedModelMismatch(event, {
      billingContext: {
        provenBilledModel: "gpt-5.4",
        observedChargeSource: "provider_billing_import",
        observedAt: "2026-06-14T12:05:00.000Z",
      },
    });

    expect(signal).toMatchObject({
      code: "SERVED_MODEL_MISMATCH",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      liabilityParty: "provider",
      creditCandidate: true,
      valueKind: "money",
      recoverableBasis: "overcharge_delta",
      expectedChargeUsd: 0.0012,
      pricingStatus: "priced",
      valueJson: {
        evidenceMode: "overcharge_delta",
        standardLossUsd: 0.0028,
      },
      evidence: {
        billingContext: {
          provenBilledModel: "gpt-5.4",
          observedChargeSource: "provider_billing_import",
        },
        computationTrace: {
          methodId: "served_model_mismatch_overcharge_delta_v1",
        },
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeCloseTo(0.0028, 6);
  });

  it("served-model-mismatch-observed-below-served-zero: exact observed charge below served expected stays zero", () => {
    const event = normalizeCanonicalEvent(pricedMismatchEvent());

    const signal = detectServedModelMismatch(event, {
      billingContext: {
        provenBilledModel: "gpt-5.4",
        observedChargeUsd: 0.0010,
        observedChargeSource: "provider_billing_import",
      },
    });

    expect(signal).toMatchObject({
      status: "triage_only",
      evidenceGrade: "triage_only",
      providerRecoverableLossUsd: 0,
      valueJson: {
        evidenceMode: "identity_triage",
        standardLossUsd: 0,
      },
    });
  });

  it("served-model-mismatch-observed-above-served-delta: exact observed charge delta is refundable", () => {
    const event = normalizeCanonicalEvent(pricedMismatchEvent());

    const signal = detectServedModelMismatch(event, {
      billingContext: {
        provenBilledModel: "gpt-5.4",
        observedChargeUsd: 0.0015,
        observedChargeSource: "provider_billing_import",
      },
    });

    expect(signal).toMatchObject({
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      observedChargeUsd: 0.0015,
      expectedChargeUsd: 0.0012,
      valueJson: {
        evidenceMode: "overcharge_delta",
        standardLossUsd: 0.0003,
      },
      evidence: {
        computationTrace: {
          inputs: {
            overchargeBasis: "exact_observed_charge",
          },
        },
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeCloseTo(0.0003, 6);
  });

  it("served-model-mismatch-observed-ignores-requested-basis: observed charge overrides requested-minus-served math", () => {
    const event = normalizeCanonicalEvent(pricedMismatchEvent());

    const signal = detectServedModelMismatch(event, {
      billingContext: {
        provenBilledModel: "gpt-5.4",
        observedChargeUsd: 0.0020,
        observedChargeSource: "provider_billing_import",
      },
    });

    expect(signal?.providerRecoverableLossUsd).toBeCloseTo(0.0008, 6);
    expect(signal?.providerRecoverableLossUsd).not.toBeCloseTo(0.0028, 6);
    expect(signal).toMatchObject({
      evidence: {
        computationTrace: {
          inputs: {
            overchargeBasis: "exact_observed_charge",
            requestedModelExpectedChargeUsd: 0.004,
            servedModelExpectedChargeUsd: 0.0012,
          },
        },
      },
    });
  });

  it("served-model-mismatch-partial-pricing-triage: incomplete pricing is pricing_unknown for the claim", () => {
    const event = normalizeCanonicalEvent(pricedMismatchEvent({
      usage: {
        categories: [
          { category: "input", tokens: 1_000, provider: "openai" },
          { category: "output", tokens: 100, provider: "openai" },
          { category: "provider:openai:responses.usage.new_billed_tokens", tokens: 50, provider: "openai" },
        ],
      },
    }));

    const signal = detectServedModelMismatch(event, {
      billingContext: {
        provenBilledModel: "gpt-5.4",
      },
    });

    expect(signal).toMatchObject({
      status: "triage_only",
      evidenceGrade: "triage_only",
      pricingStatus: "pricing_unknown",
      providerRecoverableLossUsd: 0,
      evidence: {
        pricing: {
          pricingStatus: "pricing_unknown",
          requestedModel: { pricingStatus: "partial" },
          servedModel: { pricingStatus: "partial" },
        },
      },
    });
  });

  it("served-model-mismatch-stateless-wire: runs from stateless detectors without billing context", () => {
    const event = normalizeCanonicalEvent(v2Event({
      request: {
        requestedModel: "gpt-5.4",
        model: "gpt-5.4",
      },
      response: {
        servedModel: "gpt-5.4-mini",
        servedModelSource: "provider_response",
      },
    }));

    const signal = runStatelessDetectors(event).find((entry) => entry.code === "SERVED_MODEL_MISMATCH");

    expect(signal).toMatchObject({
      status: "candidate",
      valueKind: "money",
      evidenceGrade: "unrecognized_standard_loss",
      creditCandidate: false,
      standardLossStatus: "computed",
      standardLossMethod: "call_cost_floor_v1",
      standardLossGrade: "unrecognized_standard_loss",
      computationTrace: {
        method: "call_cost_floor_v1",
        basisDetail: "served_wrong_model",
      },
    });
    expect(signal?.standardLossUsd).toBeGreaterThan(0);
    expect(signal?.providerRecognizedLossUsd).toBe(0);
    expect(signal?.recognitionGapUsd).toBe(signal?.standardLossUsd);
  });

  it("served-model-mismatch-provenance-gate: does not emit on adapter fallback or absent provenance", () => {
    const fallback = normalizeCanonicalEvent(v2Event({
      response: {
        servedModel: "gpt-5.4-mini",
        servedModelSource: "adapter_fallback",
      },
    }));
    const absent = normalizeCanonicalEvent(v2Event({
      response: {
        servedModel: "gpt-5.4-mini",
      },
    }));

    expect(detectServedModelMismatch(fallback)).toBeNull();
    expect(detectServedModelMismatch(absent)).toBeNull();
  });

  it("served-model-mismatch-alias-guards: suppresses provider-documented alias rollovers", () => {
    const openAiAlias = normalizeCanonicalEvent(v2Event({
      request: {
        requestedModel: "gpt-4o",
        model: "gpt-4o",
      },
      response: {
        servedModel: "gpt-4o-2024-08-06",
        servedModelSource: "provider_response",
      },
    }));
    const anthropicAlias = normalizeCanonicalEvent(v2Event({
      request: {
        provider: "anthropic",
        requestedModel: "claude-sonnet-4-5",
        model: "claude-sonnet-4-5",
      },
      response: {
        servedModel: "claude-sonnet-4-5-20250929",
        servedModelSource: "provider_response",
      },
      usage: {
        categories: [
          { category: "input", tokens: 100, provider: "anthropic" },
          { category: "output", tokens: 10, provider: "anthropic" },
        ],
      },
    }));
    const anthropicLatest = normalizeCanonicalEvent(v2Event({
      request: {
        provider: "anthropic",
        requestedModel: "claude-3-5-sonnet-latest",
        model: "claude-3-5-sonnet-latest",
      },
      response: {
        servedModel: "claude-3-5-sonnet-20241022",
        servedModelSource: "provider_response",
      },
      usage: {
        categories: [
          { category: "input", tokens: 100, provider: "anthropic" },
          { category: "output", tokens: 10, provider: "anthropic" },
        ],
      },
    }));

    expect(detectServedModelMismatch(openAiAlias)).toBeNull();
    expect(detectServedModelMismatch(anthropicAlias)).toBeNull();
    expect(detectServedModelMismatch(anthropicLatest)).toBeNull();
  });

  it("served-model-mismatch-gemini-version-alias: suppresses registry-backed Gemini modelVersion aliases", () => {
    const geminiVersion = normalizeCanonicalEvent(v2Event({
      request: {
        provider: "gemini",
        requestedModel: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
        providerPlane: "gemini_developer_api",
      },
      response: {
        servedModel: "gemini-2.5-flash-001",
        servedModelSource: "provider_response",
      },
      usage: {
        categories: [
          { category: "input", tokens: 100, provider: "gemini" },
          { category: "output", tokens: 10, provider: "gemini" },
        ],
      },
    }));
    const geminiResourceName = normalizeCanonicalEvent(v2Event({
      request: {
        provider: "gemini",
        requestedModel: "models/gemini-2.5-flash",
        model: "models/gemini-2.5-flash",
        providerPlane: "gemini_developer_api",
      },
      response: {
        servedModel: "gemini-2.5-flash-001",
        servedModelSource: "provider_response",
      },
      usage: {
        categories: [
          { category: "input", tokens: 100, provider: "gemini" },
          { category: "output", tokens: 10, provider: "gemini" },
        ],
      },
    }));

    expect(detectServedModelMismatch(geminiVersion)).toBeNull();
    expect(detectServedModelMismatch(geminiResourceName)).toBeNull();
  });

  it("served-model-mismatch-pinned-anthropic: treats 4.6-plus dateless IDs as pinned snapshots", () => {
    const event = normalizeCanonicalEvent(v2Event({
      request: {
        provider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        model: "claude-sonnet-4-6",
      },
      response: {
        servedModel: "claude-sonnet-4-6-20260101",
        servedModelSource: "provider_response",
      },
      usage: {
        categories: [
          { category: "input", tokens: 100, provider: "anthropic" },
          { category: "output", tokens: 10, provider: "anthropic" },
        ],
      },
    }));

    expect(detectServedModelMismatch(event)).toMatchObject({
      code: "SERVED_MODEL_MISMATCH",
      evidence: {
        aliasResolution: {
          reason: "anthropic_4_6_plus_dateless_id_is_treated_as_pinned_snapshot",
        },
      },
    });
  });

  it("served-model-mismatch-case-guard: ignores case-only differences", () => {
    const event = normalizeCanonicalEvent(v2Event({
      request: {
        requestedModel: "gpt-5.4",
        model: "gpt-5.4",
      },
      response: {
        servedModel: "GPT-5.4",
        servedModelSource: "provider_response",
      },
    }));

    expect(detectServedModelMismatch(event)).toBeNull();
  });
});

function pricedMismatchEvent(overrides: {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly response?: Partial<CanonicalEventV2["response"]>;
  readonly usage?: Partial<CanonicalEventV2["usage"]>;
} = {}): CanonicalEventV2 {
  return v2Event({
    ...overrides,
    request: {
      requestedModel: "gpt-5.4",
      model: "gpt-5.4",
      ...overrides.request,
    },
    response: {
      servedModel: "gpt-5.4-mini",
      servedModelSource: "provider_response",
      ...overrides.response,
    },
    usage: {
      input: 1_000,
      output: 100,
      categories: [
        { category: "input", tokens: 1_000, provider: "openai" },
        { category: "output", tokens: 100, provider: "openai" },
      ],
      ...overrides.usage,
    },
  });
}

function v2Event(overrides: {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly response?: Partial<CanonicalEventV2["response"]>;
  readonly usage?: Partial<CanonicalEventV2["usage"]>;
} = {}): CanonicalEventV2 {
  const request = {
    tenantId: "tenant-model-identity",
    provider: "openai" as const,
    requestId: "req-model-identity",
    requestedModel: "gpt-5.4",
    model: "gpt-5.4",
    attemptIndex: 0,
    route: "chat.completions",
    ...overrides.request,
  };
  const response = {
    statusCode: 200,
    finishReason: "stop",
    content: "completed",
    servedModel: request.model ?? request.requestedModel,
    providerRequestId: "provider-req-1",
    providerResponseId: "chatcmpl-1",
    systemFingerprint: "fp_123",
    serviceTier: "default",
    ...overrides.response,
  };
  const usage = {
    input: 100,
    output: 10,
    cache: { read: 0, creation: 0 },
    usageSource: "provider" as const,
    categories: [
      { category: "input", tokens: 100, provider: request.provider },
      { category: "output", tokens: 10, provider: request.provider },
    ],
    ...overrides.usage,
  };
  return {
    schemaVersion: "v2",
    request,
    response,
    usage,
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:00:01.000Z",
      latencyMs: 1_000,
      chunkCount: 0,
      terminalStatus: "complete",
    },
    attempts: [
      {
        attemptNumber: 0,
        provider: request.provider,
        model: request.model ?? request.requestedModel,
        status: "success",
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:00:01.000Z",
          latencyMs: 1_000,
        },
        finalSelected: true,
      },
    ],
  };
}
