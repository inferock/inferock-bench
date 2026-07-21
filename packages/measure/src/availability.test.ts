import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  classifyProviderDowntime,
  detectProviderDowntime,
  identifyDowntimeWindows,
} from "./availability.js";
import type { CanonicalEventV1 } from "./canonical-event.js";
import { GEMINI_DEVELOPER_API_PLANE } from "./pricing.js";
import { applyStandardLossEconomicsToSignals } from "./standard-loss.js";

describe("availability detector", () => {
  it("downtime-provider-5xx-known-priced-billed: keeps charged-failure evidence without provider credit posture", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "provider unavailable",
        errorClass: "http_503:overloaded_error",
        providerRequestId: "openai-req-503",
      },
      usage: {
        input: 100,
        output: 5,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectProviderDowntime(event)).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      detector: "availability",
      failureClass: "downtime",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      recoverableBasis: "whole_call",
      pricingStatus: "priced",
      providerRecoverableLossUsd: 0,
      valueKind: "money",
      valueJson: {
        timeLossKind: "downtime_event_evidence",
        timeLossMs: 0,
        providerRecognizedCreditUsd: 0,
        providerRecognitionLine: "Estimated recoverable (our arithmetic): $0 / 0s - first-party credit terms unverified",
      },
      evidence: {
        statusCode: 503,
        reason: "provider_status_5xx",
        ownership: "provider",
        providerReceiptPresent: true,
        receiptFields: ["response.providerRequestId"],
        tokensBilled: 105,
        providerRecognitionLine: "Estimated recoverable (our arithmetic): $0 / 0s - first-party credit terms unverified",
      },
    });
  });

  it("downtime-provider-5xx-unbilled-triage: records downtime evidence without recoverable dollars", () => {
    const event = buildCanonicalEvent({
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "provider unavailable",
        errorClass: "http_503:overloaded_error",
        providerRequestId: "openai-req-unbilled",
      },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectProviderDowntime(event)).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      recoverableBasis: "whole_call",
      providerRecoverableLossUsd: null,
      evidence: {
        reason: "provider_status_5xx",
        providerReceiptPresent: true,
        receiptFields: ["response.providerRequestId"],
        triageReason: "unbilled",
      },
    });
  });

  it("downtime-unreceipted-gateway-5xx-ambiguous: cannot create provider-owned standard-loss floor", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      response: {
        statusCode: 502,
        finishReason: "error",
        content: "Bad gateway from edge proxy.",
        errorClass: "http_502:bad_gateway",
      },
      usage: {
        input: 100,
        output: 5,
        cache: { read: 0, creation: 0 },
      },
    });

    const signal = detectProviderDowntime(event);

    expect(signal).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      failureClass: null,
      severity: "warning",
      liabilityParty: "unknown",
      valueKind: "triage",
      recoverableBasis: null,
      providerRecoverableLossUsd: null,
      evidence: {
        reason: "ambiguous_status_502_without_provider_receipt",
        branch: "status_code",
        ownership: "ambiguous",
        triageReason: "ambiguous_5xx_without_provider_receipt",
        providerReceiptPresent: false,
        receiptFields: [],
      },
    });
    if (!signal) throw new Error("expected ambiguous proxy downtime signal");
    const [withEconomics] = applyStandardLossEconomicsToSignals(event, [signal]);
    expect(withEconomics).toMatchObject({
      standardLossStatus: "not_applicable",
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
    });
  });

  it.each([
    {
      provider: "openai" as const,
      statusCode: 503,
      responseEvidence: { providerRequestId: "openai-req-receipted-503" },
      reason: "provider_status_5xx",
      receiptFields: ["response.providerRequestId"],
    },
    {
      provider: "anthropic" as const,
      statusCode: 529,
      responseEvidence: { sanitizedHeaders: { "anthropic-request-id": "anthropic-req-529" } },
      reason: "anthropic_overloaded",
      receiptFields: ["response.sanitizedHeaders.anthropic-request-id"],
    },
  ])("downtime-receipted-first-party-5xx: keeps $provider $statusCode provider-owned", (testCase) => {
    const event = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: testCase.provider,
        model: testCase.provider === "anthropic" ? "claude-haiku-4-5-20251001" : "gpt-4o-mini",
      },
      response: {
        statusCode: testCase.statusCode,
        finishReason: "error",
        content: "service unavailable",
        errorClass: `http_${testCase.statusCode}:service_unavailable`,
      },
      usage: {
        input: 100,
        output: 1,
        cache: { read: 0, creation: 0 },
      },
    }), testCase.responseEvidence);

    expect(detectProviderDowntime(event)).toMatchObject({
      failureClass: "downtime",
      liabilityParty: "provider",
      recoverableBasis: "whole_call",
      evidence: {
        reason: testCase.reason,
        ownership: "provider",
        providerReceiptPresent: true,
        receiptFields: testCase.receiptFields,
      },
    });
  });

  it("downtime-openai-503-slow-down-triage: does not treat customer-ramp Slow Down as provider-owned refundable downtime", () => {
    const baseEvent = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "Slow Down: requests are ramping too quickly for this organization.",
        errorClass: "http_503:server_error",
      },
      usage: {
        input: 100,
        output: 5,
        cache: { read: 0, creation: 0 },
      },
    });
    const event = {
      ...baseEvent,
      response: {
        ...baseEvent.response,
        rawErrorType: "Slow Down",
      },
    };

    expect(detectProviderDowntime(event)).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      evidence: {
        reason: "openai_slow_down_503",
        branch: "status_code",
        ownership: "ambiguous",
        triageReason: "customer_ramp_slow_down",
        providerReceiptPresent: false,
        receiptFields: [],
        tokensBilled: 105,
      },
    });
  });

  it("excludes customer auth errors from downtime", () => {
    const event = buildCanonicalEvent({
      response: {
        statusCode: 401,
        finishReason: "error",
        content: "invalid api key",
        errorClass: "http_401:authentication_error",
      },
    });

    expect(classifyProviderDowntime(event)).toBeNull();
    expect(detectProviderDowntime(event)).toBeNull();
  });

  it("downtime-success-content-capacity-words-negative: does not classify answer text capacity terms as downtime", () => {
    const event = buildCanonicalEvent({
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "For request timeout and overloaded capacity planning, use exponential backoff.",
      },
      usage: {
        input: 100,
        output: 12,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(classifyProviderDowntime(event)).toBeNull();
    expect(detectProviderDowntime(event)).toBeNull();
  });

  it("downtime-unknown-pricing-stays-in-whole-call-pool: keeps provider-owned failure attributable without credit dollars", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "unknown-model",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "provider unavailable",
        errorClass: "http_503:overloaded_error",
        providerRequestId: "openai-req-unknown-model",
      },
      usage: {
        input: 100,
        output: 5,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectProviderDowntime(event)).toMatchObject({
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      recoverableBasis: "whole_call",
      pricingStatus: "pricing_unknown",
      providerRecoverableLossUsd: 0,
      evidence: {
        providerReceiptPresent: true,
        receiptFields: ["response.providerRequestId"],
      },
    });
  });

  it("downtime-openai-429-rate-limit-negative: does not treat customer rate limiting as provider downtime", () => {
    const tenantQuota = buildCanonicalEvent({
      request: {
        provider: "openai",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "tenant quota exceeded",
        errorClass: "http_429:rate_limit_error",
      },
    });

    expect(detectProviderDowntime(tenantQuota)).toBeNull();
  });

  it("downtime-429-error-surface-capacity-triage: records capacity error text as triage-only without ownership", () => {
    const stringOnlyCapacity = buildCanonicalEvent({
      request: {
        provider: "openai",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "",
        errorClass: "http_429:capacity",
      },
      usage: {
        input: 100,
        output: 1,
      },
    });

    expect(detectProviderDowntime(stringOnlyCapacity)).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      evidence: {
        reason: "provider_rate_limit_capacity_text",
        branch: "rate_limit_evidence",
        triageReason: "ambiguous_rate_limit_ownership",
      },
    });
  });

  it("downtime-gemini-504-ownership: treats 504 as provider-owned only with provider capacity evidence", () => {
    const ambiguous504 = buildCanonicalEvent({
      request: {
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      response: {
        statusCode: 504,
        finishReason: "error",
        content: "Deadline exceeded.",
        errorClass: "http_504:DEADLINE_EXCEEDED",
      },
      usage: {
        input: 100,
        output: 1,
      },
    });
    const provider504 = buildCanonicalEvent({
      request: {
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      response: {
        statusCode: 504,
        finishReason: "error",
        content: "Provider timeout due to overloaded capacity.",
        errorClass: "http_504:provider_timeout",
      },
      usage: {
        input: 100,
        output: 1,
      },
    });
    const tenantQuota429 = buildCanonicalEvent({
      request: {
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "RESOURCE_EXHAUSTED quota exceeded.",
        errorClass: "http_429:RESOURCE_EXHAUSTED",
      },
    });

    expect(detectProviderDowntime(ambiguous504)).toMatchObject({
      evidence: {
        reason: "gemini_ambiguous_deadline_exceeded_504",
        ownership: "ambiguous",
        triageReason: "ambiguous_timeout_ownership",
      },
    });
    expect(detectProviderDowntime(provider504)).toMatchObject({
      evidence: {
        reason: "gemini_provider_timeout_504",
        ownership: "provider",
      },
    });
    expect(detectProviderDowntime(tenantQuota429)).toBeNull();
    expect(identifyDowntimeWindows([
      eventWithRequestMetadata(ambiguous504, { operationId: "op-ambiguous" }),
      eventWithRequestMetadata(provider504, { operationId: "op-provider" }),
    ])).toEqual([]);
  });

  it("downtime-gemini-504-ambiguous-economics: keeps priced ambiguous 504 out of standard-loss dollars", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "gemini",
        model: "gemini-2.5-flash",
        providerPlane: GEMINI_DEVELOPER_API_PLANE,
      },
      response: {
        statusCode: 504,
        finishReason: "error",
        content: "Deadline exceeded.",
        errorClass: "http_504:DEADLINE_EXCEEDED",
      },
      usage: {
        input: 100,
        output: 1,
        cache: { read: 0, creation: 0 },
      },
    });

    const signal = detectProviderDowntime(event);

    expect(signal).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      severity: "warning",
      liabilityParty: "unknown",
      valueKind: "triage",
      recoverableBasis: null,
      pricingStatus: "priced",
      providerRecoverableLossUsd: null,
      evidence: {
        reason: "gemini_ambiguous_deadline_exceeded_504",
        ownership: "ambiguous",
        triageReason: "ambiguous_timeout_ownership",
        tokensBilled: 101,
      },
    });
    if (!signal) throw new Error("expected ambiguous Gemini downtime signal");
    const [withEconomics] = applyStandardLossEconomicsToSignals(event, [signal]);
    expect(withEconomics).toMatchObject({
      liabilityParty: "unknown",
      standardLossStatus: "not_applicable",
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
    });
  });

  it("downtime-gemini-502-transport-body-ambiguous: excludes bench transport-shaped 502 from provider windows", () => {
    const first = eventWithRequestMetadata(buildCanonicalEvent({
      request: {
        requestId: "req-gemini-transport-1",
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      response: {
        statusCode: 502,
        finishReason: "error",
        content: "Provider request failed before a response was received.",
        errorClass: "http_502:transport_error",
      },
      usage: {
        input: 100,
        output: 1,
      },
      timing: timing("2026-06-14T12:00:00.000Z", 1_000),
    }), { operationId: "op-gemini-transport-1" });
    const second = eventWithRequestMetadata(buildCanonicalEvent({
      request: {
        requestId: "req-gemini-transport-2",
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
      response: {
        statusCode: 502,
        finishReason: "error",
        content: "Provider request failed before a response was received.",
        errorClass: "http_502:transport_error",
      },
      usage: {
        input: 100,
        output: 1,
      },
      timing: timing("2026-06-14T12:01:00.000Z", 1_000),
    }), { operationId: "op-gemini-transport-2" });

    expect(detectProviderDowntime(first)).toMatchObject({
      severity: "warning",
      liabilityParty: "unknown",
      valueKind: "triage",
      recoverableBasis: null,
      evidence: {
        reason: "gemini_ambiguous_status_502",
        branch: "status_code",
        ownership: "ambiguous",
        triageReason: "ambiguous_5xx_without_provider_evidence",
      },
    });
    expect(identifyDowntimeWindows([first, second])).toEqual([]);
  });

  it("downtime-local-origin-error: excludes local synthetic failures from provider downtime", () => {
    const event = eventWithRequestMetadata(buildCanonicalEvent({
      request: {
        requestId: "req-local-origin-server-error",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      response: {
        statusCode: 500,
        finishReason: "error",
        content: "server_error",
        errorClass: "http_500:server_error",
        errorOrigin: "local",
      },
      usage: {
        input: 100,
        output: 0,
      },
      timing: timing("2026-06-14T12:02:00.000Z", 1_000),
    }), { operationId: "op-local-origin-server-error" });

    expect(classifyProviderDowntime(event)).toBeNull();
    expect(detectProviderDowntime(event)).toBeNull();
    expect(identifyDowntimeWindows([event, event])).toEqual([]);
  });

  it("downtime-transport-before-status-502: treats proxy transport failures as ambiguous triage", () => {
    const event = buildCanonicalEvent({
      response: {
        statusCode: 502,
        finishReason: "error",
        content: "",
        errorClass: "transport:TimeoutError",
      },
      usage: {
        input: 100,
        output: 1,
      },
    });

    expect(detectProviderDowntime(event)).toMatchObject({
      failureClass: "downtime",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      evidence: {
        reason: "transport_error",
        branch: "transport",
        triageReason: "ambiguous_transport_without_provider_receipt",
        providerReceiptPresent: false,
        receiptFields: [],
      },
    });
  });

  it.each([
    [529, "overloaded_error", "anthropic_overloaded"],
    [500, "api_error", "anthropic_api_error"],
    [504, "timeout_error", "anthropic_timeout"],
  ])("downtime-anthropic-overload-statuses: classifies Anthropic %s %s as provider-owned", (
    statusCode,
    rawErrorType,
    reason,
  ) => {
    const baseEvent = buildCanonicalEvent({
      request: {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
      },
      response: {
        statusCode,
        finishReason: "error",
        content: rawErrorType,
        errorClass: `http_${statusCode}:${rawErrorType}`,
      },
      usage: {
        input: 100,
        output: 1,
        cache: { read: 0, creation: 0 },
      },
    });
    const event = {
      ...baseEvent,
      response: {
        ...baseEvent.response,
        rawErrorType,
      },
    };

    expect(detectProviderDowntime(event)).toMatchObject({
      code: "PROVIDER_DOWNTIME",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: 0,
      evidence: {
        reason,
        ownership: "provider",
        rawErrorType,
        providerReceiptPresent: false,
        receiptFields: [],
      },
    });
  });

  it("downtime-oss-host-taxonomies: applies published or conservative host ownership shims", () => {
    const deepseek429 = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "deepseek_platform",
        model: "deepseek-v4-pro",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "Rate limit reached.",
        errorClass: "http_429:rate_limit",
      },
    }), { rawErrorType: "rate_limit" });
    const deepseek503 = buildCanonicalEvent({
      request: {
        provider: "deepseek_platform",
        model: "deepseek-v4-pro",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "Server overloaded.",
        errorClass: "http_503:server_overloaded",
      },
    });
    const kimiOverload = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "moonshot_kimi",
        model: "kimi-k2.7-code",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "engine overloaded",
        errorClass: "http_503:engine_overloaded_error",
      },
    }), { rawErrorType: "engine_overloaded_error" });
    const zaiTenant = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "zai",
        model: "glm-5.2",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "rate limit",
        errorClass: "http_429:1308",
      },
    }), { rawErrorCode: "1308" });
    const zaiOverload = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "zai",
        model: "glm-5.2",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "service temporarily overloaded",
        errorClass: "http_503:1305",
      },
    }), { rawErrorCode: "1305" });
    const deepinfraRate = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "deepinfra",
        model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "account rate limit exceeded",
        errorClass: "http_429:rate_limit",
      },
    }), { rawErrorType: "rate_limit" });
    const deepinfraBusy = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "deepinfra",
        model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "model busy, try again later",
        errorClass: "http_429:model_busy",
      },
    }), { rawErrorType: "model_busy" });
    const mistralNoReceipt = buildCanonicalEvent({
      request: {
        provider: "mistral",
        model: "mistral-large-2512",
      },
      response: {
        statusCode: 500,
        finishReason: "error",
        content: "server error",
        errorClass: "http_500:server_error",
      },
    });
    const mistralReceipt = withResponseEvidence(mistralNoReceipt, {
      sanitizedHeaders: { "x-request-id": "mistral-req-1" },
    });
    const openRouterRateLimit = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-pro",
      },
      response: {
        statusCode: 429,
        finishReason: "error",
        content: "rate limit exceeded",
        errorClass: "http_429:rate_limit_exceeded",
      },
    }), { rawErrorType: "rate_limit_exceeded" });
    const openRouterOverload = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-pro",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "provider overloaded",
        errorClass: "http_503:provider_overloaded",
      },
    }), {
      rawErrorType: "provider_overloaded",
      providerRequestId: "gen-or-1",
      stopDetails: {
        openRouter: {
          selectedUpstreamProvider: "deepseek",
          selectedUpstreamModel: "deepseek/deepseek-v4-pro-20260423",
          metadataStatus: "captured",
          metadataFieldPath: "$.openrouter_metadata.endpoints.available",
        },
      },
    });

    expect(classifyProviderDowntime(deepseek429)).toBeNull();
    expect(classifyProviderDowntime(deepseek503)).toMatchObject({
      reason: "deepseek_provider_fault_status_503",
      ownership: "provider",
    });
    expect(classifyProviderDowntime(kimiOverload)).toMatchObject({
      reason: "kimi_engine_overloaded_error",
      ownership: "provider",
    });
    expect(classifyProviderDowntime(zaiTenant)).toBeNull();
    expect(classifyProviderDowntime(zaiOverload)).toMatchObject({
      reason: "zai_business_code_1305_overload",
      ownership: "provider",
    });
    expect(classifyProviderDowntime(deepinfraRate)).toBeNull();
    expect(classifyProviderDowntime(deepinfraBusy)).toMatchObject({
      reason: "deepinfra_model_busy_429",
      ownership: "provider",
    });
    expect(classifyProviderDowntime(mistralNoReceipt)).toMatchObject({
      ownership: "ambiguous",
      triageReason: "ambiguous_5xx_without_provider_receipt",
    });
    expect(classifyProviderDowntime(mistralReceipt)).toMatchObject({
      reason: "mistral_provider_receipted_status_500",
      ownership: "provider",
    });
    expect(classifyProviderDowntime(openRouterRateLimit)).toBeNull();
    expect(classifyProviderDowntime(openRouterOverload)).toMatchObject({
      reason: "openrouter_provider_overloaded",
      ownership: "provider",
    });
  });

  it("downtime-openrouter-intent-is-not-evidence: keeps metadata-missing upstream failures ambiguous", () => {
    const pinnedIntentOnly = withResponseEvidence(buildCanonicalEvent({
      request: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-pro",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "provider overloaded",
        errorClass: "http_503:provider_overloaded",
      },
      usage: {
        input: 100,
        output: 5,
      },
    }), {
      rawErrorType: "provider_overloaded",
      providerRequestId: "gen-or-intent-only",
      stopDetails: {
        openRouter: {
          pinnedUpstreamProvider: "deepseek",
          metadataStatus: "metadata_missing",
        },
      },
    });

    expect(classifyProviderDowntime(pinnedIntentOnly)).toMatchObject({
      ownership: "ambiguous",
      triageReason: "ambiguous_or_routing_exhaustion_without_provider_attempt",
    });
    expect(detectProviderDowntime(pinnedIntentOnly)).toMatchObject({
      valueKind: "triage",
      providerRecoverableLossUsd: null,
      evidence: {
        ownership: "ambiguous",
      },
    });
  });

  it("downtime-openrouter-rate-limit-tenant-default: ignores generic capacity phrases", () => {
    for (const content of [
      "provider capacity rate_limit_exceeded",
      "rate_limit_exceeded provider capacity",
    ]) {
      const event = withResponseEvidence(buildCanonicalEvent({
        request: {
          provider: "openrouter",
          model: "deepseek/deepseek-v4-pro",
        },
        response: {
          statusCode: 429,
          finishReason: "error",
          content,
          errorClass: "http_429:rate_limit_exceeded",
        },
      }), {
        rawErrorType: "rate_limit_exceeded",
        stopDetails: {
          openRouter: {
            selectedUpstreamProvider: "deepseek",
            metadataStatus: "captured",
            metadataFieldPath: "$.openrouter_metadata.endpoints.available",
          },
        },
      });

      expect(classifyProviderDowntime(event)).toBeNull();
      expect(detectProviderDowntime(event)).toBeNull();
    }
  });

  it("downtime-window-single-failed-call-negative: does not fabricate outage duration from one failure", () => {
    const windows = identifyDowntimeWindows([
      downtimeEvent("req-fail-1", "2026-06-14T12:00:00.000Z", {
        statusCode: 503,
        operationId: "op-fail-1",
      }),
    ]);

    expect(windows).toEqual([]);
  });

  it("downtime-window-clustered-organic: requires two provider-owned failures and stores floor plus envelope", () => {
    const windows = identifyDowntimeWindows([
      okEvent("req-good-before", "2026-06-14T11:59:30.000Z", { operationId: "op-good-before" }),
      downtimeEvent("req-fail-1", "2026-06-14T12:00:00.000Z", {
        statusCode: 503,
        latencyMs: 1_000,
        operationId: "op-fail-1",
      }),
      okEvent("req-success-inside", "2026-06-14T12:00:30.000Z", { operationId: "op-success-inside" }),
      downtimeEvent("req-fail-2", "2026-06-14T12:01:00.000Z", {
        statusCode: 503,
        latencyMs: 1_000,
        operationId: "op-fail-2",
      }),
      okEvent("req-good-after", "2026-06-14T12:02:00.000Z", { operationId: "op-good-after" }),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      timeLossMethodId: "downtime_window_v1",
      windowStart: "2026-06-14T12:00:00.000Z",
      windowEnd: "2026-06-14T12:01:01.000Z",
      windowDurationMs: 61_000,
      timeLossMs: 61_000,
      eligibleOperationCount: 5,
      providerOwnedFailureOperationCount: 2,
      providerFaultRate: 2 / 5,
      threshold: 0.05,
      thresholdSource: "inferock-default-provider-fault-rate-gemini-aligned",
      thresholdSourceLabel:
        "Inferock default >5% over 5 minutes, aligned with Gemini's published downtime definition; standard-defined, not credit proof",
      thresholdSourceRefs: [
        "downtime-identification-method-2026-07-05:Default organic rule",
        "provider-sla-latency-compensation-2026-07-05:Gemini Online Inference API on Vertex/Gemini Enterprise",
      ],
      creditTermsVerified: false,
      evidenceGrade: "organic_sparse",
      windowConfidence: "observed_traffic_window",
      lastGoodBefore: "2026-06-14T11:59:31.000Z",
      firstGoodAfter: "2026-06-14T12:02:00.000Z",
      uncertaintyEnvelopeMs: 149_000,
      sparseTraffic: true,
      statusFeedCorroborated: false,
    });
  });

  it("downtime-window-rolling-boundary: detects failures 4m59s apart that straddle minute grid", () => {
    const windows = identifyDowntimeWindows([
      downtimeEvent("req-fail-1", "2026-06-14T12:00:30.000Z", {
        statusCode: 503,
        operationId: "op-fail-1",
      }),
      downtimeEvent("req-fail-2", "2026-06-14T12:05:29.000Z", {
        statusCode: 503,
        operationId: "op-fail-2",
      }),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      windowStart: "2026-06-14T12:00:30.000Z",
      windowEnd: "2026-06-14T12:05:30.000Z",
      windowDurationMs: 300_000,
      providerOwnedFailureOperationCount: 2,
    });
  });

  it("downtime-window-provider-sla-provenance: uses verified Gemini threshold only when explicit SLA provenance is present", () => {
    const windows = identifyDowntimeWindows([
      withSlaProvider(downtimeEvent("req-fail-1", "2026-06-14T12:00:00.000Z", {
        statusCode: 503,
        operationId: "op-fail-1",
      }), "gcp_gemini_online_inference_api"),
      withSlaProvider(downtimeEvent("req-fail-2", "2026-06-14T12:01:00.000Z", {
        statusCode: 503,
        operationId: "op-fail-2",
      }), "gcp_gemini_online_inference_api"),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      threshold: 0.05,
      thresholdSource: "provider-published-sla-threshold:gcp-gemini-online-inference-api",
      thresholdSourceLabel:
        "Gemini Online Inference API on Vertex/Gemini Enterprise SLA downtime threshold: >5% HTTP 5xx error rate over five or more consecutive minutes",
      creditTermsVerified: true,
      evidenceGrade: "claim_grade_provider_sla",
    });
  });

  it("downtime-window-retry-collapse: one logical operation cannot satisfy the two-failure rule", () => {
    const windows = identifyDowntimeWindows([
      downtimeEvent("req-retry-1", "2026-06-14T12:00:00.000Z", {
        statusCode: 503,
        operationId: "op-retried",
      }),
      downtimeEvent("req-retry-2", "2026-06-14T12:00:20.000Z", {
        statusCode: 503,
        operationId: "op-retried",
      }),
    ]);

    expect(windows).toEqual([]);
  });

  it("downtime-window-ambiguous-transport-excluded: transport failures without provider receipt are not outage witnesses", () => {
    const windows = identifyDowntimeWindows([
      downtimeEvent("req-provider-fail", "2026-06-14T12:00:00.000Z", {
        statusCode: 503,
        operationId: "op-provider-fail",
      }),
      downtimeEvent("req-transport", "2026-06-14T12:01:00.000Z", {
        statusCode: 502,
        errorClass: "transport:TimeoutError",
        operationId: "op-transport",
      }),
    ]);

    expect(windows).toEqual([]);
  });
});

