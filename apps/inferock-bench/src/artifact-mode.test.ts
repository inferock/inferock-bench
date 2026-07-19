import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalEventV2 } from "@inferock/measure/canonical-event";
import { ensureBenchHome, resolveBenchPaths } from "./config.js";
import { createReceiptBundle, writeReceiptBundle } from "./receipt.js";
import { writeShareCard } from "./share-card.js";
import { createStoredBenchEvent, JsonlEventStore } from "./storage.js";
import { summarizeBenchEvents } from "./summary.js";

describe("local artifact modes", () => {
  it("writes bench home, events, receipts, and share cards as owner-only", async () => {
    const parent = await mkdtemp(join(tmpdir(), "inferock-bench-artifact-mode-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: join(parent, "bench-home") });

    await ensureBenchHome(paths);
    expect(await mode(paths.homeDir)).toBe(0o700);

    const store = new JsonlEventStore(paths.eventsFile);
    await store.append(createStoredBenchEvent(v2Event("req-artifact-mode")));
    expect(await mode(paths.eventsFile)).toBe(0o600);

    const receiptPath = await writeReceiptBundle(
      paths.receiptsDir,
      createReceiptBundle(summarizeBenchEvents([])),
    );
    expect(await mode(paths.receiptsDir)).toBe(0o700);
    expect(await mode(receiptPath)).toBe(0o600);

    const shareCardPath = await writeShareCard(paths.receiptsDir, "2026-07-18T12:00:00.000Z", "card");
    expect(await mode(shareCardPath)).toBe(0o600);
  });
});

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

function v2Event(requestId: string): CanonicalEventV2 {
  return {
    schemaVersion: "v2",
    request: {
      tenantId: "local",
      provider: "openai",
      requestId,
      requestedModel: "gpt-4o-mini",
      model: "gpt-4o-mini",
      attemptIndex: 0,
      expectCompletion: true,
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "ok",
      servedModel: "gpt-4o-mini",
      servedModelSource: "provider_response",
    },
    usage: {
      input: 10,
      output: 2,
      cache: { read: 0, creation: 0 },
      categories: [
        { category: "input", tokens: 10, provider: "openai" },
        { category: "output", tokens: 2, provider: "openai" },
      ],
      usageSource: "provider",
    },
    timing: {
      startedAt: "2026-07-04T12:00:00.000Z",
      endedAt: "2026-07-04T12:00:01.000Z",
      latencyMs: 1_000,
      chunkCount: 0,
      terminalStatus: "complete",
    },
    attempts: [{
      attemptNumber: 0,
      provider: "openai",
      model: "gpt-4o-mini",
      status: "success",
      timing: {
        startedAt: "2026-07-04T12:00:00.000Z",
        endedAt: "2026-07-04T12:00:01.000Z",
        latencyMs: 1_000,
      },
      finalSelected: true,
    }],
  };
}
