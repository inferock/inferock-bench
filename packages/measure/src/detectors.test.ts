import { afterEach, describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
  ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  clearModelPricing,
  clearOutputSchemas,
  countOpenAiOutputTokens,
  crossCheckAnthropicOutputTokens,
  detectBillingIntegrity,
  detectBrokenOutput,
  outputSchemaCacheSize,
  registerDefaultModelPricing,
  registerModelPricing,
  registerObservedCharge,
  registerOutputSchema,
  resetBillingIntegrityState,
  runDetectors,
} from "./index.js";

const TENANT_ID = "tenant-detectors";
const OPENAI_MODEL = "gpt-5.4-mini";
const ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";

const expectedObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string", minLength: 1 },
  },
} as const;

function registerTestPricing(): void {
  registerModelPricing({
    provider: "openai",
    model: OPENAI_MODEL,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
  });
  registerModelPricing({
    provider: "anthropic",
    model: ANTHROPIC_MODEL,
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  });
}

afterEach(() => {
  clearModelPricing();
  registerDefaultModelPricing();
  clearOutputSchemas();
  resetBillingIntegrityState();
});

describe("broken-output detector", () => {
  it("detects JSON schema violations and caches validators by tenant/schema version", () => {
    registerTestPricing();
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: "v1",
      schema: expectedObjectSchema,
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-extra-field",
      },
      response: {
        content: JSON.stringify({ answer: "ok", extra: true }),
      },
      usage: {
        input: 1_000,
        output: 500,
        cache: { read: 0, creation: 0 },
      },
      meta: {
        outputSchemaVersion: "v1",
      },
    });

    expect(outputSchemaCacheSize()).toBe(0);

    const signal = detectBrokenOutput(event);

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      detector: "broken-output",
      failureClass: "broken_output",
      costUsd: 0.002,
      evidence: {
        reason: "schema_validation_failed",
        outputSchemaVersion: "v1",
      },
    });
    expect(signal?.evidence.errors).toEqual([
      expect.objectContaining({ keyword: "additionalProperties" }),
    ]);
    expect(outputSchemaCacheSize()).toBe(1);
  });

  it("detects missing required fields in caller output schemas", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: "v1",
      schema: expectedObjectSchema,
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-missing-required",
      },
      response: {
        content: JSON.stringify({}),
      },
      usage: {
        input: 100,
        output: 1,
        cache: { read: 0, creation: 0 },
      },
      meta: {
        outputSchemaVersion: "v1",
      },
    });

    const signal = detectBrokenOutput(event);

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      failureClass: "broken_output",
      evidence: {
        reason: "schema_validation_failed",
      },
    });
    expect(signal?.evidence.errors).toEqual([
      expect.objectContaining({ keyword: "required" }),
    ]);
  });

  it("detects finish_reason length before treating partial JSON as broken schema output", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: "v1",
      schema: expectedObjectSchema,
    });
    // Caller-cap correction: this legacy v1-style event has no generation capture,
    // so truncation remains refundable only with explicit missing-cap evidence.
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-truncated",
      },
      response: {
        finishReason: "length",
        content: "{\"answer\":\"partial",
      },
      usage: {
        input: 100,
        output: 10,
        cache: { read: 0, creation: 0 },
      },
      meta: {
        outputSchemaVersion: "v1",
      },
    });

    expect(detectBrokenOutput(event)).toMatchObject({
      code: "TRUNCATED",
      failureClass: "truncation",
      evidence: {
        finishReason: "length",
        outputTokens: 10,
        generationCaptured: false,
        callerCapCaptured: false,
        verdict: "no_captured_caller_cap",
      },
    });
  });

  it("returns null for valid structured output", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: "v1",
      schema: expectedObjectSchema,
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-clean-output",
      },
      response: {
        content: JSON.stringify({ answer: "accepted" }),
      },
      usage: {
        input: 100,
        output: 5,
        cache: { read: 0, creation: 0 },
      },
      meta: {
        outputSchemaVersion: "v1",
      },
    });

    expect(detectBrokenOutput(event)).toBeNull();
  });

  it("loss-detectors-output-schema-version: uses outputSchemaVersion rather than canonical schemaVersion for AJV validation", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: "v1",
      schema: expectedObjectSchema,
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-no-output-schema-version",
      },
      response: {
        content: JSON.stringify({ answer: "ok", extra: true }),
      },
    });

    expect(detectBrokenOutput(event)).toBeNull();
  });
});

