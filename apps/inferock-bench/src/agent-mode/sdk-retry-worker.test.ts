import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { createBenchApp, createBenchKeyCallBudget, type AdditionalBenchKeyGrant } from "../proxy.js";
import type { EventStore, StoredBenchEvent } from "../storage.js";
import { runSdkRetryWorker } from "./sdk-retry-worker.js";

class MemoryStore implements EventStore {
  readonly records: StoredBenchEvent[] = [];

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

describe("sdk retry worker", () => {
  it("uses the official OpenAI SDK against localhost and captures native retry metadata", async () => {
    const store = new MemoryStore();
    const grant: AdditionalBenchKeyGrant = {
      key: ["ibl", "_sdk_retry_worker"].join(""),
      annotation: { runId: "sdk-retry-run", workloadClass: "coding_agent" },
      provider: "openai",
      models: ["gpt-4o-mini-2024-07-18"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      callBudget: createBenchKeyCallBudget({ maxCalls: 3, concurrencyLimit: 1 }),
    };
    const app = createBenchApp({
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      store,
      env: {},
      additionalBenchKeys: [grant],
      providerFetch: async (_url, init) => {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer provider-openai");
        return openAiChatResponse();
      },
      log: () => undefined,
    });
    const server = await listenOnLoopback(app.fetch);
    try {
      const result = await runSdkRetryWorker({
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        proxyBaseUrl: `http://127.0.0.1:${server.port}`,
        localKey: grant.key,
        runId: "sdk-retry-run",
        store,
        log: () => undefined,
      });

      expect(result).toMatchObject({
        callsLaunched: 1,
        evidenceObserved: true,
        status: "completed",
      });
      expect(JSON.stringify(store.records[0]?.event.request)).toContain('"x-stainless-retry-count":"0"');
      expect(JSON.stringify(store.records[0]?.event.request)).toContain('"x-inferock-request-origin":"sdk_retry_probe"');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("redacts local and provider-shaped keys from SDK failure logs", async () => {
    const store = new MemoryStore();
    const localKey = ["ibl", "_sdk_retry_secret_12345678"].join("");
    const providerKey = ["s", "k", "-sdk-retry-secret-12345678"].join("");
    const server = await listenOnLoopback(() =>
      new Response(JSON.stringify({
        error: {
          message: `provider echoed ${localKey} and ${providerKey}`,
        },
      }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    const logs: string[] = [];
    try {
      const result = await runSdkRetryWorker({
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        proxyBaseUrl: `http://127.0.0.1:${server.port}`,
        localKey,
        runId: "sdk-retry-redaction-run",
        store,
        log: (line) => logs.push(line),
      });

      expect(result.status).toBe("not_openable");
      expect(logs.join("\n")).not.toContain(localKey);
      expect(logs.join("\n")).not.toContain(providerKey);
      expect(logs.join("\n")).toContain("<redacted:ibl_...>");
      expect(logs.join("\n")).toContain("<redacted:sk-...>");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });
});

async function listenOnLoopback(fetchHandler: (request: Request) => Response | Promise<Response>):
  Promise<{ readonly port: number; close(callback: (error?: Error) => void): void }> {
  return await new Promise((resolve) => {
    const server = serve({
      fetch: fetchHandler,
      hostname: "127.0.0.1",
      port: 0,
    }, (info) => {
      resolve({
        port: info.port,
        close: (callback) => server.close(callback),
      });
    });
  });
}

function openAiChatResponse(): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-sdk-retry-worker",
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
    usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-sdk-retry" },
  });
}
