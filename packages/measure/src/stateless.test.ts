import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCanonicalEvent,
  type CanonicalEventV2,
} from "./canonical-event.js";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  clearRefusalClassifierVerdicts,
  registerRefusalClassifierVerdict,
} from "./refusals.js";
import {
  estimateCostUsd,
  runStatelessDetectors,
} from "./stateless.js";
import {
  clearModelPricing,
  lookupPriceForEvent,
  registerDefaultModelPricing,
} from "./pricing.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  clearModelPricing();
  registerDefaultModelPricing();
  clearRefusalClassifierVerdicts();
  vi.restoreAllMocks();
});

describe("stateless detectors", () => {
  it("stateless-detectors-billed-empty: emits only the per-event billed-empty billing signal", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-empty",
      },
      response: {
        content: " ",
      },
      usage: {
        input: 1_000,
        output: 50,
      },
    });

    const signals = runStatelessDetectors(event);
    expect(signals).toEqual([
      expect.objectContaining({
        code: "BILLED_EMPTY",
        detector: "billing-integrity",
        failureClass: "empty_output",
      }),
    ]);
    expect(signals[0]?.costUsd).toBeGreaterThan(0);
  });

  it("stateless-detectors-billed-empty-recorded-expected-empty: suppresses explicit no-completion requests", () => {
    const fixture = readJsonFixture("openai-chat-clean.json");
    const usage = recordField(fixture, "usage");
    const cachedTokens = numberField(recordField(usage, "prompt_tokens_details"), "cached_tokens");
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: stringField(fixture, "model"),
        requestId: "req-stateless-expected-empty",
        expectCompletion: false,
      },
      response: {
        content: " ",
      },
      usage: {
        input: numberField(usage, "prompt_tokens") - cachedTokens,
        output: numberField(usage, "completion_tokens"),
        cache: { read: cachedTokens, creation: 0 },
      },
    });

    expect(runStatelessDetectors(event).map((signal) => signal.code)).not.toContain("BILLED_EMPTY");
  });

  it("stateless-detectors-exclude-stateful-duplicate: does not remember request IDs", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-stateless-duplicate",
      },
      response: {
        content: "complete answer",
      },
    });

    expect(runStatelessDetectors(event)).toEqual([]);
    expect(runStatelessDetectors(event)).toEqual([]);
  });

  it("stateless-detectors-classifier-refusal: dollarizes registered tier-1 classifier verdicts", () => {
    process.env.OPENAI_TOKEN_RECOUNT_ENABLED = "false";
    registerRefusalClassifierVerdict({
      tenantId: "tenant-stateless",
      provider: "openai",
      requestId: "req-stateless-classifier",
      isRefusal: true,
      score: 0.99,
      model: "protectai/distilroberta-base-rejection-v1",
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-classifier",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "No.",
      },
    });

    const [signal] = runStatelessDetectors(event);
    expect(signal).toMatchObject({
      code: "REFUSAL_BILLED",
      standardLossStatus: "computed",
      standardLossGrade: "unrecognized_standard_loss",
      providerRecognizedLossUsd: 0,
      evidence: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "protectai",
      },
      computationTrace: {
        method: "call_cost_floor_v1",
      },
    });
  });

  it("stateless-detectors-openai-recount: includes deterministic OpenAI token recount", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-recount",
      },
      response: {
        content: "hello",
      },
      usage: {
        input: 1,
        output: 100,
      },
    });

    expect(runStatelessDetectors(event).map((signal) => signal.code)).toContain(
      "OPENAI_TOKEN_RECOUNT_MISMATCH",
    );
  });

  it("stateless-detectors-latency-requires-slo-and-downtime: includes Wave 3 detectors without heuristic latency", () => {
    const latencyEvent = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-latency",
        route: "chat.completions",
        workloadClass: "interactive",
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:00:31.000Z",
        latencyMs: 31_000,
        providerRequestStartedAt: "2026-06-14T12:00:00.000Z",
        providerResponseEndedAt: "2026-06-14T12:00:31.000Z",
        providerElapsedMs: 31_000,
        gatewayOverheadMs: 0,
      },
      usage: {
        input: 1,
        output: 1,
      },
    });
    const downtimeEvent = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-downtime",
      },
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "overloaded",
        errorClass: "http_503:overloaded_error",
      },
      usage: {
        input: 0,
        output: 0,
      },
    });

    expect(runStatelessDetectors(latencyEvent).map((signal) => signal.code)).not.toContain(
      "LATENCY_BILLED",
    );
    expect(runStatelessDetectors(latencyEvent, {
      latencySloPolicy: {
        policyId: "00000000-0000-4000-8000-000000000901",
        tenantId: "tenant-stateless",
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
      },
    }).map((signal) => signal.code)).toContain("LATENCY_BILLED");
    expect(runStatelessDetectors(downtimeEvent).map((signal) => signal.code)).toContain(
      "PROVIDER_DOWNTIME",
    );
  });

  it("stateless-detectors-flags: can disable latency and downtime detectors", () => {
    process.env.LATENCY_DETECTOR_ENABLED = "false";
    process.env.DOWNTIME_DETECTOR_ENABLED = "false";
    const event = buildCanonicalEvent({
      response: {
        statusCode: 503,
        finishReason: "error",
        content: "overloaded",
        errorClass: "http_503:overloaded_error",
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:00.000Z",
        latencyMs: 60_000,
      },
      usage: {
        input: 100,
        output: 0,
      },
    });

    expect(runStatelessDetectors(event).map((signal) => signal.code)).not.toContain(
      "PROVIDER_DOWNTIME",
    );
    expect(runStatelessDetectors(event).map((signal) => signal.code)).not.toContain(
      "LATENCY_BILLED",
    );
  });

  it("stateless-detectors-tool-call-validity: includes schema-backed tool-call validation", () => {
    const event = normalizeCanonicalEvent({
      schemaVersion: "v2",
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        requestId: "req-stateless-tool-call",
        requestedModel: "gpt-4o-mini",
        model: "gpt-4o-mini",
        attemptIndex: 0,
        expectCompletion: true,
        toolDeclarations: [
          {
            providerSurface: "chat_completions",
            name: "lookup_invoice",
            schemaHash: "sha256:lookup-invoice",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["invoiceId"],
              properties: {
                invoiceId: { type: "string" },
              },
            },
          },
        ],
      },
      response: {
        statusCode: 200,
        finishReason: "tool_calls",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "lookup_invoice",
              arguments: "{\"invoiceId\":",
            },
          },
        ],
        rawToolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "lookup_invoice",
              arguments: "{\"invoiceId\":",
            },
          },
        ],
        servedModel: "gpt-4o-mini",
      },
      usage: {
        input: 100,
        output: 10,
        categories: [
          { category: "prompt", tokens: 100 },
          { category: "completion", tokens: 10 },
        ],
        usageSource: "provider",
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:00:01.000Z",
        latencyMs: 1_000,
        chunkCount: 1,
        terminalStatus: "complete",
      },
      attempts: [
        {
          attemptNumber: 0,
          provider: "openai",
          model: "gpt-4o-mini",
          status: "success",
          timing: {
            startedAt: "2026-06-14T12:00:00.000Z",
            endedAt: "2026-06-14T12:00:01.000Z",
            latencyMs: 1_000,
          },
          finalSelected: true,
        },
      ],
    } satisfies CanonicalEventV2);

    expect(runStatelessDetectors(event).map((signal) => signal.code)).toContain(
      "MALFORMED_TOOL_CALL",
    );
  });

  it("stateless-subpath-no-onnx: does not import the ONNX classifier path", () => {
    const statelessPath = fileURLToPath(new URL("./stateless.ts", import.meta.url));
    const source = readFileSync(statelessPath, "utf-8");

    expect(source).not.toContain("refusal-classifier");
    expect(source).not.toContain("onnxruntime-node");
    expect(source).not.toContain("./index");
  });

  it("wave5-passive-boundary-no-drift-code: never emits drift from ordinary stateless ingest", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-stateless",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-stateless-no-drift",
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "normal answer",
      },
      usage: {
        input: 12,
        output: 6,
      },
    });

    expect(runStatelessDetectors(event).map((signal) => signal.code)).not.toContain("DRIFT");
  });

  it("wave5-passive-boundary-no-drift-import: keeps detectors free of active replay dependencies", () => {
    const detectorSources = [
      "./types.ts",
      "./stateless.ts",
      "./index.ts",
    ].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf-8"));

    for (const source of detectorSources) {
      // Keep the private package needle dynamic so OSS scanners can still flag literal scope leaks.
      expect(source).not.toContain(["@inferock", "drift"].join("/"));
      expect(source).not.toContain("packages/drift");
      expect(source).not.toContain("../drift");
    }
  });
});

