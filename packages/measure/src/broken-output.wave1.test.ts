import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import { detectBrokenOutput } from "./broken-output.js";
import { clearOutputSchemas, registerOutputSchema } from "./output-schemas.js";
import { isBilledButEmpty } from "./signal.js";

type ProviderSafety = NonNullable<CanonicalEventV2["response"]["providerSafety"]>;
type EventWithProviderSafety = CanonicalEventV1 & {
  readonly response: CanonicalEventV1["response"] & {
    readonly providerSafety: ProviderSafety;
  };
};

const TENANT_ID = "tenant-broken-output-wave1";
const OUTPUT_SCHEMA_VERSION = "answer-v1";
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string", minLength: 1 },
  },
} as const;

afterEach(() => {
  clearOutputSchemas();
});

describe("wave1 broken-output signal economics", () => {
  it("emits refundable-candidate BROKEN_OUTPUT only for selected tenant schema failures", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      schema: OUTPUT_SCHEMA,
    });

    const signal = detectBrokenOutput(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-schema-invalid",
      },
      response: {
        content: "{\"answer\":\"ok\",\"extra\":true}",
      },
      usage: {
        input: 100,
        output: 12,
      },
      meta: {
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      },
    }));

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      failureClass: "broken_output",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
      evidence: {
        reason: "schema_validation_failed",
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it("gemini-sent-schema-valid-registered-strict-invalid: records schema delta without broken-output dollars", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      schema: OUTPUT_SCHEMA,
    });

    const signal = detectBrokenOutput(withGeminiSentResponseSchema(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        requestId: "req-gemini-sent-valid-registered-invalid",
      },
      response: {
        content: "{\"answer\":\"ok\",\"extra\":true}",
      },
      usage: {
        input: 100,
        output: 12,
      },
      meta: {
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      },
    })));

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      failureClass: null,
      status: "triage_only",
      evidenceGrade: "triage_only",
      severity: "warning",
      creditCandidate: false,
      dispute: false,
      valueKind: "triage",
      recoverableBasis: null,
      observedChargeUsd: null,
      expectedChargeUsd: null,
      providerRecoverableLossUsd: 0,
      pricingStatus: "not_priced",
      evidence: {
        reason: "valid_under_sent_schema_registered_schema_differs",
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        schemaSource: "gemini_sent_response_schema",
        registeredVsSentSchemaDelta: {
          registeredSchemaDiffersFromSent: true,
          sentSchemaSource: "request.generation.responseJsonSchema",
          schemaDialect: "gemini_openapi_subset",
          geminiSchemaSanitization: {
            sentSchemaIsCanonical: true,
          },
        },
      },
    });
  });

  it("gemini-sent-schema-invalid: emits refundable broken-output dollars against sent schema", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      schema: OUTPUT_SCHEMA,
    });

    const signal = detectBrokenOutput(withGeminiSentResponseSchema(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        requestId: "req-gemini-sent-invalid",
      },
      response: {
        content: "{\"extra\":true}",
      },
      usage: {
        input: 100,
        output: 12,
      },
      meta: {
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      },
    })));

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      failureClass: "broken_output",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
      evidence: {
        reason: "schema_validation_failed",
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        schemaSource: "gemini_sent_response_schema",
        registeredVsSentSchemaDelta: {
          registeredSchemaDiffersFromSent: true,
        },
      },
    });
    expect(signal?.evidence.errors).toEqual([
      expect.objectContaining({ keyword: "required" }),
    ]);
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it("non-gemini-sent-schema-evidence-does-not-change-registered-schema-judging", () => {
    registerOutputSchema({
      tenantId: TENANT_ID,
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      schema: OUTPUT_SCHEMA,
    });

    const signal = detectBrokenOutput(withGeneration(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-openai-registered-still-strict",
      },
      response: {
        content: "{\"answer\":\"ok\",\"extra\":true}",
      },
      usage: {
        input: 100,
        output: 12,
      },
      meta: {
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      },
    }), {
      responseJsonSchema: sentGeminiSubsetSchema(),
    }));

    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      failureClass: "broken_output",
      evidence: {
        reason: "schema_validation_failed",
        schemaSource: "registered_output_schema",
      },
    });
    expect(signal?.evidence.registeredVsSentSchemaDelta).toBeUndefined();
  });

  it("truncation-absent-generation-refundable-with-auditable-missing-cap-evidence", () => {
    // Caller-cap correction: absent generation capture stays refundable by policy,
    // but evidence must disclose that the caller cap was not captured.
    const signal = detectBrokenOutput(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        requestId: "req-truncated-wave1",
      },
      response: {
        finishReason: "max_tokens",
        content: "partial answer",
      },
      usage: {
        input: 100,
        output: 12,
      },
    }));

    expect(signal).toMatchObject({
      code: "TRUNCATED",
      failureClass: "truncation",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
      evidence: {
        finishReason: "max_tokens",
        outputTokens: 12,
        generationCaptured: false,
        callerCapCaptured: false,
        verdict: "no_captured_caller_cap",
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it.each([
    ["maxTokens", { maxTokens: 200 }, "maxTokens", "max_tokens"],
    ["maxOutputTokens", { maxOutputTokens: 200 }, "maxOutputTokens", "max_output_tokens"],
    ["maxCompletionTokens", { maxCompletionTokens: 200 }, "maxCompletionTokens", "max_completion_tokens"],
    ["max_tokens", { max_tokens: 200 }, "max_tokens", "max_tokens"],
    ["max_output_tokens", { max_output_tokens: 200 }, "max_output_tokens", "max_output_tokens"],
    ["max_completion_tokens", { max_completion_tokens: 200 }, "max_completion_tokens", "max_completion_tokens"],
  ])("truncation-caller-cap-hit-triage-only: %s", (_name, generation, callerMaxField, callerMaxParam) => {
    const event = withGeneration(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: `req-truncated-caller-cap-${_name}`,
      },
      response: {
        finishReason: "length",
        content: "partial answer",
      },
      usage: {
        input: 100,
        output: 200,
      },
    }), generation);

    const signal = detectBrokenOutput(event);

    expect(signal).toMatchObject({
      code: "TRUNCATED",
      // Caller-cap correction: when output reaches the captured caller cap,
      // this is evidence-only triage, not a counted truncation failure.
      failureClass: null,
      status: "triage_only",
      evidenceGrade: "triage_only",
      severity: "warning",
      creditCandidate: false,
      dispute: false,
      liabilityParty: "customer",
      valueKind: "triage",
      recoverableBasis: null,
      observedChargeUsd: null,
      providerRecoverableLossUsd: 0,
      expectedChargeUsd: null,
      pricingVersion: null,
      pricingStatus: "not_priced",
      evidence: {
        finishReason: "length",
        outputTokens: 200,
        generationCaptured: true,
        callerCapCaptured: true,
        callerMaxTokens: 200,
        callerMaxField,
        callerMaxParam,
        verdict: "caller_cap_hit",
      },
    });
  });

  it("truncation-output-before-caller-cap-remains-refundable", () => {
    const event = withGeneration(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-truncated-before-caller-cap",
      },
      response: {
        finishReason: "length",
        content: "partial answer",
      },
      usage: {
        input: 100,
        output: 120,
      },
    }), { maxCompletionTokens: 320 });

    const signal = detectBrokenOutput(event);

    expect(signal).toMatchObject({
      code: "TRUNCATED",
      failureClass: "truncation",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      evidence: {
        finishReason: "length",
        outputTokens: 120,
        generationCaptured: true,
        callerCapCaptured: true,
        callerMaxTokens: 320,
        callerMaxField: "maxCompletionTokens",
        callerMaxParam: "max_completion_tokens",
        verdict: "provider_stopped_before_caller_cap",
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it("emits refundable-candidate BILLED_EMPTY only when billed output has no text, tools, or safety evidence", () => {
    const signal = detectBrokenOutput(buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-billed-empty-wave1",
      },
      response: {
        content: " ",
      },
      usage: {
        input: 100,
        output: 12,
      },
    }));

    expect(signal).toMatchObject({
      code: "BILLED_EMPTY",
      failureClass: "empty_output",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it("excludes provider refusals, content filters, and tool calls from billed-empty", () => {
    const base = buildCanonicalEvent({
      response: {
        content: "",
      },
      usage: {
        input: 100,
        output: 12,
      },
    });

    expect(isBilledButEmpty(base)).toBe(true);
    expect(isBilledButEmpty(withResponse(base, {
      toolCalls: [{ id: "call-1", type: "function" }],
    }))).toBe(false);
    expect(isBilledButEmpty(withResponse(base, { finishReason: "tool_calls" }))).toBe(false);
    expect(isBilledButEmpty(withResponse(base, { finishReason: "content_filter" }))).toBe(false);
    expect(isBilledButEmpty(withProviderSafety(base, [{
      kind: "refusal",
      source: "provider",
      reason: "refusal",
    }]))).toBe(false);
    expect(isBilledButEmpty(withProviderSafety(base, [{
      kind: "content_filter",
      source: "provider",
      reason: "content_filter",
    }]))).toBe(false);
  });
});

function withResponse(
  event: CanonicalEventV1,
  response: Partial<CanonicalEventV1["response"]>,
): CanonicalEventV1 {
  return {
    ...event,
    response: {
      ...event.response,
      ...response,
    },
  };
}

function withProviderSafety(
  event: CanonicalEventV1,
  providerSafety: ProviderSafety,
): EventWithProviderSafety {
  return {
    ...event,
    response: {
      ...event.response,
      providerSafety,
    },
  };
}

function withGeneration(
  event: CanonicalEventV1,
  generation: Record<string, unknown>,
): CanonicalEventV1 & {
  readonly request: CanonicalEventV1["request"] & {
    readonly generation: Record<string, unknown>;
  };
} {
  return {
    ...event,
    request: {
      ...event.request,
      generation,
    },
  };
}

function withGeminiSentResponseSchema(event: CanonicalEventV1): CanonicalEventV1 {
  const withRequest = {
    ...event,
    request: {
      ...event.request,
      providerPlane: "gemini_developer_api",
      generation: {
        responseMimeType: "application/json",
        responseJsonSchema: sentGeminiSubsetSchema(),
        geminiSchemaSanitization: {
          provider: "gemini",
          source: "adapter_boundary",
          schemaDialect: "gemini_openapi_subset",
          sentSchemaIsCanonical: true,
          changes: [{
            path: "generationConfig.responseJsonSchema.additionalProperties",
            keyword: "additionalProperties",
            action: "removed",
            reason: "Gemini Developer API schema is a limited OpenAPI subset, not full JSON Schema.",
          }],
        },
      },
    },
    usage: {
      ...event.usage,
      serviceTier: "standard",
    },
  };
  return withRequest as CanonicalEventV1;
}

function sentGeminiSubsetSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["answer"],
    properties: {
      answer: { type: "string" },
    },
  };
}
