import { describe, expect, it } from "vitest";
import { summarizeBenchEvents } from "../summary.js";
import type { StoredBenchEvent } from "../storage.js";
import type { CoverageEstimate } from "../coverage-suite/estimate.js";
import type { LoadedCoverageSuiteManifest } from "../coverage-suite/manifest.js";
import { createSpeedTestReceiptBundle } from "../coverage-suite/runner.js";
import { dollarizeDriftCanaryRegression } from "./dollarization.js";
import {
  __driftCanaryTestHooks,
  driftCanaryAffectedCallsInWindow,
  type PlannedDriftCanaryCall,
  type DriftCanaryRunResult,
} from "./runner.js";
import type { DriftCanaryDollarizationResult } from "./dollarization.js";
import { driftCanarySuiteTaskId, type LoadedDriftCanaryManifest } from "./manifest.js";

const MODEL = "gpt-4o-mini-2024-07-18";
const RUN_ID = "flagged";
const DRIFT_WINDOW = {
  since: "2026-07-04T10:00:00.000Z",
  until: "2026-07-04T11:00:00.000Z",
};
const TEST_PROTOCOL = {
  protocolVersion: "sha256:test-protocol",
  promptSetVersion: "drift-canary-prompt-set-v1",
  temperatureMode: "fixed_0" as const,
  maxTokenParameter: "max_tokens" as const,
  maxTokenBound: 64,
  requestRoute: "chat.completions" as const,
};