describe("pricing bootstrap", () => {
  it("pricing-known-model-nonzero: estimates non-zero cost for production models", () => {
    const openAiEvent = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      usage: {
        input: 1_000,
        output: 500,
        cache: { read: 0, creation: 0 },
      },
    });
    const anthropicEvent = buildCanonicalEvent({
      request: {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
      },
      usage: {
        input: 1_000,
        output: 500,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(estimateCostUsd(openAiEvent)).toBeGreaterThan(0);
    expect(estimateCostUsd(anthropicEvent)).toBeGreaterThan(0);
  });

  it("pricing-unknown-model-signal: emits pricing_unknown instead of hiding dollars as recoverable zero", () => {
    const event = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "unknown-model",
        requestId: "req-unknown-pricing",
      },
      usage: {
        input: 1_000,
        output: 500,
        cache: { read: 0, creation: 0 },
      },
    });

    expect(estimateCostUsd(event)).toBe(0);
    expect(runStatelessDetectors(event)).toContainEqual(expect.objectContaining({
      code: "PRICING_UNKNOWN",
      detector: "pricing",
      failureClass: "pricing_unknown",
      status: "pricing_unknown",
      pricingStatus: "pricing_unknown",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      liabilityParty: "unknown",
      providerRecoverableLossUsd: null,
      expectedChargeUsd: null,
      pricingVersion: null,
      evidence: expect.objectContaining({
        provider: "openai",
        model: "unknown-model",
        usageCategories: ["input", "output"],
      }),
    }));
  });

  it("pricing-openai-total-tokens-aggregate-not-billable: keeps total_tokens from making priced OpenAI events partial", () => {
    const baseEvent = buildCanonicalEvent({
      request: {
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-total-tokens-priced",
      },
      response: {
        content: "",
      },
      usage: {
        input: 100,
        output: 12,
        cache: { read: 0, creation: 0 },
      },
    });
    const event = {
      ...baseEvent,
      usage: {
        ...baseEvent.usage,
        categories: [
          { category: "prompt", tokens: 100, sourceField: "prompt_tokens" },
          { category: "completion", tokens: 12, sourceField: "completion_tokens" },
          { category: "provider:openai:total_tokens", tokens: 112, sourceField: "total_tokens" },
        ],
      },
    };

    expect(lookupPriceForEvent(event)).toMatchObject({
      ok: true,
      pricingStatus: "priced",
    });
    const signals = runStatelessDetectors(event);
    const billedEmpty = signals.find((signal) => signal.code === "BILLED_EMPTY");

    expect(billedEmpty).toMatchObject({
      code: "BILLED_EMPTY",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
    });
    expect(typeof billedEmpty?.providerRecoverableLossUsd).toBe("number");
  });
});

function readJsonFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)),
    "utf8",
  )) as Record<string, unknown>;
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`Expected fixture field ${field} to be an object.`);
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected fixture field ${field} to be a string.`);
  }
  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected fixture field ${field} to be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
