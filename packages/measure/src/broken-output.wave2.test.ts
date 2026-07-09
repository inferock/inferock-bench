import type { CanonicalEventV1 } from "./canonical-event.js";
import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import { detectBrokenOutput } from "./broken-output.js";
import { isBilledButEmpty } from "./signal.js";
import { runStatelessDetectors } from "./stateless.js";

const TENANT_ID = "tenant-broken-output-wave2";
const ANTHROPIC_MODEL = "claude-fable-5";

type EventWithUsageCategories = CanonicalEventV1 & {
  readonly usage: CanonicalEventV1["usage"] & {
    readonly categories: readonly {
      readonly category: string;
      readonly tokens: number;
      readonly sourceField?: string;
    }[];
  };
};

describe("wave2 Anthropic empty and truncation correctness", () => {
  it("anthropic-thinking-only-visible-empty: hidden thinking tokens do not create BILLED_EMPTY", () => {
    const event = anthropicEvent({
      requestId: "req-anthropic-thinking-empty",
      finishReason: "end_turn",
      content: "",
      output: 12,
      categories: [
        {
          category: "reasoning",
          tokens: 12,
          sourceField: "output_tokens_details.thinking_tokens",
        },
      ],
    });

    expect(isBilledButEmpty(event)).toBe(false);
    expect(detectBrokenOutput(event)).toBeNull();
    expect(runStatelessDetectors(event)).toEqual([]);
  });

  it("anthropic-empty-end-turn-documented: keeps detecting billed empty end_turn without hidden output", () => {
    const signal = detectBrokenOutput(anthropicEvent({
      requestId: "req-anthropic-empty-end-turn",
      finishReason: "end_turn",
      content: "",
      output: 3,
    }));

    expect(signal).toMatchObject({
      code: "BILLED_EMPTY",
      failureClass: "empty_output",
      evidence: {
        provider: "anthropic",
        finishReason: "end_turn",
        outputTokens: 3,
        hiddenOutputTokens: 0,
        documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons",
      },
    });
  });

  it("gemini-thinking-only-empty: emits BILLED_EMPTY only for reconciled billed thinking", () => {
    const pricedThinking = geminiEvent({
      requestId: "req-gemini-thinking-empty",
      categories: [
        {
          category: "gemini_thinking",
          tokens: 7,
          sourceField: "thoughtsTokenCount",
        },
      ],
    });
    const unverifiedThinking = geminiEvent({
      requestId: "req-gemini-thinking-unverified",
      categories: [
        {
          category: "gemini_thinking_unverified",
          tokens: 7,
          sourceField: "thoughtsTokenCount",
        },
      ],
    });

    expect(isBilledButEmpty(pricedThinking)).toBe(true);
    expect(detectBrokenOutput(pricedThinking)).toMatchObject({
      code: "BILLED_EMPTY",
      failureClass: "empty_output",
      evidence: {
        provider: "gemini",
        geminiThinkingTokens: 7,
      },
    });
    expect(isBilledButEmpty(unverifiedThinking)).toBe(false);
    expect(detectBrokenOutput(unverifiedThinking)).toBeNull();
  });

  it("gemini-tool-malformation-empty: excludes tool-validity terminal errors from billed-empty", () => {
    const event = geminiEvent({
      requestId: "req-gemini-malformed-tool",
      finishReason: "malformed_function_call",
      categories: [
        {
          category: "gemini_thinking",
          tokens: 7,
          sourceField: "thoughtsTokenCount",
        },
      ],
    });

    expect(isBilledButEmpty(event)).toBe(false);
    expect(detectBrokenOutput(event)).toBeNull();
  });

  it("anthropic-model-context-window-exceeded: maps live stop reason to triage-only TRUNCATED evidence", () => {
    // Context-window stops are input-envelope exhaustion, not clean provider-owned
    // output-cap truncation, so v0 keeps evidence but excludes recoverable dollars.
    const signal = detectBrokenOutput(anthropicEvent({
      requestId: "req-anthropic-context-window",
      finishReason: "model_context_window_exceeded",
      content: "partial answer",
      output: 12,
    }));

    expect(signal).toMatchObject({
      code: "TRUNCATED",
      failureClass: null,
      status: "triage_only",
      evidenceGrade: "triage_only",
      severity: "warning",
      creditCandidate: false,
      dispute: false,
      liabilityParty: "unknown",
      valueKind: "triage",
      recoverableBasis: null,
      observedChargeUsd: null,
      providerRecoverableLossUsd: 0,
      expectedChargeUsd: null,
      pricingVersion: null,
      pricingStatus: "not_priced",
      evidence: {
        finishReason: "model_context_window_exceeded",
        outputTokens: 12,
        generationCaptured: false,
        callerCapCaptured: false,
        callerCapVerdict: "no_captured_caller_cap",
        verdict: "model_context_window_exceeded_triage",
        provider: "anthropic",
        documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons",
        apiReferenceEnumNote: "documented live stop_reason; SDK/API enum typing may lag",
      },
    });
  });
});

function anthropicEvent(input: {
  readonly requestId: string;
  readonly finishReason: string;
  readonly content: string;
  readonly output: number;
  readonly categories?: readonly {
    readonly category: string;
    readonly tokens: number;
    readonly sourceField?: string;
  }[];
}): EventWithUsageCategories {
  const event = buildCanonicalEvent({
    request: {
      tenantId: TENANT_ID,
      provider: "anthropic",
      model: ANTHROPIC_MODEL,
      requestId: input.requestId,
    },
    response: {
      finishReason: input.finishReason,
      content: input.content,
    },
    usage: {
      input: 100,
      output: input.output,
      cache: { read: 0, creation: 0 },
    },
  });

  return {
    ...event,
    usage: {
      ...event.usage,
      categories: input.categories ?? [],
    },
  };
}

function geminiEvent(input: {
  readonly requestId: string;
  readonly finishReason?: string;
  readonly categories: EventWithUsageCategories["usage"]["categories"];
}): EventWithUsageCategories {
  const event = buildCanonicalEvent({
    request: {
      tenantId: TENANT_ID,
      provider: "gemini",
      model: "gemini-2.5-flash",
      requestId: input.requestId,
    },
    response: {
      finishReason: input.finishReason ?? "stop",
      content: "",
    },
    usage: {
      input: 100,
      output: 0,
      categories: input.categories,
    },
  });
  return {
    ...event,
    request: {
      ...event.request,
      providerPlane: "gemini_developer_api",
    },
  } as EventWithUsageCategories;
}
