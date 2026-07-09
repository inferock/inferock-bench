import { describe, expect, it } from "vitest";
import { createBenchApp, createBenchKeyCallBudget, type AdditionalBenchKeyGrant } from "../proxy.js";
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

describe("agent scoped bench keys", () => {
  it("rejects cross-provider, out-of-model, revoked, and expired agent keys before provider calls", async () => {
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_scope_test"].join(""),
      annotation: { runId: "agent-run-openai", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    let providerCalls = 0;
    const app = createBenchApp({
      config: {
        benchKey: "local",
        openaiApiKey: "provider-openai",
        anthropicApiKey: "provider-anthropic",
      },
      store: new MemoryStore(),
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async () => {
        providerCalls += 1;
        return openAiChatResponse();
      },
      log: () => undefined,
    });

    const crossProvider = await app.request("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(crossProvider.status).toBe(403);
    await expect(crossProvider.json()).resolves.toMatchObject({
      error: { type: "agent_bench_key_provider_scope" },
    });
    expect(providerCalls).toBe(0);

    const wrongModel = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-2024-08-06",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(wrongModel.status).toBe(403);
    await expect(wrongModel.json()).resolves.toMatchObject({
      error: { type: "agent_bench_key_model_scope" },
    });
    expect(providerCalls).toBe(0);

    grant.callBudget = createBenchKeyCallBudget({ maxCalls: 1, concurrencyLimit: 1 });
    const accepted = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(accepted.status).toBe(200);
    expect(providerCalls).toBe(1);

    grant.revokedAt = new Date().toISOString();
    const revoked = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(revoked.status).toBe(401);
    await expect(revoked.json()).resolves.toMatchObject({
      error: { type: "agent_bench_key_revoked" },
    });
    expect(providerCalls).toBe(1);
  });

  it("honors agent key expiry before provider calls", async () => {
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_expired_test"].join(""),
      annotation: { runId: "agent-run-expired", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    };
    let providerCalls = 0;
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store: new MemoryStore(),
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async () => {
        providerCalls += 1;
        return openAiChatResponse();
      },
      log: () => undefined,
    });

    const expired = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toMatchObject({
      error: { type: "agent_bench_key_expired" },
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects agent keys with no active task budget and records local evidence", async () => {
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_no_budget_test"].join(""),
      annotation: { runId: "agent-run-no-budget", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const store = new MemoryStore();
    let providerCalls = 0;
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store,
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async () => {
        providerCalls += 1;
        return openAiChatResponse();
      },
      log: () => undefined,
    });

    const rejected = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(rejected.status).toBe(429);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { type: "agent_no_active_task_budget" },
    });
    expect(providerCalls).toBe(0);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      runId: "agent-run-no-budget",
      event: {
        response: {
          statusCode: 429,
        },
      },
    });
    expect(JSON.stringify(store.records[0]?.event.response)).toContain("agent_no_active_task_budget");
  });

  it("rejects agent calls past the call budget before provider dispatch", async () => {
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_budget_test"].join(""),
      annotation: { runId: "agent-run-budget", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      callBudget: createBenchKeyCallBudget({ maxCalls: 2, concurrencyLimit: 1 }),
    };
    let providerCalls = 0;
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store: new MemoryStore(),
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async () => {
        providerCalls += 1;
        return openAiChatResponse();
      },
      log: () => undefined,
    });

    for (let index = 0; index < 2; index += 1) {
      const accepted = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "x-api-key": grant.key, "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-2024-07-18",
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(accepted.status).toBe(200);
    }

    const overBudget = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(overBudget.status).toBe(429);
    await expect(overBudget.json()).resolves.toMatchObject({
      error: { type: "agent_call_budget_exhausted" },
    });
    expect(providerCalls).toBe(2);
    expect(grant.callBudget?.startedCalls).toBe(2);
    expect(grant.callBudget?.completedCalls).toBe(2);
    expect(grant.callBudget?.reservedCalls).toBe(0);
    expect(grant.callBudget?.rejectedAttempts).toBe(1);
    expect(grant.callBudget?.inFlightAtBound).toBe(0);
  });

  it("rejects detached calls after the active task budget closes", async () => {
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_agent_detached_test"].join(""),
      annotation: { runId: "agent-run-detached", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      callBudget: createBenchKeyCallBudget({ maxCalls: 2, concurrencyLimit: 1 }),
    };
    const store = new MemoryStore();
    let providerCalls = 0;
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store,
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async () => {
        providerCalls += 1;
        return openAiChatResponse();
      },
      log: () => undefined,
    });

    const duringTask = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(duringTask.status).toBe(200);
    delete grant.callBudget;

    const afterTask = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "x-api-key": grant.key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "late detached call" }],
      }),
    });

    expect(afterTask.status).toBe(429);
    await expect(afterTask.json()).resolves.toMatchObject({
      error: { type: "agent_no_active_task_budget" },
    });
    expect(providerCalls).toBe(1);
    expect(store.records).toHaveLength(2);
    expect(store.records[1]?.event.response.statusCode).toBe(429);
  });
});

function openAiChatResponse(): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-agent-key-test",
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-key-test" },
  });
}