describe("billing-integrity detector", () => {
  it("T-DET-BILLED-EMPTY-1: emits billed-empty when output tokens are charged for empty content", () => {
    registerTestPricing();
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-billed-empty",
      },
      response: {
        content: "   ",
      },
      usage: {
        input: 1_000,
        output: 50,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectBillingIntegrity(event)).toEqual({
      code: "BILLED_EMPTY",
      detector: "billing-integrity",
      detectorVersion: "v1",
      tenantId: TENANT_ID,
      requestId: "req-billed-empty",
      provider: "openai",
      model: OPENAI_MODEL,
      domain: "loss",
      failureClass: "empty_output",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      severity: "loss",
      dispute: true,
      liabilityParty: "provider",
      creditCandidate: true,
      recoverableBasis: "whole_call",
      valueKind: "money",
      tokensBilled: 1_050,
      tokensDelivered: 0,
      costUsd: 0.0011,
      observedChargeUsd: undefined,
      expectedChargeUsd: 0.0011,
      providerRecoverableLossUsd: 0.0011,
      pricingVersion: "pricing-registry-v0",
      pricingStatus: "priced",
      valueJson: undefined,
      evidence: {
        reason: "billable output tokens exist and response.content is empty",
        provider: "openai",
        finishReason: "stop",
        outputTokens: 50,
        hiddenOutputTokens: 0,
        geminiThinkingTokens: 0,
      },
    });
  });

  it("detects duplicate request identifiers after the first observation", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-duplicate",
      },
      response: {
        content: "complete answer",
      },
      usage: {
        input: 20,
        output: 2,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectBillingIntegrity(event)).toBeNull();
    expect(detectBillingIntegrity(event)).toMatchObject({
      code: "DUPLICATE_REQUEST_ID",
      failureClass: "duplicate_request_id",
      evidence: {
        requestId: "req-duplicate",
      },
    });
  });

  it("detects cache-rate anomalies against the 0.1x expected input-rate charge", () => {
    registerTestPricing();
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-cache-rate",
      },
      response: {
        content: "",
      },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 10_000, creation: 0 },
      },
    });
    registerObservedCharge({
      tenantId: TENANT_ID,
      provider: "openai",
      requestId: "req-cache-rate",
      chargedUsd: 0.01,
    });

    expect(detectBillingIntegrity(event)).toMatchObject({
      code: "CACHE_RATE_ANOMALY",
      failureClass: "cache_rate_anomaly",
      costUsd: 0.001,
      evidence: {
        cacheReadTokens: 10_000,
        expectedUsd: 0.001,
        chargedUsd: 0.01,
        expectedCacheReadMultiplier: null,
      },
    });
  });

  it("uses js-tiktoken for OpenAI output recount mismatches", () => {
    const content = "hello world";
    const recounted = countOpenAiOutputTokens(OPENAI_MODEL, content);
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-openai-recount",
      },
      response: {
        content,
      },
      usage: {
        input: 10,
        output: recounted + 10,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectBillingIntegrity(event)).toMatchObject({
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      failureClass: "token_recount_mismatch",
      evidence: {
        provider: "openai",
        billedOutputTokens: recounted + 10,
        recountedOutputTokens: recounted,
        tokenizer: "o200k_base",
      },
    });
  });

  it("keeps Anthropic billing structural-only and exposes a non-dispute coarse over-billing bound", () => {
    const content = "complete answer";
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-anthropic-gap",
      },
      response: {
        content,
      },
      usage: {
        input: 10,
        output: 200,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(detectBillingIntegrity(event)).toBeNull();
    expect(crossCheckAnthropicOutputTokens(event)).toMatchObject({
      provider: "anthropic",
      mode: "fallback_safe_bound",
      billedOutputTokens: 200,
      responseChars: Array.from(content).length,
      outputTokenUpperBound: Math.ceil(
        Array.from(content).length * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
      ) + ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
      boundMultiplier: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
      fallbackOverheadTokens: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
      withinBound: false,
      disputeEligible: false,
      note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
    });
  });
});

describe("runDetectors", () => {
  it("composes detector outputs without duplicating billed-empty signals", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-run-detectors",
      },
      response: {
        content: "",
      },
      usage: {
        input: 10,
        output: 1,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(runDetectors(event).map((signal) => signal.code)).toEqual([
      "BILLED_EMPTY",
    ]);
  });
});
