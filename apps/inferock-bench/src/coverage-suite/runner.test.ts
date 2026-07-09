import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProviderFetch } from "../proxy.js";
import type { EventStore, StoredBenchEvent } from "../storage.js";
import { loadCoverageTokenBaselineFromValue } from "./baseline.js";
import { estimateCoverageSuite } from "./estimate.js";
import { loadCoverageSuiteManifest } from "./manifest.js";
import {
  createMeasuredCoverageTokenBaseline,
  migrateSpeedTestReceiptBundle,
  renderSpeedTestReceipt,
  runBuiltInCoverageSuite,
} from "./runner.js";
import {
  LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION,
  SPEEDTEST_RECEIPT_SCHEMA_VERSION,
} from "../receipt-schema.js";

class MemoryStore implements EventStore {
  readonly records: StoredBenchEvent[] = [];

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

describe("built-in coverage-suite runner", () => {
  it("runs suite tasks through the local proxy with run/task annotations and emits a speed-test receipt", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = [{ provider: "openai" as const, model: "gpt-4o-mini-2024-07-18" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];

    const result = await runBuiltInCoverageSuite({
      runId: "run-speed-test",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      env: {},
      store,
      providerFetch: mockProviderFetch(providerCalls),
      log: () => undefined,
      startedAt: "2026-07-04T12:00:00.000Z",
      consentedAt: "2026-07-04T12:00:00.000Z",
    });

    expect(result.receipt.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(result.receipt.run).toMatchObject({
      runId: "run-speed-test",
      status: "completed",
      generator: "built-in",
      suiteVersion: suite.suiteVersion,
    });
    expect(result.receipt.consent.estimate.estimateHash).toBe(estimate.estimateHash);
    expect(result.receipt.coverage.runId).toBe("run-speed-test");
    expect(result.receipt.coverage.totalSurfaceCount).toBeGreaterThan(0);
    expect(store.records.length).toBeGreaterThan(0);
    expect(store.records.every((record) => record.runId === "run-speed-test")).toBe(true);
    expect(store.records.map((record) => record.suiteTaskId)).toContain("known_answer_contract");
    expect(store.records.map((record) => record.suiteTaskId)).toContain("openai_responses_structured");
    expect(store.records.map((record) => record.suiteTaskId)).toContain("drift_canary:gsm8k_platinum_01");
    expect(result.receipt.consent.estimate.driftCanaryManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.receipt.driftCanary).toMatchObject({
      status: "completed",
      plannedCallCount: 50,
      models: [{
        status: "baseline_collecting",
        baselineCollection: {
          completedPriorRuns: 0,
          requiredRuns: 3,
        },
      }],
    });
    const canaryRecord = store.records.find((record) => record.suiteTaskId === "drift_canary:gsm8k_platinum_01");
    expect(canaryRecord?.event.request.workloadClass).toBe("drift_canary");
    expect(canaryRecord?.driftCanaryProtocolVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.receipt.driftCanary?.models[0]?.protocolVersion).toBe(canaryRecord?.driftCanaryProtocolVersion);
    // Stone-2 corollary: surfaces-watched N/M must not count unopened drift surfaces while the baseline is still collecting.
    expect(result.receipt.coverage.surfaces.find((surface) => surface.surfaceId === "drift_regression")).toMatchObject({
      status: "not_openable",
      label: "not-openable: drift canary baseline collecting (0/3)",
      notOpenableReason: "drift canary baseline collecting (0/3)",
    });
    expect(providerCalls.some((call) => call.url.endsWith("/responses"))).toBe(true);
    expect(providerCalls.some((call) => JSON.stringify(call.body).includes("factualityContract"))).toBe(false);
    expect(providerCalls.some((call) => JSON.stringify(call.body).includes("x-inferock"))).toBe(false);
  });

  it("migrates legacy v2 speed-test combined dollars without promoting duration dollars into money headline", () => {
    const migrated = migrateSpeedTestReceiptBundle({
      schemaVersion: LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION,
      run: {
        runId: "speedtest-legacy",
        status: "completed",
        generator: "built-in",
        suiteVersion: "suite-v1",
        startedAt: "2026-07-04T12:00:00.000Z",
        endedAt: "2026-07-04T12:01:00.000Z",
        selectedModels: [{ provider: "openai", model: "gpt-4o-mini" }],
      },
      consent: {
        consentedAt: "2026-07-04T12:00:00.000Z",
        estimate: {
          estimateHash: "sha256:test",
          baselineVersion: "baseline",
          baselineContentDigest: "sha256:baseline",
          estimatedTokensByCategory: {},
          estimatedUsd: 0,
          estimatedUsdBand: { low: 0, expected: 0, high: 0 },
          pricing: [],
          driftCanaryManifestHash: "sha256:drift",
        },
        spendCapUsd: 1,
      },
      totals: {
        measuredCalls: 1,
        providerSpendUsd: 0.01,
        standardLossUsd: 7.77,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 7.77,
        unrecognizedUsd: 7.77,
        failures: 1,
      },
      rows: [{
        code: "LATENCY_BILLED",
        failureClass: "latency",
        evidenceGrade: "unrecognized_standard_loss",
        count: 1,
        standardLossUsd: 7.77,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 7.77,
        unrecognizedUsd: 7.77,
        pricingUnknownCount: 0,
        howComputed: ["legacy latency dollarized under v2"],
      }],
      coverage: {
        suiteVersion: "suite-v1",
        methodVersion: "method-v1",
        runId: "speedtest-legacy",
        watchedCount: 0,
        totalSurfaceCount: 0,
        signalCount: 0,
        notOpenableCount: 0,
        surfaces: [],
      },
      assumptions: legacyAssumptions(),
      watermark: { name: "Inferock Bench", url: "https://inferock.opiusai.com" },
    });

    expect(migrated?.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(migrated?.totals.legacyCombinedStandardLossUsd).toBe(7.77);
    expect(migrated?.totals.money.standardLossUsd).toBe(0);
    expect(migrated?.rows[0]).toMatchObject({
      primaryValueKind: "time_loss",
      dollarTranslationUsd: 7.77,
      legacyCompatibilityLabel: "legacy dollarized latency",
    });
    expect(renderSpeedTestReceipt(migrated!)).toContain(
      "legacy combined standard loss: $7.77 (legacy dollarized latency/downtime not included in v3 money loss)",
    );
  });

  it("records a measured per-task baseline artifact from real captured runner events", async () => {
    const suite = await loadCoverageSuiteManifest();
    const outputDir = await mkdtemp(join(tmpdir(), "inferock-record-baseline-"));
    const outputPath = join(outputDir, "coverage-suite-v1.tokens.json");
    const records = suite.tasks.map((task, index): StoredBenchEvent => storedMeasuredEvent({
      taskId: task.taskId,
      input: 100 + index,
      output: 20 + index,
    }));

    const baseline = await createMeasuredCoverageTokenBaseline({
      suite,
      records,
      outputPath,
      generatedAt: "2026-07-04T12:00:00.000Z",
      sourceCommit: "test-commit",
      benchPackageVersion: "0.1.3",
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
    });

    expect(baseline.tasks).toHaveLength(suite.tasks.length);
    expect(baseline.tasks.every((task) => task.provenance === "covrun_measured")).toBe(true);
    expect(loadCoverageTokenBaselineFromValue(baseline, suite).baselineVersion).toMatch(/^sha256:/);
    expect(await readFile(outputPath, "utf8")).toContain("\"covrun_measured\"");
  });

  it("rejects measured baseline writes without source commit provenance", async () => {
    const suite = await loadCoverageSuiteManifest();
    const records = suite.tasks.map((task, index): StoredBenchEvent => storedMeasuredEvent({
      taskId: task.taskId,
      input: 100 + index,
      output: 20 + index,
    }));

    await expect(createMeasuredCoverageTokenBaseline({
      suite,
      records,
      generatedAt: "2026-07-04T12:00:00.000Z",
      benchPackageVersion: "0.1.3",
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
    })).rejects.toThrow(/without git source commit provenance/i);
  });

  it("kills before launching calls when the spend cap cannot cover the next task", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = [{ provider: "openai" as const, model: "gpt-4o-mini-2024-07-18" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 0.000001,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const store = new MemoryStore();
    let providerCalls = 0;

    const result = await runBuiltInCoverageSuite({
      runId: "run-cap-kill",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      env: {},
      store,
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
      log: () => undefined,
      startedAt: "2026-07-04T12:00:00.000Z",
      consentedAt: "2026-07-04T12:00:00.000Z",
    });

    expect(result.status).toBe("killed");
    expect(result.statusReason).toBe("spend cap reached — run incomplete");
    expect(result.receipt.run.status).toBe("killed");
    expect(providerCalls).toBe(0);
    expect(store.records).toHaveLength(0);
  });

  it("gemini-coverage-runner-response-format: sends sanitized responseJsonSchema to Gemini", async () => {
    const suite = minimalGeminiResponseSchemaSuite();
    const baseline = loadCoverageTokenBaselineFromValue(minimalBaselineForSuite(suite), suite);
    const selectedModels = [{ provider: "gemini" as const, model: "gemini-2.5-flash-lite" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const abort = new AbortController();

    await runBuiltInCoverageSuite({
      runId: "run-gemini-response-format",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", geminiApiKey: "provider-gemini" },
      env: {},
      store,
      providerFetch: geminiProviderFetch(providerCalls),
      log: () => undefined,
      startedAt: "2026-07-04T12:00:00.000Z",
      consentedAt: "2026-07-04T12:00:00.000Z",
      abortSignal: abort.signal,
      onProgress: (event) => {
        if (event.type === "task_completed") abort.abort();
      },
    });

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.url).toContain(":generateContent");
    const generationConfig = providerCalls[0]?.body.generationConfig as Record<string, unknown> | undefined;
    expect(generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        required: ["answer"],
        properties: {
          answer: { type: "string" },
        },
      },
    });
    expect(JSON.stringify(generationConfig)).not.toContain("additionalProperties");
    expect(store.records[0]?.event.request.generation).toMatchObject({
      responseJsonSchema: {
        type: "object",
        required: ["answer"],
        properties: {
          answer: { type: "string" },
        },
      },
      geminiSchemaSanitization: {
        sentSchemaIsCanonical: true,
      },
    });
  });

  it("openrouter-coverage-runner-moonshot-parameter-compatibility: omits unsupported temperature", async () => {
    const suite = minimalOpenRouterMoonshotSuite();
    const baseline = loadCoverageTokenBaselineFromValue(minimalOpenRouterBaselineForSuite(suite), suite);
    const selectedModels = [{ provider: "openrouter" as const, model: "moonshotai/kimi-k2.7-code" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-07T04:00:00.000Z",
    });
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const abort = new AbortController();

    await runBuiltInCoverageSuite({
      runId: "run-openrouter-moonshot",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", openrouterApiKey: "sk-or-provider" },
      env: {},
      store,
      providerFetch: openRouterProviderFetch(providerCalls),
      log: () => undefined,
      startedAt: "2026-07-04T12:00:00.000Z",
      consentedAt: "2026-07-04T12:00:00.000Z",
      abortSignal: abort.signal,
      onProgress: (event) => {
        if (event.type === "task_completed") abort.abort();
      },
    });

    const chatCall = providerCalls.find((call) => call.url.endsWith("/chat/completions"));
    expect(chatCall?.body).toMatchObject({
      model: "moonshotai/kimi-k2.7-code",
      stream: true,
      stream_options: { include_usage: true },
      provider: {
        order: ["moonshotai/int4"],
        only: ["moonshotai/int4"],
        allow_fallbacks: false,
        require_parameters: true,
        quantizations: ["int4"],
      },
    });
    expect(chatCall?.body).not.toHaveProperty("temperature");
    expect(store.records[0]?.event.response).toMatchObject({
      servedModel: "moonshotai/kimi-k2.7-code",
      servedModelSource: "provider_response",
    });
  });
});

function mockProviderFetch(calls: { readonly url: string; readonly body: Record<string, unknown> }[]): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/responses")) return openAiResponsesResponse(body);
    if (body.stream === true) return openAiStreamResponse(body);
    return openAiChatResponse(body);
  };
}

function geminiProviderFetch(calls: { readonly url: string; readonly body: Record<string, unknown> }[]): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return new Response(JSON.stringify({
      candidates: [{
        content: { role: "model", parts: [{ text: "{\"answer\":\"ok\",\"extra\":true}" }] },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: 90,
        candidatesTokenCount: 25,
        totalTokenCount: 115,
        serviceTier: "standard",
      },
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "gemini-suite-response-schema",
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-goog-request-id": "provider-gemini" },
    });
  };
}

function openRouterProviderFetch(calls: { readonly url: string; readonly body: Record<string, unknown> }[]): ProviderFetch {
  return async (url, init) => {
    if (url.endsWith("/models/moonshotai/kimi-k2.7-code/endpoints")) {
      return new Response(JSON.stringify({
        data: {
          endpoints: [{
            tag: "moonshotai",
            provider_name: "Moonshot AI",
            model_id: "moonshotai/kimi-k2.7-code",
            quantization: "int4",
            pricing: {
              prompt: "0.00000095",
              completion: "0.000004",
              input_cache_read: "0.00000019",
            },
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return openRouterStreamResponse(body);
  };
}

function minimalGeminiResponseSchemaSuite() {
  return {
    schemaVersion: "inferock-coverage-suite-manifest-v1",
    suiteVersion: "inferock-coverage-suite-v1",
    methodVersion: "test-method",
    defaultGenerator: "built-in",
    modelPresetPolicy: "pricing-registry-cheapest-compatible",
    estimateDefaults: {
      defaultSpendCapMultiplier: 1,
    },
    agentMode: {
      organicTaskBudget: {
        corpusTaskCount: 0,
        lowCallsPerTask: 0,
        expectedCallsPerTask: 0,
        maxCallsPerTask: 0,
        maxWallTimeMsPerTask: 0,
        estimatedUsagePerCall: { input: 0, output: 0 },
      },
    },
    manifestHash: "sha256:test-gemini-suite",
    tasks: [{
      taskId: "gemini_response_schema",
      providerRoutes: ["gemini:gemini.generateContent"],
      promptTemplate: "Return the answer as JSON.",
      requestBody: {
        temperature: 0.2,
        max_tokens: 128,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "answer_schema",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["answer"],
              properties: {
                answer: { type: "string" },
              },
            },
          },
        },
      },
      outputSchemaVersion: "answer-v1",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: {
          answer: { type: "string" },
        },
      },
      normalUsageRationale: "Structured Gemini response schema traffic.",
      opensSurfaces: ["broken_output"],
    }],
    surfaces: [{
      surfaceId: "broken_output",
      measure: "Broken output",
      label: "broken output",
      detectorCodes: ["BROKEN_OUTPUT"],
      taskIds: ["gemini_response_schema"],
      normalUsageRationale: "Structured Gemini response schema traffic.",
    }],
  } as const;
}

function minimalBaselineForSuite(suite: ReturnType<typeof minimalGeminiResponseSchemaSuite>) {
  return {
    schemaVersion: "inferock-coverage-token-baseline-v1",
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: "2026-07-04T00:00:00.000Z",
    generatedBy: "covrun",
    provenance: {
      sourcePath: "test",
      sourceCommit: "test-commit",
      benchPackageVersion: "0.1.7",
      providerModelsMeasured: ["gemini:gemini-2.5-flash-lite"],
      sampleCountByTask: { gemini_response_schema: 1 },
      notes: "test baseline",
    },
    quantile: "reviewed",
    tasks: [{
      taskId: "gemini_response_schema",
      plannedCalls: 1,
      usage: {
        input: 90,
        output: 25,
      },
    }],
  } as const;
}

function minimalOpenRouterMoonshotSuite() {
  return {
    schemaVersion: "inferock-coverage-suite-manifest-v1",
    suiteVersion: "inferock-coverage-suite-v1",
    methodVersion: "test-method",
    defaultGenerator: "built-in",
    modelPresetPolicy: "pricing-registry-cheapest-compatible",
    estimateDefaults: {
      defaultSpendCapMultiplier: 1,
    },
    agentMode: {
      organicTaskBudget: {
        corpusTaskCount: 0,
        lowCallsPerTask: 0,
        expectedCallsPerTask: 0,
        maxCallsPerTask: 0,
        maxWallTimeMsPerTask: 0,
        estimatedUsagePerCall: { input: 0, output: 0 },
      },
    },
    manifestHash: "sha256:test-openrouter-suite",
    tasks: [{
      taskId: "openrouter_moonshot_stream",
      providerRoutes: ["openrouter:openai_compatible_chat"],
      promptTemplate: "Write a short module review.",
      requestBody: {
        temperature: 0.3,
        max_tokens: 128,
        stream: true,
      },
      normalUsageRationale: "OpenRouter streaming review traffic.",
      opensSurfaces: ["stream_termination"],
    }],
    surfaces: [{
      surfaceId: "stream_termination",
      measure: "Stream termination",
      label: "stream termination",
      detectorCodes: ["STREAM_UNCONFIRMED_TERMINATION"],
      taskIds: ["openrouter_moonshot_stream"],
      normalUsageRationale: "OpenRouter streaming review traffic.",
    }],
  } as const;
}

function minimalOpenRouterBaselineForSuite(suite: ReturnType<typeof minimalOpenRouterMoonshotSuite>) {
  return {
    schemaVersion: "inferock-coverage-token-baseline-v1",
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: "2026-07-04T00:00:00.000Z",
    generatedBy: "covrun",
    provenance: {
      sourcePath: "test",
      sourceCommit: "test-commit",
      benchPackageVersion: "0.1.8",
      providerModelsMeasured: ["openrouter:moonshotai/kimi-k2.7-code"],
      sampleCountByTask: { openrouter_moonshot_stream: 1 },
      notes: "test baseline",
    },
    quantile: "reviewed",
    tasks: [{
      taskId: "openrouter_moonshot_stream",
      plannedCalls: 1,
      usage: {
        input: 100,
        output: 20,
      },
    }],
  } as const;
}

function openAiChatResponse(body: Record<string, unknown>): Response {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const message = hasTools
    ? {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_record_plan",
          type: "function",
          function: {
            name: "record_plan",
            arguments: JSON.stringify({
              component: "billing worker",
              riskLevel: "medium",
              checks: ["verify retries", "review metrics"],
            }),
          },
        }],
      }
    : { role: "assistant", content: responseContentForBody(body) };
  return new Response(JSON.stringify({
    id: "chatcmpl-suite",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    choices: [{ finish_reason: hasTools ? "tool_calls" : "stop", message }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      prompt_tokens_details: body.metadata ? { cached_tokens: 15 } : undefined,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-chat" },
  });
}

function openAiResponsesResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "resp-suite",
    object: "response",
    created_at: 1782993603,
    status: "completed",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    output_text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
    output: [{
      id: "msg-suite",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
        annotations: [],
      }],
    }],
    usage: {
      input_tokens: 90,
      output_tokens: 35,
      total_tokens: 125,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-responses" },
  });
}

