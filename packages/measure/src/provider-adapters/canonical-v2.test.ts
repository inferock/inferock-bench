import { describe, expect, it } from "vitest";
import {
  canonicalTiming,
  canonicalRequest,
  createStreamTimingCapture,
  finalAttemptRecord,
  providerRequestIdFromHeaders,
  recordParsedSseEvent,
  recordStreamByte,
  recordStreamContentDelta,
  sanitizedProviderHeaders,
  streamTiming,
} from "./canonical-v2.js";
import type { AdapterCanonicalInput } from "./types.js";
import type { JsonRecord } from "./record.js";

type RequestCaptureCase = {
  readonly name: string;
  readonly provider: Parameters<typeof canonicalRequest>[1];
  readonly surface: Parameters<typeof canonicalRequest>[2];
  readonly body: JsonRecord;
  readonly expectedGeneration: JsonRecord;
};

describe("provider adapter canonical v2 request capture", () => {
  it.each<RequestCaptureCase>([
    {
      name: "openai-chat-max_tokens",
      provider: "openai",
      surface: "chat_completions",
      body: { model: "gpt-5-mini", messages: [], max_tokens: 32 },
      expectedGeneration: { maxTokens: 32 },
    },
    {
      name: "openai-chat-max_completion_tokens",
      provider: "openai",
      surface: "chat_completions",
      body: { model: "gpt-5-mini", messages: [], max_completion_tokens: 48 },
      expectedGeneration: { maxCompletionTokens: 48 },
    },
    {
      name: "openai-responses-max_output_tokens",
      provider: "openai",
      surface: "openai_responses",
      body: { model: "gpt-5-mini", input: "hello", max_output_tokens: 64 },
      expectedGeneration: { maxOutputTokens: 64 },
    },
    {
      name: "openai-responses-legacy-max_tokens",
      provider: "openai",
      surface: "openai_responses",
      body: { model: "gpt-5-mini", input: "hello", max_tokens: 80 },
      expectedGeneration: { maxTokens: 80 },
    },
    {
      name: "anthropic-max_tokens",
      provider: "anthropic",
      surface: "anthropic_messages",
      body: {
        model: "claude-3-5-sonnet-latest",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 96,
      },
      expectedGeneration: { maxTokens: 96 },
    },
  ])("captures truncation cap evidence with canonical camel-case fields: $name", (testCase) => {
    const request = canonicalRequest(
      baseInput(testCase.body),
      testCase.provider,
      testCase.surface,
    );

    expect(request.generation).toEqual(expect.objectContaining(testCase.expectedGeneration));
    expect(request.generation).not.toHaveProperty("max_tokens");
    expect(request.generation).not.toHaveProperty("max_output_tokens");
    expect(request.generation).not.toHaveProperty("max_completion_tokens");
  });

  it("captures provider-specific receipt headers for downtime attribution evidence", () => {
    expect(providerRequestIdFromHeaders(new Headers({
      "anthropic-request-id": "anthropic-req-1",
    }))).toBe("anthropic-req-1");
    expect(providerRequestIdFromHeaders(new Headers({
      "openai-request-id": "openai-req-1",
    }))).toBe("openai-req-1");
    expect(sanitizedProviderHeaders(new Headers({
      "anthropic-request-id": "anthropic-req-1",
      "openai-request-id": "openai-req-1",
    }))).toEqual({
      "anthropic-request-id": "anthropic-req-1",
      "openai-request-id": "openai-req-1",
    });
  });

  it("captures provider-attribution timing from fetch boundaries", () => {
    const startedAt = new Date("2026-07-02T12:00:00.000Z");
    const providerRequestStartedAt = new Date("2026-07-02T12:00:00.025Z");
    const providerResponseEndedAt = new Date("2026-07-02T12:00:01.025Z");
    const clientConsumptionTiming = { endedAt: new Date("2026-07-02T12:00:02.500Z") };
    const endedAt = new Date("2026-07-02T12:00:01.100Z");

    expect(canonicalTiming(startedAt, endedAt, "complete", {
      providerRequestStartedAt,
      providerResponseEndedAt,
      clientConsumptionTiming,
    })).toMatchObject({
      latencyMs: 1_100,
      providerElapsedMs: 1_000,
      gatewayOverheadMs: 100,
      clientConsumptionEndedAt: "2026-07-02T12:00:02.500Z",
    });
    expect(finalAttemptRecord({
      provider: "openai",
      model: "gpt-5-mini",
      attemptIndex: 0,
      startedAt,
      providerRequestStartedAt,
      providerResponseEndedAt,
      clientConsumptionTiming,
      endedAt,
      status: "success",
    }).timing).toMatchObject({
      providerElapsedMs: 1_000,
      gatewayOverheadMs: 100,
      clientConsumptionEndedAt: "2026-07-02T12:00:02.500Z",
    });
  });

  it("canonical-timing-monotonic-negative-wall-clock: uses monotonic elapsed and flags wall-clock reversal", () => {
    const startedAt = new Date("2026-07-02T12:00:10.000Z");
    const providerRequestStartedAt = new Date("2026-07-02T12:00:09.000Z");
    const providerResponseEndedAt = new Date("2026-07-02T12:00:08.500Z");
    const endedAt = new Date("2026-07-02T12:00:09.000Z");

    const timing = canonicalTiming(startedAt, endedAt, "complete", {
      startedAtMonotonicNs: 1_000_000_000n,
      providerRequestStartedAtMonotonicNs: 1_100_000_000n,
      providerResponseEndedAtMonotonicNs: 2_600_000_000n,
      endedAtMonotonicNs: 3_000_000_000n,
      monotonicClockSource: "test-monotonic-clock",
      providerRequestStartedAt,
      providerResponseEndedAt,
    });

    expect(timing).toMatchObject({
      latencyMs: 2_000,
      monotonicElapsedMs: 2_000,
      monotonicClockSource: "test-monotonic-clock",
      wallClockDrift: {
        kind: "negative_wall_clock_elapsed",
        wallClockElapsedMs: -1_000,
        monotonicElapsedMs: 2_000,
        driftMs: -3_000,
      },
      providerElapsedMs: 1_500,
      providerMonotonicElapsedMs: 1_500,
      providerWallClockDrift: {
        kind: "negative_wall_clock_elapsed",
        wallClockElapsedMs: -500,
        monotonicElapsedMs: 1_500,
        driftMs: -2_000,
      },
      gatewayOverheadMs: 500,
    });
  });

  it("stream-timing-boundaries: separates first byte, parsed SSE event, and first content delta", () => {
    const capture = createStreamTimingCapture();
    const startedAt = new Date("2026-07-02T12:00:00.000Z");
    const endedAt = new Date("2026-07-02T12:00:01.000Z");

    recordStreamByte(capture, {
      wallTime: new Date("2026-07-02T12:00:00.100Z"),
      monotonicNs: 100_000_000n,
      monotonicClockSource: "test-monotonic-clock",
    });
    recordParsedSseEvent(capture, {
      wallTime: new Date("2026-07-02T12:00:00.250Z"),
      monotonicNs: 250_000_000n,
      monotonicClockSource: "test-monotonic-clock",
    });
    recordStreamContentDelta(capture, {
      wallTime: new Date("2026-07-02T12:00:00.400Z"),
      monotonicNs: 400_000_000n,
      monotonicClockSource: "test-monotonic-clock",
    });

    const timing = streamTiming(startedAt, endedAt, capture, {
      startedAtMonotonicNs: 0n,
      endedAtMonotonicNs: 1_000_000_000n,
      monotonicClockSource: "test-monotonic-clock",
      clientConsumptionTiming: { endedAt: new Date("2026-07-02T12:00:02.000Z") },
    });

    expect(timing).toMatchObject({
      firstByteAt: "2026-07-02T12:00:00.100Z",
      firstEventAt: "2026-07-02T12:00:00.250Z",
      firstContentDeltaAt: "2026-07-02T12:00:00.400Z",
      firstTokenAt: "2026-07-02T12:00:00.400Z",
      timeToFirstByteMs: 100,
      timeToFirstEventMs: 250,
      timeToFirstContentDeltaMs: 400,
      timeToFirstTokenMs: 400,
      chunkCount: 1,
      clientConsumptionEndedAt: "2026-07-02T12:00:02.000Z",
    });
  });
});

function baseInput(body: JsonRecord): AdapterCanonicalInput {
  return {
    tenantId: "tenant-1",
    requestId: "req-1",
    requestModel: String(body.model ?? "provider_default"),
    requestBody: body,
    statusCode: 200,
    headers: new Headers(),
    responseBody: "",
    startedAt: new Date("2026-07-02T12:00:00.000Z"),
    endedAt: new Date("2026-07-02T12:00:00.001Z"),
    attemptIndex: 0,
  };
}
