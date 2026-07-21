import { readFileSync } from "node:fs";
import {
  normalizeCanonicalEvent,
  type CanonicalEventAny,
} from "@inferock/measure/canonical-event";
import { detectLatencyBilled, type LatencySloPolicy } from "@inferock/measure/latency";
import { describe, expect, it, vi } from "vitest";
import {
  createBenchApp,
  createBenchKeyCallBudget,
  type AdditionalBenchKeyGrant,
  type ProviderFetch,
} from "../proxy.js";
import { BenchRequestAnnotationRegistry } from "../coverage-suite/runner-annotations.js";
import type { EventStore, StoredBenchEvent } from "../storage.js";

class MemoryStore implements EventStore {
  readonly records: StoredBenchEvent[] = [];

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

describe("inferock-bench proxy", () => {
  it("reserves agent call-budget slots before concurrent provider dispatch and records rejected evidence", async () => {
    const store = new MemoryStore();
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_boundary_race"].join(""),
      annotation: { runId: "agent-boundary-race", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      callBudget: createBenchKeyCallBudget({ maxCalls: 4, concurrencyLimit: 4 }),
    };
    let providerCalls = 0;
    const releaseProviderResponses: Array<() => void> = [];
    const providerFetch: ProviderFetch = async () => {
      providerCalls += 1;
      await new Promise<void>((resolve) => releaseProviderResponses.push(resolve));
      return openAiChatResponse("chatcmpl-agent-boundary-race");
    };
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store,
      env: {},
      additionalBenchKeys: [grant],
      providerFetch,
      log: () => undefined,
    });

    const requests = Array.from({ length: 5 }, () =>
      app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "x-api-key": grant.key, "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-2024-07-18",
          messages: [{ role: "user", content: "hello" }],
        }),
      })
    );
    await waitUntil(() => providerCalls === 4, "expected four provider dispatches");
    releaseProviderResponses.splice(0).forEach((release) => release());
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 429]);
    expect(providerCalls).toBe(4);
    expect(grant.callBudget).toMatchObject({
      startedCalls: 4,
      completedCalls: 4,
      reservedCalls: 0,
      rejectedAttempts: 1,
      inFlightAtBound: 4,
    });
    expect(store.records).toHaveLength(5);
    const rejected = store.records.find((record) =>
      record.event.response.statusCode === 429 &&
      record.event.response.rawErrorType === "agent_call_budget_exhausted"
    );
    expect(rejected).toBeDefined();
    expect(rejected).toMatchObject({
      runId: "agent-boundary-race",
      event: {
        request: { workloadClass: "coding_agent" },
        response: {
          statusCode: 429,
          rawErrorType: "agent_call_budget_exhausted",
          errorClass: "http_429:agent_call_budget_exhausted",
          errorOrigin: "local",
        },
        attempts: [
          expect.objectContaining({
            finalSelected: true,
            errorOrigin: "local",
          }),
        ],
      },
    });
  });

  it("proxies OpenAI chat completions and stores canonical evidence", async () => {
    const store = new MemoryStore();
    const logs: string[] = [];
    const providerFetch: ProviderFetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer provider-openai");
      return new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "measured",
          },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "openai-processing-ms": "12",
          "x-request-id": "provider-request-local",
        },
      });
    };
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch,
      log: (line) => logs.push(line),
      onFirstSuccessfulCallMeasured: () => logs.push("first-call follow-up"),
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "measure this local request" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "chatcmpl-local" });
    expect(store.records).toHaveLength(1);
    const event = store.records[0]?.event;
    expect(event).toBeDefined();
    assertCanonicalV2(event);
    expect(event.response.providerRequestId).toBe("provider-request-local");
    expect(event.response.sanitizedHeaders?.["openai-processing-ms"]).toBe("12");
    expect(event.usage.usageSource).toBe("provider");
    expect(event.timing).toMatchObject({
      monotonicElapsedMs: expect.any(Number),
      monotonicClockSource: "process.hrtime.bigint",
      providerMonotonicElapsedMs: expect.any(Number),
    });
    expect(logs).toContain("first call measured ✓");
    expect(logs.indexOf("first call measured ✓")).toBeLessThan(logs.indexOf("first-call follow-up"));
  });

  it("bench-proxy-provider-timing-split: gateway-side preflight delay cannot create provider-recognized latency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    try {
      const store = new MemoryStore();
      const providerFetch: ProviderFetch = async (url) => {
        if (url.includes("/models/mistralai/mistral-large-2512/endpoints")) {
          await sleep(30_000);
          return new Response(JSON.stringify({
            endpoints: [{
              tag: "mistral",
              provider_name: "Mistral",
              model_id: "mistralai/mistral-large-2512",
              pricing: {
                prompt: "0.0000004",
                completion: "0.000002",
              },
            }],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        await sleep(1_000);
        return new Response(JSON.stringify({
          id: "gen-openrouter-latency-split",
          model: "mistralai/mistral-large-2512",
          choices: [{
            finish_reason: "stop",
            message: { role: "assistant", content: "measured" },
          }],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 2,
            total_tokens: 10,
          },
          openrouter_metadata: {
            endpoints: {
              available: [{
                selected: true,
                provider: "Mistral",
                model: "mistralai/mistral-large-2512",
              }],
            },
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-generation-id": "gen-openrouter-latency-split",
          },
        });
      };
      const app = createBenchApp({
        config: {},
        store,
        env: {
          INFEROCK_BENCH_KEY: "local",
          INFEROCK_BENCH_OPENROUTER_API_KEY: "provider-openrouter",
        },
        providerFetch,
        log: () => undefined,
      });

      const pending = app.request("/openrouter/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer local",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "mistralai/mistral-large-2512",
          messages: [{ role: "user", content: "measure this local request" }],
        }),
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(1_000);
      const response = await pending;

      expect(response.status).toBe(200);
      assertCanonicalV2(store.records[0]?.event);
      const event = store.records[0].event;
      expect(event.timing).toMatchObject({
        startedAt: "2026-06-14T12:00:00.000Z",
        providerRequestStartedAt: "2026-06-14T12:00:30.000Z",
        providerResponseEndedAt: "2026-06-14T12:00:31.000Z",
        endedAt: "2026-06-14T12:00:31.000Z",
        latencyMs: 31_000,
        providerElapsedMs: 1_000,
        gatewayOverheadMs: 30_000,
      });
      const policy: LatencySloPolicy = {
        policyId: "test-openrouter-slo",
        tenantId: "local",
        provider: "openrouter",
        model: "mistralai/mistral-large-2512",
        route: "openrouter_chat_completions",
        workloadClass: null,
        totalSloMs: 30_000,
        sloSource: "provider-slo://test/openrouter",
        sloVersion: "test-slo-v1",
        disclosedAt: "2026-01-01T00:00:00.000Z",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        creditBasis: "billed_wait",
      };
      expect(detectLatencyBilled(normalizeCanonicalEvent(event), {
        latencySloPolicy: policy,
      })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bench-proxy-gemini-missing-key-message: names Gemini env keys", async () => {
    const store = new MemoryStore();
    let providerCalls = 0;
    const providerFetch: ProviderFetch = async () => {
      providerCalls += 1;
      return new Response("{}");
    };
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
      },
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "measure this local request" }] }],
      }),
    });

    expect(response.status).toBe(503);
    const body = await response.json() as { readonly error?: { readonly message?: string } };
    expect(body.error?.message).toBe(
      "Missing Gemini provider key. Set INFEROCK_BENCH_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY locally.",
    );
    expect(providerCalls).toBe(0);
    expect(store.records).toEqual([]);
  });

  it("bench-proxy-provider-compatibility: forwards OpenAI chat through the request builder", async () => {
    const store = new MemoryStore();
    const providerFetch: ProviderFetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(JSON.parse(String(init.body))).toEqual({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "measure this local request" }],
        max_completion_tokens: 64,
      });
      return new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-5-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "measured" },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "measure this local request" }],
        max_tokens: 64,
        temperature: 0,
        metadata: { suite: "coverage" },
      }),
    });

    expect(response.status).toBe(200);
    expect(store.records).toHaveLength(1);
  });

  it("bench-proxy-provider-compatibility: strips Anthropic temperature only for Claude 4.7+/5", async () => {
    const store = new MemoryStore();
    const providerBodies: unknown[] = [];
    const providerFetch: ProviderFetch = async (url, init) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      providerBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        id: "msg-local",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-7-20260701",
        content: [{ type: "text", text: "measured" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 8,
          output_tokens: 2,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      providerFetch,
      log: () => undefined,
    });

    const newer = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7-20260701",
        messages: [{ role: "user", content: "measure this local request" }],
        max_tokens: 64,
        temperature: 0.2,
      }),
    });
    const legacy = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "measure this local request" }],
        max_tokens: 64,
        temperature: 0.2,
      }),
    });

    expect(newer.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(providerBodies[0]).not.toHaveProperty("temperature");
    expect(providerBodies[1]).toMatchObject({ temperature: 0.2 });
    expect(store.records).toHaveLength(2);
  });

  it("bench-proxy-runmeta-annotations: captures operation identity, body hash, and bench-only request annotations without forwarding them", async () => {
    const store = new MemoryStore();
    const annotations = new BenchRequestAnnotationRegistry();
    annotations.register("req-suite-1", {
      runId: "run-speed-1",
      suiteTaskId: "known_answer_contract",
      outputSchemaVersion: "coverage-suite-v1.answer",
      factualityContract: {
        contractId: "coverage-suite-v1.invoice-reconciliation-owner",
        mode: "known_answer",
        expectedAnswer: "Billing Reliability",
        matchType: "entity",
        authoritative: true,
      },
    });
    const providerFetch: ProviderFetch = async (_url, init) => {
      const headers = new Headers(init.headers);
      expect(headers.get("x-inferock-operation-id")).toBeNull();
      expect(headers.get("idempotency-key")).toBeNull();
      expect(String(init.body)).not.toContain("factualityContract");
      return new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "Billing Reliability" },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const app = createBenchApp({
      config: {},
      store,
      requestAnnotations: annotations,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
        "x-inferock-request-id": "req-suite-1",
        "x-inferock-operation-id": "checkout-01FZ6M4RFZ9T8YC7QJ6QYQ9WZP",
        "idempotency-key": "idempotency-fallback",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Who owns invoice reconciliation?" }],
      }),
    });

    expect(response.status).toBe(200);
    const stored = store.records[0];
    expect(stored).toMatchObject({
      runId: "run-speed-1",
      suiteTaskId: "known_answer_contract",
    });
    assertCanonicalV2(stored?.event);
    expect(stored.event.request).toMatchObject({
      operationId: "checkout-01FZ6M4RFZ9T8YC7QJ6QYQ9WZP",
      bodyHash: "sha256:e261f8bea068337c257fe517f355b6dd8d1051770008a7bcf30c0bd3eb4d6985",
      bodyHashAlgorithm: "sha256",
      bodyHashCanonicalization: "normalized_json_v1",
      outputSchemaVersion: "coverage-suite-v1.answer",
      factualityContract: {
        contractId: "coverage-suite-v1.invoice-reconciliation-owner",
        expectedAnswer: "Billing Reliability",
      },
    });
    expect(stored.event.request.requestId).not.toBe("req-suite-1");
  });

  it("bench-proxy-operation-id-fallback: falls back to Idempotency-Key as operation evidence and rejects invalid operation IDs", async () => {
    const store = new MemoryStore();
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch: async () => new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "ok" },
        }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
        "idempotency-key": "idem-123",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(200);
    assertCanonicalV2(store.records[0]?.event);
    expect(store.records[0].event.request.operationId).toBe("idem-123");

    const invalid = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
        "x-inferock-operation-id": "\u0001",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { type: "invalid_operation_id" },
    });
  });

  it("bench-proxy-local-request-id: generates unique canonical request IDs and treats caller IDs as operation evidence", async () => {
    const store = new MemoryStore();
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch: async () => new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "ok" },
        }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      log: () => undefined,
    });

    for (let index = 0; index < 2; index += 1) {
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer local",
          "content-type": "application/json",
          "x-request-id": "caller-reused-id",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `hello ${index}` }],
        }),
      });
      expect(response.status).toBe(200);
    }

    const [first, second] = store.records.map((record) => {
      assertCanonicalV2(record.event);
      return record.event.request;
    });
    expect(first.requestId).not.toBe("caller-reused-id");
    expect(second.requestId).not.toBe("caller-reused-id");
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.operationId).toBe("caller-reused-id");
    expect(second.operationId).toBe("caller-reused-id");
  });

  it("bench-proxy-capture-log-runmeta-scope: live capture summaries only include the current run", async () => {
    const store = new MemoryStore();
    const logs: string[] = [];
    const annotations = new BenchRequestAnnotationRegistry();
    annotations.register("ann-run-a", { runId: "run-a", suiteTaskId: "known_answer_contract" });
    annotations.register("ann-run-b", { runId: "run-b", suiteTaskId: "automatic_latency_token" });
    const app = createBenchApp({
      config: {},
      store,
      requestAnnotations: annotations,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch: async () => new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "ok" },
        }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      log: (line) => logs.push(line),
    });

    for (const annotationId of ["ann-run-a", "ann-run-b"]) {
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer local",
          "content-type": "application/json",
          "x-inferock-request-id": annotationId,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: annotationId }],
        }),
      });
      expect(response.status).toBe(200);
    }

    const liveCounters = logs.filter((line) => line.includes("money loss so far"));
    expect(liveCounters).toHaveLength(2);
    expect(liveCounters.at(-1)).toContain("measured 1 calls");
    expect(store.records.map((record) => record.runId)).toEqual(["run-a", "run-b"]);
  });

  it("bench-proxy-factuality-extension-header: captures contract locally, strips extension headers, and preserves body bytes", async () => {
    const store = new MemoryStore();
    const rawBody = [
      "{",
      "\"model\":\"gpt-4o-mini\",",
      "\"messages\":[{\"role\":\"user\",\"content\":\"Who owns invoice reconciliation?\"}],",
      "\"factualityContract\":{\"contractId\":\"body-only\",\"expectedAnswer\":\"Never capture me\"}",
      "}",
    ].join(" ");
    const providerFetch: ProviderFetch = async (_url, init) => {
      const headers = new Headers(init.headers);
      expect(headers.get("x-inferock-request-id")).toBeNull();
      expect(headers.get("x-inferock-operation-id")).toBeNull();
      expect(headers.get("x-inferock-factuality-contract")).toBeNull();
      expect(init.body).toBe(rawBody);
      return new Response(JSON.stringify({
        id: "chatcmpl-local",
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "Billing Reliability" },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
        "x-inferock-request-id": "factuality-annotation-key",
        "x-inferock-factuality-contract": JSON.stringify({
          contractId: "header-contract",
          mode: "known_answer",
          expectedAnswer: "Billing Reliability",
          matchType: "entity",
          authoritative: true,
        }),
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    assertCanonicalV2(store.records[0]?.event);
    expect(store.records[0].event.request.operationId).toBe("factuality-annotation-key");
    expect(store.records[0].event.request.factualityContract).toMatchObject({
      contractId: "header-contract",
      expectedAnswer: "Billing Reliability",
    });
    expect(JSON.stringify(store.records[0].event.request.factualityContract))
      .not.toContain("body-only");
  });

  it("proxies OpenAI Responses and stores canonical evidence from a recorded success fixture", async () => {
    const requestBody = {
      model: "gpt-5-mini",
      input: "Lookup invoice inv-123",
      max_output_tokens: 64,
      reasoning: { effort: "medium" },
    };
    const { response, event } = await requestResponsesFixture({
      requestBody,
      fixtureName: "success.json",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "resp_recorded_success" });
    assertCanonicalV2(event);
    expect(event.request).toMatchObject({
      provider: "openai",
      route: "openai.responses",
      requestedModel: "gpt-5-mini",
      generation: {
        maxOutputTokens: 64,
        reasoning: { effort: "medium" },
      },
    });
    expect(event.response).toMatchObject({
      finishReason: "completed",
      content: "Invoice inv-123 is open.",
      providerResponseId: "resp_recorded_success",
    });
    expect(event.usage.usageSource).toBe("provider");
    expect(JSON.stringify(event)).not.toContain("provider-openai");
  });

  it("bench-proxy-provider-compatibility: forwards OpenAI Responses through the shared request builder", async () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["answer"],
      properties: { answer: { type: "string" } },
    };
    const requestBody = {
      model: "gpt-5-mini",
      input: "Return JSON.",
      max_tokens: 128,
      temperature: 0,
      metadata: { suite: "coverage" },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          strict: true,
          schema,
        },
      },
    };

    const { response, store } = await requestResponsesFixture({
      requestBody,
      fixtureName: "success.json",
      expectedProviderBody: {
        model: "gpt-5-mini",
        input: "Return JSON.",
        max_output_tokens: 128,
        text: {
          format: {
            type: "json_schema",
            name: "answer",
            strict: true,
            schema,
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(store.records).toHaveLength(1);
  });

  it("bench-proxy-responses-runmeta-annotations: captures local annotations through the shared OpenAI Responses adapter", async () => {
    const annotations = new BenchRequestAnnotationRegistry();
    annotations.register("req-responses-suite", {
      runId: "run-speed-2",
      suiteTaskId: "openai_responses_structured",
      outputSchemaVersion: "coverage-suite-v1.checkpoint",
      factualityContract: {
        contractId: "coverage-suite-v1.checkpoint-owner",
        mode: "known_answer",
        expectedAnswer: "Release Engineering",
        matchType: "entity",
        authoritative: true,
      },
    });

    const { event, store } = await requestResponsesFixture({
      fixtureName: "success.json",
      requestBody: {
        model: "gpt-5-mini",
        input: "Create checkpoint",
      },
      requestHeaders: {
        "x-inferock-request-id": "req-responses-suite",
        "idempotency-key": "responses-op-1",
      },
      requestAnnotations: annotations,
    });

    expect(store.records[0]).toMatchObject({
      runId: "run-speed-2",
      suiteTaskId: "openai_responses_structured",
    });
    assertCanonicalV2(event);
    expect(event.request).toMatchObject({
      operationId: "responses-op-1",
      bodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      bodyHashAlgorithm: "sha256",
      bodyHashCanonicalization: "normalized_json_v1",
      outputSchemaVersion: "coverage-suite-v1.checkpoint",
      factualityContract: {
        contractId: "coverage-suite-v1.checkpoint-owner",
        expectedAnswer: "Release Engineering",
      },
    });
    expect(event.request.requestId).not.toBe("req-responses-suite");
  });

  it("bench-proxy-responses-factuality-extension-header: captures local factuality without forwarding extension headers", async () => {
    const { event } = await requestResponsesFixture({
      fixtureName: "success.json",
      requestBody: {
        model: "gpt-5-mini",
        input: "Who owns release checkpoints?",
      },
      requestHeaders: {
        "x-inferock-request-id": "responses-factuality-key",
        "x-inferock-factuality-contract": JSON.stringify({
          contractId: "responses-header-contract",
          mode: "known_answer",
          expectedAnswer: "Release Engineering",
          matchType: "entity",
          authoritative: true,
        }),
      },
    });

    assertCanonicalV2(event);
    expect(event.request.requestId).not.toBe("responses-factuality-key");
    expect(event.request.operationId).toBe("responses-factuality-key");
    expect(event.request.factualityContract).toMatchObject({
      contractId: "responses-header-contract",
      expectedAnswer: "Release Engineering",
    });
  });

  it("stores OpenAI Responses incomplete reasoning-only fixture evidence", async () => {
    const { event } = await requestResponsesFixture({
      fixtureName: "incomplete-reasoning-only.json",
    });

    assertCanonicalV2(event);
    expect(event.response).toMatchObject({
      finishReason: "incomplete",
      content: "",
      stopDetails: {
        incompleteDetails: {
          reason: "max_output_tokens",
        },
      },
    });
    expect(event.usage.categories).toEqual(expect.arrayContaining([
      {
        category: "reasoning",
        tokens: 24,
        sourceField: "output_tokens_details.reasoning_tokens",
      },
    ]));
    expect(event.timing.terminalStatus).toBe("complete");
  });

  it("stores OpenAI Responses refusal fixture provider safety evidence", async () => {
    const { event } = await requestResponsesFixture({
      fixtureName: "refusal.json",
    });

    assertCanonicalV2(event);
    expect(event.response).toMatchObject({
      finishReason: "incomplete",
      content: "",
    });
    expect(event.response.providerSafety).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "refusal",
        source: "provider",
        reason: "refusal",
      }),
      expect.objectContaining({
        kind: "content_filter",
        source: "provider",
        reason: "content_filter",
      }),
    ]));
  });

  it("streams OpenAI Responses SSE and captures typed terminal evidence", async () => {
    const requestBody = { model: "gpt-5-mini", input: "hello", stream: true };
    const { response, store } = await requestResponsesFixture({
      requestBody,
      fixtureName: "stream-success.sse",
      responseHeaders: { "content-type": "text/event-stream" },
      stream: true,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(fixture("stream-success.sse"));
    await waitForRecord(store, 1);
    const stored = store.records[0]?.event;
    assertCanonicalV2(stored);
    expect(stored.response).toMatchObject({
      finishReason: "completed",
      content: "hello",
      providerResponseId: "resp_stream_success",
    });
    expect(stored.timing.terminalStatus).toBe("complete");
  });

  it("bench-proxy-stream-backpressure-provider-clean: provider stream timing closes before slow client consumption", async () => {
    const store = new MemoryStore();
    const encoder = new TextEncoder();
    const chunks = [
      `data: {"id":"chatcmpl-backpressure","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"he"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-backpressure","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"llo"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-backpressure","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\n`,
      "data: [DONE]\n\n",
    ];
    const sseBody = chunks.join("");
    let providerReadCompleted = false;
    const providerFetch: ProviderFetch = async () =>
      new Response(streamFromChunks(chunks.map((chunk) => encoder.encode(chunk)), () => {
        providerReadCompleted = true;
      }), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "provider-backpressure-clean",
        },
      });
    const app = createBenchApp({
      config: {},
      store,
      env: {
        INFEROCK_BENCH_KEY: "local",
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer local",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    await waitUntil(() => providerReadCompleted, "expected provider stream to drain before client read");
    expect(store.records).toHaveLength(0);
    await sleep(50);

    expect(await response.text()).toBe(sseBody);
    await waitForRecord(store, 1);
    const event = store.records[0]?.event;
    assertCanonicalV2(event);
    const providerEndedAt = Date.parse(event.timing.providerResponseEndedAt ?? "");
    const clientEndedAt = Date.parse(event.timing.clientConsumptionEndedAt ?? "");
    expect(event.response.content).toBe("hello");
    expect(event.timing.endedAt).toBe(event.timing.providerResponseEndedAt);
    expect(Number.isFinite(providerEndedAt)).toBe(true);
    expect(Number.isFinite(clientEndedAt)).toBe(true);
    expect(clientEndedAt - providerEndedAt).toBeGreaterThanOrEqual(25);
    expect(event.attempts[0]?.timing.clientConsumptionEndedAt).toBe(event.timing.clientConsumptionEndedAt);
  });

  it("bench-proxy-local-agent-stream-cancel: records local-harness abort origin on client cancellation", async () => {
    const store = new MemoryStore();
    const encoder = new TextEncoder();
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_stream_cancel"].join(""),
      annotation: { runId: "agent-stream-cancel", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      callBudget: createBenchKeyCallBudget({ maxCalls: 2, concurrencyLimit: 1 }),
    };
    const chunks = [
      `data: {"id":"chatcmpl-local-cancel","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"he"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-local-cancel","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"llo"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-local-cancel","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\n`,
      "data: [DONE]\n\n",
    ];
    const providerFetch: ProviderFetch = async () =>
      new Response(streamFromChunks(chunks.map((chunk) => encoder.encode(chunk)), () => undefined), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "provider-local-cancel",
        },
      });
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store,
      env: {},
      additionalBenchKeys: [grant],
      providerFetch,
      log: () => undefined,
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "x-api-key": grant.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    expect((await reader?.read())?.done).toBe(false);
    await reader?.cancel();
    await waitForRecord(store, 1);
    const event = store.records[0]?.event;
    assertCanonicalV2(event);
    const stopDetails = event.response.stopDetails as Record<string, unknown> | undefined;
    expect(stopDetails?.clientAbort).toMatchObject({
      origin: "local_harness",
      reason: "coding_agent_request_cancelled",
    });
    expect(event.timing.clientConsumptionEndedAt).toBeDefined();
    expect(event.attempts[0]?.timing.clientConsumptionEndedAt).toBe(event.timing.clientConsumptionEndedAt);
  });

  it("ignores OpenAI Responses moderation:null as provider safety evidence", async () => {
    const { event } = await requestResponsesFixture({
      fixtureName: "moderation-null.json",
    });

    assertCanonicalV2(event);
    expect(event.response).toMatchObject({
      finishReason: "completed",
      content: "Hello from Responses.",
      providerResponseId: "resp_moderation_null",
    });
    expect(event.response.providerSafety ?? []).toEqual([]);
  });
});

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function openAiChatResponse(id: string): Response {
  return new Response(JSON.stringify({
    id,
    model: "gpt-4o-mini-2024-07-18",
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: "ok" },
    }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 10,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": id },
  });
}

