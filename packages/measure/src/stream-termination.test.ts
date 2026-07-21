import { describe, expect, it } from "vitest";
import type { CanonicalEventV1 } from "./canonical-event.js";
import { runStreamTerminationDetectors } from "./stream-termination.js";

describe("stream termination detector", () => {
  it("stream-termination-local-harness-abort: preserves local abort origin as evidence-only", () => {
    const event = {
      schemaVersion: "v2",
      request: {
        tenantId: "tenant-stream",
        provider: "openai",
        requestId: "req-local-abort",
        requestedModel: "gpt-4o-mini",
        model: "gpt-4o-mini",
        attemptIndex: 0,
        expectCompletion: true,
        workloadClass: "coding_agent",
        generation: { stream: true },
      },
      response: {
        statusCode: 200,
        finishReason: "client_abort",
        content: "partial",
        servedModel: "gpt-4o-mini",
        stopDetails: {
          clientAbort: {
            origin: "local_harness",
            reason: "agent_wall_time_budget",
          },
        },
      },
      usage: {
        input: 10,
        output: 1,
        usageSource: "provider",
        categories: [
          { category: "input", tokens: 10, provider: "openai" },
          { category: "output", tokens: 1, provider: "openai" },
        ],
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:00:01.000Z",
        latencyMs: 1_000,
        chunkCount: 1,
        firstEventAt: "2026-06-14T12:00:00.100Z",
        firstContentDeltaAt: "2026-06-14T12:00:00.200Z",
        lastChunkAt: "2026-06-14T12:00:00.900Z",
        terminalStatus: "aborted",
      },
      attempts: [{
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
      }],
    } as unknown as CanonicalEventV1;

    expect(runStreamTerminationDetectors(event)).toEqual([
      expect.objectContaining({
        code: "STREAM_CLIENT_ABORTED",
        status: "triage_only",
        evidenceGrade: "triage_only",
        category: "stream_aborted_before_terminal_state",
        evidence: expect.objectContaining({
          reason: "stream_local_harness_abort_confirmed",
          terminationAttribution: "local_harness",
          abortOrigin: "local_harness",
          abortReason: "agent_wall_time_budget",
        }),
        valueJson: expect.objectContaining({
          terminationAttribution: "local_harness",
          abortOrigin: "local_harness",
          abortReason: "agent_wall_time_budget",
          evidenceOnly: true,
        }),
      }),
    ]);
  });
});