function okEvent(
  requestId: string,
  startedAt: string,
  options: {
    readonly operationId?: string;
    readonly latencyMs?: number;
  } = {},
): CanonicalEventV1 {
  return eventWithRequestMetadata(buildCanonicalEvent({
    request: {
      requestId,
      provider: "openai",
      model: "gpt-4o-mini",
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "ok",
    },
    timing: timing(startedAt, options.latencyMs ?? 1_000),
  }), options);
}

function downtimeEvent(
  requestId: string,
  startedAt: string,
  options: {
    readonly statusCode: number;
    readonly errorClass?: string;
    readonly operationId?: string;
    readonly latencyMs?: number;
  },
): CanonicalEventV1 {
  const errorClass = options.errorClass ?? `http_${options.statusCode}:server_error`;
  return eventWithRequestMetadata(buildCanonicalEvent({
    request: {
      requestId,
      provider: "openai",
      model: "gpt-4o-mini",
    },
    response: {
      statusCode: options.statusCode,
      finishReason: "error",
      content: "provider unavailable",
      errorClass,
      ...(errorClass.startsWith("transport:")
        ? {}
        : { providerRequestId: `provider-${requestId}` }),
    },
    timing: timing(startedAt, options.latencyMs ?? 1_000),
  }), options);
}

function eventWithRequestMetadata(
  event: CanonicalEventV1,
  metadata: { readonly operationId?: string },
): CanonicalEventV1 {
  return {
    ...event,
    request: {
      ...event.request,
      ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
    },
  } as CanonicalEventV1;
}

function withSlaProvider(event: CanonicalEventV1, slaProvider: string): CanonicalEventV1 {
  return {
    ...event,
    meta: {
      ...event.meta,
      slaProvider,
    },
  } as CanonicalEventV1;
}

function withResponseEvidence(
  event: CanonicalEventV1,
  evidence: {
    readonly rawErrorType?: string;
    readonly rawErrorCode?: string;
    readonly providerRequestId?: string;
    readonly sanitizedHeaders?: Readonly<Record<string, string>>;
    readonly stopDetails?: Record<string, unknown>;
  },
): CanonicalEventV1 {
  return {
    ...event,
    response: {
      ...event.response,
      ...evidence,
    },
  } as CanonicalEventV1;
}

function timing(startedAt: string, latencyMs: number): CanonicalEventV1["timing"] {
  return {
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + latencyMs).toISOString(),
    latencyMs,
  };
}
