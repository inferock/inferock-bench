import { describe, expect, it } from "vitest";
import { countOpenAiOutputTokens } from "@inferock/measure/billing-integrity";
import type {
  HiddenTokenProbe,
  HiddenTokenProviderCall,
  HiddenTokenProviderCallResult,
} from "./hidden-token.js";
import {
  hiddenTokenProbes,
  runHiddenTokenConformance,
} from "./hidden-token.js";

describe("hidden-token conformance module", () => {
  it("builds provider-supported hidden-token positive request shapes", () => {
    const probes = hiddenTokenProbes({
      providers: ["openai", "anthropic"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    });

    const chat = probes.find((probe) => probe.probeId === "hidden-token-openai-chat-positive-001");
    expect(chat?.requestBody).toMatchObject({
      model: "gpt-5.4-mini",
      reasoning_effort: "low",
      max_completion_tokens: 1024,
    });
    expect(chat?.requestBody).not.toHaveProperty("reasoning");

    const anthropic = probes.find((probe) => probe.probeId === "hidden-token-anthropic-messages-positive-001");
    expect(anthropic?.requestBody).toMatchObject({
      model: "claude-sonnet-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      max_tokens: 2048,
    });
    expect(anthropic?.requestBody.thinking).not.toHaveProperty("budget_tokens");
  });

  it("maps mocked positive OpenAI and Anthropic hidden usage into recognized categories", async () => {
    const probes = hiddenTokenProbes({
      providers: ["openai", "anthropic"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    }).filter((probe) => probe.kind === "positive");

    const result = await runHiddenTokenConformance({
      runId: "conformance_20260708T120000Z_hidden01",
      probes,
      providerCall: positiveHiddenProviderCall,
    });

    expect(result.entries.map((entry) => entry.providerSurface).sort()).toEqual([
      "anthropic_messages",
      "chat_completions",
      "openai_responses",
    ]);
    for (const entry of result.entries) {
      expect(entry).toMatchObject({
        mode: "real_provider",
        module: "hidden_token",
        status: "passed",
        openability: {
          surfaceOpened: true,
          status: "watched_clean",
        },
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
      });
      expect(entry.rawEvidence.recognizedHiddenOutputTokens).toBeGreaterThan(0);
      expect(entry.rawEvidence.hiddenCategoryNames).not.toEqual([]);
      expect(entry.rawEvidence.billedEmptyFired).toBe(false);
      expect(entry.detectors.billedEmptyFired).toBe(false);
    }

    const chat = result.entries.find((entry) => entry.providerSurface === "chat_completions");
    expect(chat?.canonical.openAiRecount).toMatchObject({
      knownHiddenOutputTokens: 7,
      billedVisibleOutputTokens: countOpenAiOutputTokens("gpt-5.4-mini", "Visible answer."),
      billedVsRecountDeltaTokens: 0,
      openAiTokenRecountMismatchFired: false,
    });
    expect(chat?.detectors.signalCodes).not.toContain("OPENAI_TOKEN_RECOUNT_MISMATCH");

    const anthropic = result.entries.find((entry) => entry.providerSurface === "anthropic_messages");
    expect(anthropic?.canonical.anthropicCrossCheck).toMatchObject({
      thinkingTokens: 9,
      billedVisibleOutputTokens: 0,
      anthropicTokenCrossCheckFired: false,
    });
  });

  it("records negative controls without cleaning the positive hidden-token surface", async () => {
    const probes = hiddenTokenProbes({
      providers: ["openai", "anthropic"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    }).filter((probe) => probe.kind !== "positive");

    const result = await runHiddenTokenConformance({
      runId: "conformance_20260708T120000Z_hidden02",
      probes,
      providerCall: negativeControlProviderCall,
    });

    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry).toMatchObject({
        status: "passed",
        providerSurface: "hidden_token_negative_control",
        openability: {
          surfaceOpened: true,
          status: "watched_clean",
        },
      });
      expect(entry.rawEvidence.recognizedHiddenOutputTokens).toBe(0);
      expect(entry.rawEvidence.hiddenCategoryNames).toEqual([]);
      expect(entry.rawEvidence.billedEmptyFired).toBe(false);
      expect(entry.providerRecognizedEligible).toBe(false);
    }

    const callerOwned = result.entries.find((entry) => entry.probeId.includes("openai"));
    expect(callerOwned?.validationMetadata).toContain("caller_owned_control");
    expect(callerOwned?.rawEvidence.requestMode).toBe("caller_owned_control");

    const realProviderNegative = result.entries.find((entry) => entry.probeId.includes("anthropic"));
    expect(realProviderNegative?.validationMetadata).toContain("real_provider_negative_control");
    expect(realProviderNegative?.rawEvidence.requestMode).toBe("real_provider_negative_control");
  });

  it("marks a positive real response with no hidden tokens inconclusive and not-openable", async () => {
    const [probe] = hiddenTokenProbes({
      providers: ["openai"],
      models: {
        openai: "gpt-5.4-mini",
        anthropic: "claude-sonnet-5",
      },
    }).filter((entry) => entry.providerSurface === "openai_responses");
    if (!probe) throw new Error("missing OpenAI Responses hidden-token probe");

    const result = await runHiddenTokenConformance({
      runId: "conformance_20260708T120000Z_hidden03",
      probes: [probe],
      providerCall: async (input) => ({
        requestId: `${input.probeId}-request`,
        startedAt: "2026-07-08T12:00:00.000Z",
        endedAt: "2026-07-08T12:00:01.000Z",
        statusCode: 200,
        rawUsage: { input_tokens: 8, output_tokens: 3 },
        content: "Visible answer.",
        finishReason: "stop",
      }),
    });

    expect(result.entries[0]).toMatchObject({
      status: "inconclusive",
      openability: {
        surfaceOpened: false,
        status: "not_openable",
        reason: "hidden-token surface not opened; provider returned no recognized reasoning/thinking usage",
      },
    });
    expect(result.entries[0]?.openability.status).not.toBe("watched_clean");
    expect(result.entries[0]?.rawEvidence.recognizedHiddenOutputTokens).toBe(0);
    expect(result.entries[0]?.detectors.billedEmptyFired).toBe(false);
  });
});

const positiveHiddenProviderCall: HiddenTokenProviderCall = async (probe) => {
  if (probe.providerSurface === "openai_responses") {
    return response(probe, {
      rawUsage: {
        input_tokens: 10,
        output_tokens: 11,
        output_tokens_details: { reasoning_tokens: 11 },
      },
      content: "",
      responseId: "resp_hidden_positive",
    });
  }
  if (probe.providerSurface === "chat_completions") {
    const visible = "Visible answer.";
    const visibleTokens = countOpenAiOutputTokens(probe.model, visible);
    return response(probe, {
      rawUsage: {
        prompt_tokens: 10,
        completion_tokens: visibleTokens + 7,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
      content: visible,
      responseId: "chatcmpl_hidden_positive",
    });
  }
  return response(probe, {
    rawUsage: {
      input_tokens: 10,
      output_tokens: 9,
      output_tokens_details: { thinking_tokens: 9 },
    },
    content: "",
    responseId: "msg_hidden_positive",
  });
};

const negativeControlProviderCall: HiddenTokenProviderCall = async (probe) =>
  response(probe, {
    rawUsage: probe.providerSurface === "chat_completions"
      ? { prompt_tokens: 8, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 0 } }
      : { input_tokens: 8, output_tokens: 2, output_tokens_details: { thinking_tokens: 0 } },
    content: "Hello there.",
    responseId: `${probe.probeId}-response`,
  });

function response(
  probe: HiddenTokenProbe,
  input: {
    readonly rawUsage: HiddenTokenProviderCallResult["rawUsage"];
    readonly content: string;
    readonly responseId: string;
  },
): HiddenTokenProviderCallResult {
  return {
    requestId: `${probe.probeId}-request`,
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    statusCode: 200,
    rawUsage: input.rawUsage,
    content: input.content,
    finishReason: "stop",
    responseId: input.responseId,
  };
}