function openAiStreamResponse(body: Record<string, unknown>): Response {
  const model = String(body.model ?? "gpt-4o-mini-2024-07-18");
  const text = [
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: { content: "review " }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: { content: "complete" }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 140, completion_tokens: 45, total_tokens: 185 },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "provider-stream" },
  });
}

function openRouterStreamResponse(_body: Record<string, unknown>): Response {
  const text = [
    `data: ${JSON.stringify({
      id: "gen-openrouter-stream",
      model: "moonshotai/kimi-k2.7-code-20260612",
      choices: [{ delta: { content: "review " }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "gen-openrouter-stream",
      model: "moonshotai/kimi-k2.7-code-20260612",
      choices: [{ delta: { content: "complete" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
      openrouter_metadata: {
        strategy: "direct",
        endpoints: {
          available: [{
            provider: "Moonshot AI",
            model: "moonshotai/kimi-k2.7-code-20260612",
            selected: true,
          }],
        },
      },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function responseContentForBody(body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (serialized.includes("invoice reconciliation")) return "Billing Reliability";
  if (serialized.includes("deployment checks")) return "1. Check migrations\n2. Check rollback\n3. Check metrics";
  if (serialized.includes("json_schema")) {
    return "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}";
  }
  return "The maintenance note is ready for review.";
}

function storedMeasuredEvent(input: {
  readonly taskId: string;
  readonly input: number;
  readonly output: number;
}): StoredBenchEvent {
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: "2026-07-04T12:00:00.000Z",
    runId: "run-baseline",
    suiteTaskId: input.taskId,
    event: {
      schemaVersion: "v2",
      request: {
        tenantId: "local",
        provider: "openai",
        requestId: `req-${input.taskId}`,
        requestedModel: "gpt-4o-mini-2024-07-18",
        model: "gpt-4o-mini-2024-07-18",
        attemptIndex: 0,
        expectCompletion: true,
        route: "chat.completions",
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "ok",
        servedModel: "gpt-4o-mini-2024-07-18",
        servedModelSource: "provider_response",
      },
      usage: {
        input: input.input,
        output: input.output,
        cache: { read: 0, creation: 0 },
        categories: [
          { category: "input", tokens: input.input, provider: "openai" },
          { category: "output", tokens: input.output, provider: "openai" },
        ],
        usageSource: "provider",
      },
      timing: {
        startedAt: "2026-07-04T12:00:00.000Z",
        endedAt: "2026-07-04T12:00:01.000Z",
        latencyMs: 1000,
        chunkCount: 0,
        terminalStatus: "complete",
      },
      attempts: [{
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        status: "success",
        timing: {
          startedAt: "2026-07-04T12:00:00.000Z",
          endedAt: "2026-07-04T12:00:01.000Z",
          latencyMs: 1000,
        },
        finalSelected: true,
      }],
    },
  };
}

function legacyAssumptions() {
  return {
    standardVersion: "legacy",
    timeValueRate: {
      usdPerHour: 92,
      currency: "USD",
      unit: "hour",
      label: "legacy",
      oneLineWhy: "legacy",
      overrideKey: "legacy",
    },
    activeLatencySegments: [],
    impactFooterLines: [],
  };
}

function completeBaselineForSuite(suite: Awaited<ReturnType<typeof loadCoverageSuiteManifest>>) {
  return {
    schemaVersion: "inferock-coverage-token-baseline-v1",
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: "2026-07-04T00:00:00.000Z",
    generatedBy: "covrun",
    provenance: {
      sourcePath: "/tmp/inferock-covrun-assets/",
      sourceCommit: "test-commit",
      benchPackageVersion: "0.1.3",
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 1])),
      notes: "test fixture",
    },
    quantile: "reviewed",
    tasks: suite.tasks.map((task, index) => ({
      taskId: task.taskId,
      plannedCalls: task.taskId === "concurrency_wave"
        ? 4
        : task.taskId === "identical_rerun_drift"
          ? 5
          : 1,
      provenance: "covrun_measured",
      usage: {
        input: 100 + index,
        output: 40 + index,
        cacheRead: task.taskId === "shared_prefix_cache" ? 800 : 0,
        cacheCreation: task.taskId === "shared_prefix_cache" ? 100 : 0,
      },
    })),
  } as const;
}
