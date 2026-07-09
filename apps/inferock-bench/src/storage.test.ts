import { describe, expect, it } from "vitest";
import type { CanonicalEventV2 } from "@inferock/measure/canonical-event";
import {
  createStoredBenchEvent,
  parseStoredBenchEventLine,
  summarizeStoredBenchEventScope,
} from "./storage.js";
import { summarizeBenchEvents } from "./summary.js";

describe("bench event storage metadata", () => {
  it("bench-storage-runmeta-sidecar: stores run and suite task metadata without mutating the canonical event", () => {
    const event = v2Event("req-run-a");
    const stored = createStoredBenchEvent(event, {
      runId: "run-speed-1",
      suiteTaskId: "json_schema_extract",
      driftCanaryProtocolVersion: "sha256:test-protocol",
    });

    expect(stored).toMatchObject({
      schemaVersion: "inferock-bench-event-v1",
      runId: "run-speed-1",
      suiteTaskId: "json_schema_extract",
      driftCanaryProtocolVersion: "sha256:test-protocol",
      event,
    });
    expect(stored.event).not.toHaveProperty("runId");
    expect(stored.event).not.toHaveProperty("suiteTaskId");
  });

  it("bench-storage-runmeta-scope: parses optional run metadata and scopes summaries to one speed-test run", () => {
    const scoped = parseStoredBenchEventLine(JSON.stringify(createStoredBenchEvent(
      v2Event("req-run-a"),
      {
        runId: "run-speed-1",
        suiteTaskId: "known_answer_contract",
        driftCanaryProtocolVersion: "sha256:test-protocol",
      },
    )));
    const other = createStoredBenchEvent(v2Event("req-run-b"), {
      runId: "run-speed-2",
      suiteTaskId: "automatic_latency_token",
    });
    const legacy = createStoredBenchEvent(v2Event("req-legacy"));

    expect(scoped).toMatchObject({
      runId: "run-speed-1",
      suiteTaskId: "known_answer_contract",
      driftCanaryProtocolVersion: "sha256:test-protocol",
    });

    const summary = summarizeBenchEvents([scoped!, other, legacy], { runId: "run-speed-1" });
    expect(summary.measuredCalls).toBe(1);
    expect(summary.coverage.runId).toBe("run-speed-1");
    expect(summarizeStoredBenchEventScope([scoped!, other, legacy], "run-speed-1"))
      .toEqual([scoped]);
  });
});

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
