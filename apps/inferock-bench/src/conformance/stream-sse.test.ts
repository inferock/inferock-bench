import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBenchPaths } from "../config.js";
import { createConformanceArtifactWriter } from "./artifacts.js";
import type {
  StreamSseProbe,
  StreamSseProviderCall,
  StreamSseProviderCallResult,
} from "./provider-call.js";
import {
  runStreamSseConformance,
  streamSseProbes,
} from "./stream-sse.js";

describe("stream SSE conformance module", () => {
  it("records mocked real OpenAI Responses, OpenAI Chat, and Anthropic Messages stream evidence", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-stream-sse-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const writer = createConformanceArtifactWriter({
      paths,
      runId: "conformance_20260708T120000Z_stream01",
      createdAt: "2026-07-08T12:00:00.000Z",
      mode: "real_provider",
      modules: ["stream_sse"],
      providers: ["openai", "anthropic"],
    });
    await writer.writeManifest();
    const probes = streamSseProbes({
      providers: ["openai", "anthropic"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    });

    const result = await runStreamSseConformance({
      runId: writer.runId,
      probes,
      providerCall: mockedCompleteProviderCall,
      writer,
    });

    expect(result.entries.map((entry) => entry.providerSurface).sort()).toEqual([
      "anthropic_messages",
      "chat_completions",
      "openai_responses",
    ]);
    for (const entry of result.entries) {
      expect(entry).toMatchObject({
        schemaVersion: "inferock-real-provider-conformance-ledger-v1",
        mode: "real_provider",
        module: "stream_sse",
        status: "passed",
        openability: {
          surfaceOpened: true,
          status: "watched_clean",
        },
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
      });
      expect(entry.rawEvidence.rawFrameCount).toBeGreaterThan(1);
      expect(entry.rawEvidence.normalizedTerminalStatus).toBe("complete");
      expect(entry.rawEvidence.rawTerminalMarkers).not.toEqual([]);
      expect(entry.rawEvidence.contentDeltaCount).toBeGreaterThan(0);
      expect(entry.rawEvidence.providerReceipt).toMatchObject({
        providerRequestId: expect.any(String),
        sanitizedHeaders: expect.any(Object),
      });
      expect(entry.canonical.timing).toMatchObject({
        chunkCount: entry.rawEvidence.rawFrameCount,
        terminalStatus: "complete",
        firstEventAt: expect.any(String),
        firstByteAt: expect.any(String),
        firstContentDeltaAt: expect.any(String),
        firstTokenAt: expect.any(String),
        lastChunkAt: expect.any(String),
        timeToFirstEventMs: expect.any(Number),
        timeToFirstTokenMs: expect.any(Number),
        maxInterChunkGapMs: expect.any(Number),
        maxStreamGapMs: expect.any(Number),
      });
      expect(entry.detectors.signalCodes).toEqual([]);
    }

    const ledgerRaw = await readFile(join(writer.runDir, "ledger.jsonl"), "utf8");
    expect(ledgerRaw).toContain("stream-sse-openai-responses-001");
    expect(await readFile(join(writer.rawDir, "stream-sse-openai-chat-001.sse.ndjson"), "utf8"))
      .toContain("terminalMarker");
    expect(await readFile(join(writer.rawDir, "stream-sse-anthropic-messages-001.usage.json"), "utf8"))
      .toContain("input_tokens");
  });

  it("marks missing stream evidence and missing terminal evidence as not watched-clean", async () => {
    const probes = streamSseProbes({
      providers: ["openai"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    });
    const missingStream = await runStreamSseConformance({
      runId: "conformance_20260708T120000Z_stream02",
      probes: [probes[0] as StreamSseProbe],
      providerCall: async (probe) => ({
        requestId: `${probe.probeId}-request`,
        startedAt: "2026-07-08T12:00:00.000Z",
        endedAt: "2026-07-08T12:00:01.000Z",
        statusCode: 200,
        headers: { "x-request-id": "req-missing-stream" },
        frames: [],
        usage: { input_tokens: 8, output_tokens: 0 },
      }),
    });
    const terminalGap = await runStreamSseConformance({
      runId: "conformance_20260708T120000Z_stream03",
      probes: [probes[1] as StreamSseProbe],
      providerCall: async (probe) => ({
        requestId: `${probe.probeId}-request`,
        startedAt: "2026-07-08T12:00:00.000Z",
        endedAt: "2026-07-08T12:00:01.000Z",
        statusCode: 200,
        headers: { "x-request-id": "req-terminal-gap" },
        frames: [
          frame("2026-07-08T12:00:00.100Z", undefined, JSON.stringify({
            id: "chatcmpl-gap",
            choices: [{ delta: { content: "partial" } }],
          })),
        ],
        usage: { prompt_tokens: 8, completion_tokens: 1 },
      }),
    });

    expect(missingStream.entries[0]?.openability).toMatchObject({
      surfaceOpened: false,
      status: "not_openable",
      reason: "not a streaming request",
    });
    expect(missingStream.entries[0]?.status).toBe("not_openable");
    expect(missingStream.entries[0]?.openability.status).not.toBe("watched_clean");

    expect(terminalGap.entries[0]?.status).toBe("signal");
    expect(terminalGap.entries[0]?.openability.status).toBe("signal");
    expect(terminalGap.entries[0]?.openability.status).not.toBe("watched_clean");
    expect(terminalGap.entries[0]?.detectors.signalCodes).toEqual(["STREAM_TERMINAL_STATUS_GAP"]);
    expect(terminalGap.entries[0]?.rawEvidence.normalizedTerminalStatus).toBe("unknown");
  });

  it("stream-sse-conformance-monotonic-duration: preserves monotonic elapsed and flags wall-clock reversal", async () => {
    const [probe] = streamSseProbes({
      providers: ["openai"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    });
    expect(probe).toBeDefined();

    const result = await runStreamSseConformance({
      runId: "conformance_20260708T120000Z_stream04",
      probes: [probe as StreamSseProbe],
      providerCall: async (streamProbe) => ({
        requestId: `${streamProbe.probeId}-request`,
        startedAt: "2026-07-08T12:00:10.000Z",
        endedAt: "2026-07-08T12:00:09.000Z",
        monotonicElapsedMs: 2_500,
        monotonicClockSource: "test-monotonic-clock",
        wallClockDrift: {
          kind: "negative_wall_clock_elapsed",
          wallClockElapsedMs: -1_000,
          monotonicElapsedMs: 2_500,
          driftMs: -3_500,
        },
        statusCode: 200,
        headers: { "x-request-id": "req-monotonic-stream" },
        frames: [
          frame("2026-07-08T12:00:10.100Z", "response.created", JSON.stringify({ id: "resp_stream_clock" })),
          frame("2026-07-08T12:00:10.200Z", "response.output_text.delta", JSON.stringify({ delta: "ok" })),
          frame("2026-07-08T12:00:10.300Z", "response.completed", JSON.stringify({
            response: { id: "resp_stream_clock", status: "completed" },
          })),
        ],
        usage: { input_tokens: 8, output_tokens: 1 },
      }),
    });

    expect(result.entries[0]?.canonical.timing).toMatchObject({
      monotonicElapsedMs: 2_500,
      monotonicClockSource: "test-monotonic-clock",
      wallClockDrift: {
        kind: "negative_wall_clock_elapsed",
      },
    });
  });

  it("stream-sse-boundary-definitions: keeps first byte, parsed SSE event, and first content distinct", async () => {
    const [probe] = streamSseProbes({
      providers: ["openai"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    });
    expect(probe).toBeDefined();

    const result = await runStreamSseConformance({
      runId: "conformance_20260708T120000Z_stream05",
      probes: [probe as StreamSseProbe],
      providerCall: async (streamProbe) => ({
        requestId: `${streamProbe.probeId}-request`,
        startedAt: "2026-07-08T12:00:00.000Z",
        endedAt: "2026-07-08T12:00:01.000Z",
        monotonicElapsedMs: 1_000,
        monotonicClockSource: "test-monotonic-clock",
        firstByteAt: "2026-07-08T12:00:00.050Z",
        timeToFirstByteMs: 50,
        statusCode: 200,
        headers: { "x-request-id": "req-boundary-stream" },
        frames: [
          frame(
            "2026-07-08T12:00:00.200Z",
            "response.created",
            JSON.stringify({ id: "resp_stream_boundary" }),
            200,
          ),
          frame(
            "2026-07-08T12:00:00.450Z",
            "response.output_text.delta",
            JSON.stringify({ delta: "ok" }),
            450,
          ),
          frame(
            "2026-07-08T12:00:00.800Z",
            "response.completed",
            JSON.stringify({ response: { id: "resp_stream_boundary", status: "completed" } }),
            800,
          ),
        ],
        usage: { input_tokens: 8, output_tokens: 1 },
      }),
    });

    expect(result.entries[0]?.canonical.timing).toMatchObject({
      firstByteAt: "2026-07-08T12:00:00.050Z",
      firstEventAt: "2026-07-08T12:00:00.200Z",
      firstContentDeltaAt: "2026-07-08T12:00:00.450Z",
      firstTokenAt: "2026-07-08T12:00:00.450Z",
      timeToFirstByteMs: 50,
      timeToFirstEventMs: 200,
      timeToFirstContentDeltaMs: 450,
      timeToFirstTokenMs: 450,
      maxInterChunkGapMs: 350,
    });
  });
});

const mockedCompleteProviderCall: StreamSseProviderCall = async (probe) => {
  if (probe.providerSurface === "openai_responses") return openAiResponsesSuccess(probe);
  if (probe.providerSurface === "chat_completions") return openAiChatSuccess(probe);
  return anthropicMessagesSuccess(probe);
};

function openAiResponsesSuccess(probe: StreamSseProbe): StreamSseProviderCallResult {
  return {
    requestId: `${probe.probeId}-request`,
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    statusCode: 200,
    headers: {
      "x-request-id": "req-openai-responses",
      "openai-processing-ms": "42",
      authorization: "Bearer secret",
    },
    responseId: "resp_stream_123",
    frames: [
      frame("2026-07-08T12:00:00.100Z", "response.created", JSON.stringify({ id: "resp_stream_123" })),
      frame("2026-07-08T12:00:00.250Z", "response.output_text.delta", JSON.stringify({ delta: "First" })),
      frame("2026-07-08T12:00:00.700Z", "response.completed", JSON.stringify({
        response: { id: "resp_stream_123", status: "completed" },
      })),
    ],
    usage: { input_tokens: 12, output_tokens: 2 },
  };
}

function openAiChatSuccess(probe: StreamSseProbe): StreamSseProviderCallResult {
  return {
    requestId: `${probe.probeId}-request`,
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    statusCode: 200,
    headers: {
      "x-request-id": "req-openai-chat",
      "openai-processing-ms": "37",
    },
    responseId: "chatcmpl_stream_123",
    frames: [
      frame("2026-07-08T12:00:00.120Z", undefined, JSON.stringify({
        id: "chatcmpl_stream_123",
        choices: [{ delta: { role: "assistant" } }],
      })),
      frame("2026-07-08T12:00:00.260Z", undefined, JSON.stringify({
        id: "chatcmpl_stream_123",
        choices: [{ delta: { content: "Hello" } }],
      })),
      frame("2026-07-08T12:00:00.760Z", undefined, "[DONE]"),
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  };
}

function anthropicMessagesSuccess(probe: StreamSseProbe): StreamSseProviderCallResult {
  return {
    requestId: `${probe.probeId}-request`,
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    statusCode: 200,
    headers: {
      "anthropic-request-id": "req-anthropic-stream",
      "cf-ray": "abc",
    },
    responseId: "msg_stream_123",
    frames: [
      frame("2026-07-08T12:00:00.110Z", "message_start", JSON.stringify({
        message: { id: "msg_stream_123", type: "message" },
      })),
      frame("2026-07-08T12:00:00.300Z", "content_block_delta", JSON.stringify({
        delta: { type: "text_delta", text: "Bonjour" },
      })),
      frame("2026-07-08T12:00:00.610Z", "message_delta", JSON.stringify({
        usage: { output_tokens: 2 },
      })),
      frame("2026-07-08T12:00:00.900Z", "message_stop", "{}"),
    ],
    usage: { input_tokens: 11, output_tokens: 2 },
  };
}

function frame(
  observedAt: string,
  event: string | undefined,
  data: string,
  observedMonotonicElapsedMs?: number,
) {
  return {
    observedAt,
    ...(observedMonotonicElapsedMs !== undefined ? { observedMonotonicElapsedMs } : {}),
    ...(event ? { event } : {}),
    data,
  };
}
