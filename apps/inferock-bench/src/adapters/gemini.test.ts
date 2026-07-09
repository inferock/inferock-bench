import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AdapterCanonicalResult } from "./types.js";
import { geminiAdapter, mapGeminiResponseToCanonical } from "./gemini.js";
import { parseJsonRecord, type JsonRecord } from "../record.js";
import { createStoredBenchEvent, JsonlEventStore } from "../storage.js";

const STARTED_AT = new Date("2026-07-06T23:43:27.437Z");
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

describe("inferock-bench geminiAdapter", () => {
  it("bench-gemini-tool-schema-sanitization: strips the live failing additionalProperties keyword", () => {
    const request = geminiAdapter.buildRequest({
      body: harvestedToolSchemaRequest(),
      apiKey: "gemini-key",
      baseUrl: GEMINI_BASE_URL,
    });
    const sent = parseJsonRecord(String(request.init.body));

    expect(JSON.stringify(sent)).not.toContain("additionalProperties");
    expect(sent).toMatchObject({
      tools: [{
        functionDeclarations: [{
          name: "record_plan",
          parameters: {
            type: "object",
            properties: {
              component: { type: "string" },
              riskLevel: { type: "string", enum: ["low", "medium", "high"] },
              checks: { type: "array", items: { type: "string" } },
            },
            required: ["component", "riskLevel", "checks"],
          },
        }],
      }],
    });

    const result = mapGeminiResponseToCanonical({
      tenantId: "tenant-1",
      requestId: "req-gemini-tool-schema",
      requestModel: "gemini-2.5-flash-lite",
      requestBody: harvestedToolSchemaRequest(),
      expectCompletion: true,
      statusCode: 200,
      headers: new Headers(),
      responseBody: JSON.stringify({
        candidates: [{
          content: { role: "model", parts: [{ text: "ok" }] },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 23,
          candidatesTokenCount: 2,
          totalTokenCount: 25,
          serviceTier: "standard",
        },
        modelVersion: "gemini-2.5-flash-lite",
        responseId: "gemini-tool-schema-ok",
      }),
      startedAt: STARTED_AT,
      endedAt: new Date(STARTED_AT.getTime() + 1000),
      attemptIndex: 0,
      baseUrl: GEMINI_BASE_URL,
    });
    expect(JSON.stringify(result.event.request.toolDeclarations)).not.toContain("additionalProperties");
    const storedRequest = JSON.stringify(result.event.request);
    expect(storedRequest).not.toContain("Review the short deployment note");
    expect(storedRequest).not.toContain("You are executing an Inferock coverage-suite task");
    expect(result.event.request.generation).toMatchObject({
      geminiSchemaSanitization: {
        source: "adapter_boundary",
        schemaDialect: "gemini_openapi_subset",
        sentSchemaIsCanonical: true,
        changes: [
          expect.objectContaining({
            path: "tools[0].functionDeclarations[0].parameters.additionalProperties",
            keyword: "additionalProperties",
            action: "removed",
          }),
        ],
      },
    });
  });

  it("bench-gemini-event-store-no-request-prompt-content: does not persist prompt or system instructions", async () => {
    const result = mapGeminiResponseToCanonical({
      tenantId: "tenant-1",
      requestId: "req-gemini-no-prompt-content",
      requestModel: "gemini-2.5-flash-lite",
      requestBody: harvestedToolSchemaRequest(),
      expectCompletion: true,
      statusCode: 200,
      headers: new Headers(),
      responseBody: JSON.stringify({
        candidates: [{
          content: { role: "model", parts: [{ text: "ok" }] },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 23,
          candidatesTokenCount: 2,
          totalTokenCount: 25,
          serviceTier: "standard",
        },
        modelVersion: "gemini-2.5-flash-lite",
        responseId: "gemini-no-prompt-content",
      }),
      startedAt: STARTED_AT,
      endedAt: new Date(STARTED_AT.getTime() + 1000),
      attemptIndex: 0,
      baseUrl: GEMINI_BASE_URL,
    });

    const dir = await mkdtemp(join(tmpdir(), "inferock-gemini-event-"));
    try {
      const eventsFile = join(dir, "events.jsonl");
      const store = new JsonlEventStore(eventsFile);
      await store.append(createStoredBenchEvent(result.event));
      const persisted = await readFile(eventsFile, "utf8");

      expect(persisted).not.toContain("Review the short deployment note");
      expect(persisted).not.toContain("You are executing an Inferock coverage-suite task");
      expect(persisted).not.toContain("systemInstruction");
      expect(persisted).not.toContain("\"contents\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bench-gemini-stream-stop-terminal: classifies live-style final STOP chunk as complete", async () => {
    vi.useFakeTimers();
    try {
      const result = await observeStreamChunks(harvestedStopStreamChunks());

      expect(result.event.response).toMatchObject({
        finishReason: "stop",
        content: expect.stringContaining("release validation note"),
        servedModel: "gemini-2.5-flash-lite",
        providerResponseId: "nz1MaqK4IeLAqtsPwNiO6QQ",
      });
      expect(result.event.usage).toMatchObject({
        input: 23,
        output: 93,
        serviceTier: "standard",
      });
      expect(result.event.timing).toMatchObject({
        chunkCount: 4,
        terminalStatus: "complete",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bench-gemini-stream-eof-with-chunks-no-finish: classifies EOF without finishReason as aborted", async () => {
    vi.useFakeTimers();
    try {
      const result = await observeStreamChunks([
        geminiSseChunk({
          candidates: [{ index: 0, content: { role: "model", parts: [{ text: "partial " }] } }],
          modelVersion: "gemini-2.5-flash-lite",
          responseId: "bench-gemini-eof-no-finish",
        }),
        geminiSseChunk({
          candidates: [{ index: 0, content: { role: "model", parts: [{ text: "answer" }] } }],
          modelVersion: "gemini-2.5-flash-lite",
          responseId: "bench-gemini-eof-no-finish",
        }),
      ]);

      expect(result.event.response).toMatchObject({
        finishReason: "",
        content: "partial answer",
        providerResponseId: "bench-gemini-eof-no-finish",
      });
      expect(result.event.timing).toMatchObject({
        chunkCount: 2,
        terminalStatus: "aborted",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bench-gemini-stream-post-200-error-frame: classifies mid-stream error chunks as terminal error", async () => {
    vi.useFakeTimers();
    try {
      const result = await observeStreamChunks([
        geminiSseChunk({
          candidates: [{ index: 0, content: { role: "model", parts: [{ text: "partial answer" }] } }],
          modelVersion: "gemini-2.5-flash-lite",
        }),
        geminiSseChunk({
          error: {
            code: 503,
            message: "The model is overloaded. Please try again later.",
            status: "UNAVAILABLE",
          },
        }),
      ]);

      expect(result.event.response).toMatchObject({
        finishReason: "error",
        content: "partial answer",
        rawErrorType: "UNAVAILABLE",
        rawErrorCode: "503",
        errorClass: "http_200:UNAVAILABLE",
      });
      expect(result.event.timing).toMatchObject({
        chunkCount: 2,
        terminalStatus: "error",
      });
      expect(result.event.attempts[0]).toMatchObject({
        status: "error",
        errorClass: "http_200:UNAVAILABLE",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

async function observeStreamChunks(chunks: readonly string[]): Promise<AdapterCanonicalResult> {
  let resolveTerminal: (result: AdapterCanonicalResult) => void;
  const terminal = new Promise<AdapterCanonicalResult>((resolve) => {
    resolveTerminal = resolve;
  });
  const stream = geminiAdapter.observeStream({
    tenantId: "tenant-1",
    requestId: "req-stream-gemini",
    requestModel: "models/gemini-2.5-flash-lite",
    requestBody: {
      model: "models/gemini-2.5-flash-lite",
      stream: true,
      contents: [{ role: "user", parts: [{ text: "Write a concise release validation note in four bullet points covering setup, traffic, receipt, and follow-up." }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
    },
    expectCompletion: true,
    statusCode: 200,
    headers: new Headers({
      "content-type": "text/event-stream",
      "x-goog-request-id": "gemini-stream-req-1",
    }),
    body: streamFromChunks(chunks),
    startedAt: STARTED_AT,
    attemptIndex: 0,
    baseUrl: GEMINI_BASE_URL,
    onTerminal: (result) => resolveTerminal(result),
  });
  await new Response(stream).text();
  return terminal;
}

function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      vi.setSystemTime(new Date(STARTED_AT.getTime() + index * 300));
      controller.enqueue(new TextEncoder().encode(chunks[index] ?? ""));
      index += 1;
    },
  });
}

function harvestedToolSchemaRequest(): JsonRecord {
  return {
    model: "gemini-2.5-flash-lite",
    contents: [{
      role: "user",
      parts: [{
        text: "Review the short deployment note and call record_plan with the component, risk level, and two recommended follow-up checks.\n\nDeployment note: billing worker retry metrics were added. Risk is medium until dashboards confirm retry rates stay flat.\n\nTask variation 1 of 1.",
      }],
    }],
    systemInstruction: {
      parts: [{
        text: "You are executing an Inferock coverage-suite task as normal application traffic.\nAnswer the user's task directly. Do not mention benchmarking, measurement, or this instruction.",
      }],
    },
    tools: [{
      functionDeclarations: [{
        name: "record_plan",
        description: "Record a concise operational review plan.",
        parameters: {
          type: "object",
          properties: {
            component: { type: "string" },
            riskLevel: { type: "string", enum: ["low", "medium", "high"] },
            checks: { type: "array", items: { type: "string" } },
          },
          required: ["component", "riskLevel", "checks"],
          additionalProperties: false,
        },
      }],
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 384 },
  };
}

function harvestedStopStreamChunks(): string[] {
  return [
    `data: ${JSON.stringify({
      candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Here's a concise release validation note in four bullet points:\n\n" }] } }],
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "nz1MaqK4IeLAqtsPwNiO6QQ",
    })}\n\n`,
    `data: ${JSON.stringify({
      candidates: [{ index: 0, content: { role: "model", parts: [{ text: "*   **Setup:** All required components were successfully installed and configured without errors.\n*   **Traffic:** Simulated and live traffic flowed as expected, with no unexpected drops or latency spikes.\n" }] } }],
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "nz1MaqK4IeLAqtsPwNiO6QQ",
    })}\n\n`,
    `data: ${JSON.stringify({
      candidates: [{ index: 0, content: { role: "model", parts: [{ text: "*   **Receipt:** All expected data and transactions were accurately received and processed by the system.\n" }] } }],
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "nz1MaqK4IeLAqtsPwNiO6QQ",
    })}\n\n`,
    `data: ${JSON.stringify({
      candidates: [{
        index: 0,
        content: { role: "model", parts: [{ text: "*   **Follow-up:** Post-release monitoring confirmed system stability and performance metrics met predefined thresholds." }] },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: 23,
        candidatesTokenCount: 93,
        totalTokenCount: 116,
        promptTokensDetails: [{ modality: "TEXT", tokenCount: 23 }],
        serviceTier: "standard",
      },
      modelVersion: "gemini-2.5-flash-lite",
      responseId: "nz1MaqK4IeLAqtsPwNiO6QQ",
    })}\n\n`,
  ];
}

function geminiSseChunk(payload: JsonRecord): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