describe("drift canary request compatibility", () => {
  it("builds GPT-5 canary calls with max_completion_tokens, a 256-token lower bound, and provider-default temperature", () => {
    const body = __driftCanaryTestHooks.requestBodyForCanaryCall(
      testManifest({ maxTokens: 64 }),
      plannedCall({ provider: "openai", model: "gpt-5-mini" }),
    );

    expect(body).toMatchObject({
      model: "gpt-5-mini",
      max_completion_tokens: 256,
      messages: [
        { role: "system", content: "Answer exactly." },
        { role: "user", content: expect.stringContaining("Return only the final numeric answer.") },
      ],
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("builds Anthropic canary calls with provider-default temperature", () => {
    const body = __driftCanaryTestHooks.requestBodyForCanaryCall(
      testManifest({ maxTokens: 64 }),
      plannedCall({ provider: "anthropic", model: "claude-sonnet-5-20260601" }),
    );

    expect(body).toMatchObject({
      model: "claude-sonnet-5-20260601",
      max_tokens: 64,
      system: "Answer exactly.",
      messages: [{ role: "user", content: expect.stringContaining("Return only the final numeric answer.") }],
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps temperature 0 for Anthropic canary calls on older Messages models", () => {
    const body = __driftCanaryTestHooks.requestBodyForCanaryCall(
      testManifest({ maxTokens: 64 }),
      plannedCall({ provider: "anthropic", model: "claude-haiku-4-5-20251001" }),
    );

    expect(body).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      temperature: 0,
      max_tokens: 64,
    });
  });

  it("builds OpenRouter Moonshot canary calls with provider-default temperature", () => {
    const body = __driftCanaryTestHooks.requestBodyForCanaryCall(
      testManifest({ maxTokens: 64 }),
      plannedCall({ provider: "openrouter", model: "moonshotai/kimi-k2.7-code" }),
    );

    expect(body).toMatchObject({
      model: "moonshotai/kimi-k2.7-code",
      max_tokens: 64,
      messages: [
        { role: "system", content: "Answer exactly." },
        { role: "user", content: expect.stringContaining("Return only the final numeric answer.") },
      ],
    });
    expect(body).not.toHaveProperty("temperature");
  });
});

describe("drift canary protocol baselines", () => {
  it("does not compare a current run against complete baselines from another protocol version", () => {
    const manifest = testManifest({ maxTokens: 64 });
    const selectedModel = { provider: "openai", model: "gpt-5-mini" } as const;
    const currentProtocol = __driftCanaryTestHooks.driftCanaryEffectiveProtocol(
      manifest,
      selectedModel,
    ).protocolVersion;
    const records = [
      storedCanaryEvent({ runId: "old-1", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:00:00.000Z" }),
      storedCanaryEvent({ runId: "old-2", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:10:00.000Z" }),
      storedCanaryEvent({ runId: "old-3", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:20:00.000Z" }),
      storedCanaryEvent({ runId: "new-1", protocolVersion: currentProtocol, startedAt: "2026-07-04T10:00:00.000Z" }),
    ];

    const result = __driftCanaryTestHooks.evaluateDriftCanaryModel({
      runId: "new-1",
      manifest,
      selectedModel,
      records,
    });

    expect(result.status).toBe("baseline_collecting");
    expect(result.protocolVersion).toBe(currentProtocol);
    expect(result.baseline).toBeUndefined();
    expect(result.stats).toBeUndefined();
    expect(result.baselineCollection).toEqual({
      completedPriorRuns: 0,
      requiredRuns: 3,
    });
  });

  it("restarts baseline collection when the protocol flips mid-history", () => {
    const manifest = testManifest({ maxTokens: 64 });
    const selectedModel = { provider: "openai", model: "gpt-5-mini" } as const;
    const currentProtocol = __driftCanaryTestHooks.driftCanaryEffectiveProtocol(
      manifest,
      selectedModel,
    ).protocolVersion;
    const records = [
      storedCanaryEvent({ runId: "old-1", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:00:00.000Z" }),
      storedCanaryEvent({ runId: "old-2", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:10:00.000Z" }),
      storedCanaryEvent({ runId: "old-3", protocolVersion: "sha256:old-protocol", startedAt: "2026-07-04T09:20:00.000Z" }),
      storedCanaryEvent({ runId: "new-1", protocolVersion: currentProtocol, startedAt: "2026-07-04T10:00:00.000Z" }),
      storedCanaryEvent({ runId: "new-2", protocolVersion: currentProtocol, startedAt: "2026-07-04T10:10:00.000Z" }),
      storedCanaryEvent({ runId: "new-3", protocolVersion: currentProtocol, startedAt: "2026-07-04T10:20:00.000Z" }),
    ];

    const result = __driftCanaryTestHooks.evaluateDriftCanaryModel({
      runId: "new-3",
      manifest,
      selectedModel,
      records,
    });

    expect(result.status).toBe("baseline_collecting");
    expect(result.baselineCollection).toEqual({
      completedPriorRuns: 2,
      requiredRuns: 3,
    });
    expect(result.currentRun?.protocolVersion).toBe(currentProtocol);
  });
});

describe("drift canary runner dollarization", () => {
  it("publishes one whole-call floor for duplicate, event-floor, and drift-window clean calls", () => {
    const records = [
      storedWindowEvent({
        requestId: "customer-duplicate",
        startedAt: "2026-07-04T09:50:00.000Z",
        content: "ordinary answer",
        outputTokens: 4,
      }),
      storedWindowEvent({
        requestId: "customer-duplicate",
        startedAt: "2026-07-04T10:10:00.000Z",
        content: "ordinary duplicate answer",
        outputTokens: 4,
      }),
      storedWindowEvent({
        requestId: "customer-event-floor",
        startedAt: "2026-07-04T10:20:00.000Z",
        content: "not json",
        generation: { response_format: { type: "json_object" } },
        outputTokens: 4,
      }),
      storedWindowEvent({
        requestId: "customer-clean",
        startedAt: "2026-07-04T10:30:00.000Z",
        content: "ordinary answer",
        outputTokens: 4,
      }),
    ];
    const summary = summarizeBenchEvents(records, { runId: RUN_ID });
    const affectedCalls = driftCanaryAffectedCallsInWindow(records, {
      provider: "openai",
      model: MODEL,
      ...DRIFT_WINDOW,
      floorSummaryWindow: { runId: RUN_ID },
    });

    const duplicate = requiredAffectedCall(affectedCalls, "customer-duplicate");
    const eventFloor = requiredAffectedCall(affectedCalls, "customer-event-floor");
    const clean = requiredAffectedCall(affectedCalls, "customer-clean");
    expect(affectedCalls.filter((call) => call.requestId === "customer-duplicate")).toHaveLength(1);
    expect(duplicate).toMatchObject({
      costUsd: expect.any(Number),
      appliedCostUsd: 0,
      supersededByExistingFloor: {
        signalCode: "DUPLICATE_REQUEST_ID",
        standardLossMethod: "call_cost_floor_v1",
      },
    });
    expect(eventFloor).toMatchObject({
      costUsd: expect.any(Number),
      appliedCostUsd: 0,
      supersededByExistingFloor: {
        signalCode: "BROKEN_OUTPUT",
        standardLossMethod: "call_cost_floor_v1",
      },
    });
    expect(clean.appliedCostUsd ?? clean.costUsd).toBe(clean.costUsd);
    expect(clean.supersededByExistingFloor).toBeUndefined();

    const duplicateRow = summary.rows.find((row) => row.code === "DUPLICATE_REQUEST_ID");
    expect(duplicateRow?.standardLossUsd).toBe(duplicate.costUsd);

    const drift = flaggedDriftDollarization(affectedCalls);
    const receipt = createSpeedTestReceiptBundle({
      runId: RUN_ID,
      status: "completed",
      startedAt: "2026-07-04T09:45:00.000Z",
      endedAt: "2026-07-04T11:00:00.000Z",
      consentedAt: "2026-07-04T09:45:00.000Z",
      estimate: TEST_ESTIMATE,
      summary,
      suite: TEST_SUITE,
      driftCanary: driftCanaryResult(drift),
    });

    expect(drift.standardLossUsd).toBe(clean.costUsd);
    expect(receipt.totals.standardLossUsd).toBe(roundUsd(summary.standardLossUsd + clean.costUsd));
    expect(receipt.totals.recognitionGapUsd).toBe(roundUsd(summary.recognitionGapUsd + clean.costUsd));
    expect(receipt.totals.standardLossUsd).toBeLessThan(
      roundUsd(summary.standardLossUsd + duplicate.costUsd + eventFloor.costUsd + clean.costUsd),
    );
    expect(receipt.totals.recognitionGapUsd).toBeLessThan(
      roundUsd(summary.recognitionGapUsd + duplicate.costUsd + eventFloor.costUsd + clean.costUsd),
    );
    expect(drift.computationTrace).toMatchObject({
      inputs: {
        supersededCallCount: 2,
        affectedRequestIds: expect.arrayContaining([
          expect.objectContaining({
            requestId: "customer-duplicate",
            appliedCostUsd: 0,
            standardLossSupersessionReason: "one_call_cost_floor_per_call",
          }),
          expect.objectContaining({
            requestId: "customer-event-floor",
            appliedCostUsd: 0,
            standardLossSupersessionReason: "one_call_cost_floor_per_call",
          }),
        ]),
      },
    });
  });
});

function plannedCall(input: PlannedDriftCanaryCall["selectedModel"]): PlannedDriftCanaryCall {
  return {
    selectedModel: input,
    item: {
      itemId: "gsm8k-1",
      dataset: "gsm8k_platinum",
      sourceRow: 1,
      sourceSplit: "test",
      sourceConfig: "main",
      cleaningStatus: "clean",
      question: "What is 20 + 22?",
      expectedAnswer: "42",
    },
    estimatedCostUsd: 0.001,
  };
}

function testManifest(input: { readonly maxTokens: number }): LoadedDriftCanaryManifest {
  return {
    schemaVersion: "inferock-drift-canary-manifest-v1",
    suiteVersion: "inferock-drift-canary-v1",
    methodVersion: "drift-canary-method-v1-2026-07-04",
    baselineRunCount: 3,
    alpha: 0.05,
    protocol: {
      promptSetVersion: "drift-canary-prompt-set-v1",
      temperature: 0,
      temperatureMode: "fixed_0_unless_provider_rejects",
      providerDefaultTemperatureModels: [
        "anthropic:claude-4.7-plus-or-5",
        "openai:gpt-5-or-o-series",
        "openrouter:moonshotai/kimi-k2.7-code",
      ],
      maxTokens: input.maxTokens,
      maxCompletionTokensLowerBound: 256,
      route: "chat.completions",
      systemPrompt: "Answer exactly.",
      grading: "exact",
      flagging: "binomial",
    },
    provenance: {
      gsm8kPlatinum: {
        sourceUrl: "https://example.test/gsm8k",
        sourceDataUrl: "https://example.test/gsm8k.jsonl",
        license: "MIT",
        selection: "test",
      },
      mmlu: {
        sourceUrl: "https://example.test/mmlu",
        sourceDataUrl: "https://example.test/mmlu.jsonl",
        license: "MIT",
        selection: "test",
      },
      simpleEvals: {
        sourceUrl: "https://example.test/simple-evals",
        license: "MIT",
        use: "test",
      },
      excludedCode: {
        source: "none",
        reason: "test",
      },
    },
    citations: [],
    items: [plannedCall({ provider: "openai", model: "gpt-5-mini" }).item],
    manifestHash: "sha256:test",
  };
}

function storedCanaryEvent(input: {
  readonly runId: string;
  readonly protocolVersion: string;
  readonly startedAt: string;
  readonly provider?: "openai" | "anthropic";
  readonly model?: string;
  readonly content?: string;
}): StoredBenchEvent {
  const provider = input.provider ?? "openai";
  const model = input.model ?? "gpt-5-mini";
  const content = input.content ?? "42";
  const endedAt = new Date(Date.parse(input.startedAt) + 1_000).toISOString();
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: endedAt,
    runId: input.runId,
    suiteTaskId: driftCanarySuiteTaskId("gsm8k-1"),
    driftCanaryProtocolVersion: input.protocolVersion,
    event: {
      schemaVersion: "v2",
      request: {
        tenantId: "local",
        provider,
        requestId: `${input.runId}-request`,
        requestedModel: model,
        model,
        attemptIndex: 0,
        expectCompletion: true,
        route: provider === "anthropic" ? "anthropic_messages" : "chat_completions",
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content,
        servedModel: model,
        servedModelSource: "provider_response",
      },
      usage: {
        input: 100,
        output: 10,
        cache: { read: 0, creation: 0 },
        categories: [
          { category: "input", tokens: 100, provider },
          { category: "output", tokens: 10, provider },
        ],
        usageSource: "provider",
      },
      timing: {
        startedAt: input.startedAt,
        endedAt,
        latencyMs: 1_000,
        chunkCount: 0,
        terminalStatus: "complete",
      },
      attempts: [{
        attemptNumber: 0,
        provider,
        model,
        status: "success",
        timing: {
          startedAt: input.startedAt,
          endedAt,
          latencyMs: 1_000,
        },
        finalSelected: true,
      }],
    },
  };
}

function storedWindowEvent(input: {
  readonly requestId: string;
  readonly startedAt: string;
  readonly content: string;
  readonly outputTokens?: number;
  readonly generation?: Record<string, unknown>;
}): StoredBenchEvent {
  const endedAt = new Date(Date.parse(input.startedAt) + 1_000).toISOString();
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: endedAt,
    runId: RUN_ID,
    event: {
      schemaVersion: "v2",
      request: {
        tenantId: "local",
        provider: "openai",
        requestId: input.requestId,
        requestedModel: MODEL,
        model: MODEL,
        attemptIndex: 0,
        expectCompletion: true,
        route: "chat.completions",
        ...(input.generation ? { generation: input.generation } : {}),
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: input.content,
        servedModel: MODEL,
        servedModelSource: "provider_response",
      },
      usage: {
        input: 100,
        output: input.outputTokens ?? 10,
        cache: { read: 0, creation: 0 },
        categories: [
          { category: "input", tokens: 100, provider: "openai" },
          { category: "output", tokens: input.outputTokens ?? 10, provider: "openai" },
        ],
        usageSource: "provider",
      },
      timing: {
        startedAt: input.startedAt,
        endedAt,
        latencyMs: 1_000,
        chunkCount: 0,
        terminalStatus: "complete",
      },
      attempts: [{
        attemptNumber: 0,
        provider: "openai",
        model: MODEL,
        status: "success",
        timing: {
          startedAt: input.startedAt,
          endedAt,
          latencyMs: 1_000,
        },
        finalSelected: true,
      }],
    },
  };
}

function requiredAffectedCall<T extends { readonly requestId: string }>(
  calls: readonly T[],
  requestId: string,
): T {
  const call = calls.find((candidate) => candidate.requestId === requestId);
  if (!call) throw new Error(`Expected affected call ${requestId}`);
  return call;
}

function flaggedDriftDollarization(
  affectedCalls: Parameters<typeof dollarizeDriftCanaryRegression>[0]["affectedCalls"],
): DriftCanaryDollarizationResult {
  return dollarizeDriftCanaryRegression({
    provider: "openai",
    model: MODEL,
    baseline: {
      runIds: ["baseline-1", "baseline-2", "baseline-3"],
      passed: 150,
      total: 150,
      accuracy: 1,
    },
    current: {
      runId: RUN_ID,
      passed: 30,
      total: 50,
      accuracy: 0.6,
    },
    alpha: 0.05,
    pValue: 0.001,
    lastGoodRunId: "baseline-3",
    firstFlaggedRunId: RUN_ID,
    window: DRIFT_WINDOW,
    affectedCalls,
  });
}

function driftCanaryResult(dollarization: DriftCanaryDollarizationResult): DriftCanaryRunResult {
  return {
    status: "completed",
    runId: RUN_ID,
    manifestHash: "sha256:test-drift-canary",
    callsLaunched: 50,
    plannedCallCount: 50,
    models: [{
      provider: "openai",
      model: MODEL,
      status: "drift_flagged",
      manifestHash: "sha256:test-drift-canary",
      protocolVersion: TEST_PROTOCOL.protocolVersion,
      effectiveProtocol: TEST_PROTOCOL,
      currentRun: {
        runId: RUN_ID,
        protocolVersion: TEST_PROTOCOL.protocolVersion,
        passed: 30,
        total: 50,
        accuracy: 0.6,
        startedAt: DRIFT_WINDOW.since,
        endedAt: DRIFT_WINDOW.until,
      },
      baseline: {
        protocolVersion: TEST_PROTOCOL.protocolVersion,
        runIds: ["baseline-1", "baseline-2", "baseline-3"],
        passed: 150,
        total: 150,
        accuracy: 1,
      },
      stats: {
        flagged: true,
        pValue: 0.001,
        baselineAccuracy: 1,
        currentAccuracy: 0.6,
        alpha: 0.05,
      },
      itemResults: [],
      dollarization,
    }],
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const TEST_ESTIMATE: CoverageEstimate = {
  estimateHash: "sha256:test-estimate",
  suiteVersion: "inferock-coverage-suite-v1",
  driftCanaryManifestHash: "sha256:test-drift-canary",
  baselineVersion: "coverage-token-baseline-v1",
  baselineContentDigest: "sha256:test-baseline",
  generator: "built-in",
  spendCapUsd: 1,
  selectedModels: [{ provider: "openai", model: MODEL }],
  estimatedTokensByCategory: { input: 0, output: 0 },
  estimatedUsdByModel: [{
    provider: "openai",
    model: MODEL,
    estimatedUsd: 0,
    plannedCalls: 0,
  }],
  estimatedUsd: 0,
  pricing: [{
    provider: "openai",
    model: MODEL,
    pricingVersion: "test",
    source: "test",
    pricingStatus: "priced",
  }],
};

const TEST_SUITE: LoadedCoverageSuiteManifest = {
  schemaVersion: "inferock-coverage-suite-manifest-v1",
  suiteVersion: "inferock-coverage-suite-v1",
  methodVersion: "test",
  defaultGenerator: "built-in",
  modelPresetPolicy: "pricing-registry-cheapest-compatible",
  estimateDefaults: {
    defaultSpendCapMultiplier: 1,
  },
  tasks: [],
  surfaces: [],
  manifestHash: "sha256:test-suite",
};
