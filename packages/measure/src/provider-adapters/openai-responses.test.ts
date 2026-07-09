import { describe, expect, it } from "vitest";
import {
  mapOpenAiResponsesResponseToCanonical,
  openAiResponsesAdapter,
} from "./openai-responses.js";
import type { AdapterCanonicalInput } from "./types.js";
import type { JsonRecord } from "./record.js";

const STARTED_AT = new Date("2026-06-14T12:00:00.000Z");
const ENDED_AT = new Date("2026-06-14T12:00:01.000Z");

describe("openAiResponsesAdapter", () => {
  it("openai-responses-adapter-provider-compatibility: rewrites legacy max_tokens for provider requests", () => {
    const request = openAiResponsesAdapter.buildRequest({
      body: {
        model: "gpt-5-mini",
        input: "hello",
        max_tokens: 24,
      },
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(JSON.parse(String(request.init.body))).toEqual({
      model: "gpt-5-mini",
      input: "hello",
      max_output_tokens: 24,
    });
  });

  it.each([
    ["native max_output_tokens", { max_output_tokens: 24 }, { maxOutputTokens: 24 }],
    ["legacy max_tokens", { max_tokens: 24 }, { maxTokens: 24 }],
  ])("openai-responses-adapter-request-cap-capture: %s", (_name, cap, expectedGeneration) => {
    const result = mapOpenAiResponsesResponseToCanonical(canonicalInput({
      model: "gpt-5-mini",
      input: "hello",
      ...cap,
    }));

    expect(result.event.request.generation).toEqual(expect.objectContaining(expectedGeneration));
    expect(result.event.request.generation).not.toHaveProperty("max_output_tokens");
    expect(result.event.request.generation).not.toHaveProperty("max_tokens");
    expect(result.event.response).toMatchObject({
      finishReason: "incomplete",
      stopDetails: {
        incompleteDetails: {
          reason: "max_output_tokens",
        },
      },
    });
    expect(result.event.usage.output).toBe(24);
  });
});

function canonicalInput(requestBody: JsonRecord): AdapterCanonicalInput {
  return {
    tenantId: "tenant-1",
    requestId: "req-1",
    requestModel: "gpt-5-mini",
    requestBody,
    expectCompletion: true,
    statusCode: 200,
    headers: new Headers({ "content-type": "application/json" }),
    responseBody: JSON.stringify(openAiResponsesIncompleteBody()),
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    attemptIndex: 0,
  };
}

function openAiResponsesIncompleteBody(): JsonRecord {
  return {
    id: "resp_max_output_tokens",
    object: "response",
    status: "incomplete",
    model: "gpt-5-mini-2026-06-01",
    incomplete_details: {
      reason: "max_output_tokens",
    },
    output: [],
    usage: {
      input_tokens: 12,
      output_tokens: 24,
      total_tokens: 36,
    },
  };
}