function assertCanonicalV2(
  event: CanonicalEventAny | undefined,
): asserts event is Extract<CanonicalEventAny, { readonly schemaVersion: "v2" }> {
  expect(event?.schemaVersion).toBe("v2");
}

async function requestResponsesFixture(input: {
  readonly fixtureName: string;
  readonly requestBody?: Record<string, unknown>;
  readonly expectedProviderBody?: Record<string, unknown>;
  readonly responseHeaders?: Record<string, string>;
  readonly requestHeaders?: Record<string, string>;
  readonly requestAnnotations?: BenchRequestAnnotationRegistry;
  readonly stream?: boolean;
}): Promise<{
  readonly response: Response;
  readonly store: MemoryStore;
  readonly event: CanonicalEventAny | undefined;
}> {
  const store = new MemoryStore();
  const requestBody = input.requestBody ?? { model: "gpt-5-mini", input: "hello" };
  const bodyText = fixture(input.fixtureName);
  const providerFetch: ProviderFetch = async (url, init) => {
    expect(url).toBe("https://api.openai.com/v1/responses");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer provider-openai");
    expect(headers.get("x-inferock-request-id")).toBeNull();
    expect(headers.get("x-inferock-operation-id")).toBeNull();
    expect(headers.get("x-inferock-factuality-contract")).toBeNull();
    expect(headers.get("idempotency-key")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(input.expectedProviderBody ?? requestBody);
    expect(String(init.body)).not.toContain("factualityContract");
    return new Response(input.stream ? streamFromText(bodyText) : bodyText, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "provider-responses-local",
        ...input.responseHeaders,
      },
    });
  };
  const app = createBenchApp({
    config: {},
    store,
    env: {
      INFEROCK_BENCH_KEY: "local",
      INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
    },
    providerFetch,
    requestAnnotations: input.requestAnnotations,
    log: () => undefined,
  });

  const response = await app.request("/v1/responses", {
    method: "POST",
    headers: {
      authorization: "Bearer local",
      "content-type": "application/json",
      ...input.requestHeaders,
    },
    body: JSON.stringify(requestBody),
  });
  if (input.stream) return { response, store, event: undefined };
  expect(store.records).toHaveLength(1);
  return { response, store, event: store.records[0]?.event };
}

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/openai-responses/${name}`, import.meta.url), "utf-8");
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function streamFromChunks(
  chunks: readonly Uint8Array[],
  onClose: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
        return;
      }
      onClose();
      controller.close();
    },
  });
}

async function waitForRecord(store: MemoryStore, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (store.records.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(store.records).toHaveLength(count);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
