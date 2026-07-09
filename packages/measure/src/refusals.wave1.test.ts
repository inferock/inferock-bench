import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  classifierRefusalTier,
  clearRefusalClassifierVerdicts,
  detectRefusal,
  detectStatelessRefusal,
  registerRefusalClassifierVerdict,
  regexRefusalTier,
} from "./refusals.js";
import { runStatelessDetectors } from "./stateless.js";

type ProviderSafety = NonNullable<CanonicalEventV2["response"]["providerSafety"]>;
type EventWithProviderSafety = CanonicalEventV1 & {
  readonly response: CanonicalEventV1["response"] & {
    readonly providerSafety: ProviderSafety;
  };
};

const TENANT_ID = "tenant-refusal-wave1";
const OPENAI_MODEL = "gpt-5.4-mini";
const ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const GEMINI_MODEL = "gemini-2.5-flash";

afterEach(() => {
  clearRefusalClassifierVerdicts();
});

describe("wave1 refusal signal economics", () => {
  it("emits REFUSAL_BILLED only for expected-completion provider-native safety evidence with billed usage", () => {
    const signal = detectStatelessRefusal(providerSafetyEvent([{
      kind: "refusal",
      source: "provider",
      reason: "refusal",
      raw: { fieldPath: "choices[0].message.refusal" },
    }]));

    expect(signal).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
      evidence: {
        tier: "provider_openai",
        chargeEvidence: "provider_usage",
        providerSafetyKinds: ["refusal"],
      },
    });
    expect(signal?.providerRecoverableLossUsd).toBeGreaterThan(0);
  });

  it("dollarizes regex and classifier-only refusal findings without provider recognition", () => {
    const regexEvent = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-regex-only",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "As an AI language model, I cannot complete that request.",
      },
      usage: {
        input: 100,
        output: 20,
      },
    });
    const classifierEvent = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-classifier-only",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "No.",
      },
      usage: {
        input: 100,
        output: 20,
      },
    });
    registerRefusalClassifierVerdict({
      tenantId: TENANT_ID,
      provider: "openai",
      requestId: "req-classifier-only",
      isRefusal: true,
      score: 0.98,
      model: "protectai/distilroberta-base-rejection-v1",
    });

    expect(regexRefusalTier(regexEvent.response.content)).toBe("regex");
    expect(classifierRefusalTier(classifierEvent)).toMatchObject({ tier: "classifier" });
    expect(detectRefusal(regexEvent)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      status: "triage_only",
      evidenceGrade: "triage_only",
      providerRecoverableLossUsd: 0,
      evidence: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "regex",
      },
      valueJson: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "regex",
      },
    });
    expect(detectRefusal(classifierEvent)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      providerRecoverableLossUsd: 0,
      evidence: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "protectai",
        classifierScore: 0.98,
      },
    });
    expect(detectStatelessRefusal(regexEvent)).toMatchObject({
      code: "REFUSAL_BILLED",
      providerRecoverableLossUsd: 0,
    });
    const standardized = runStatelessDetectors(regexEvent).find((signal) =>
      signal.code === "REFUSAL_BILLED"
    );
    expect(standardized).toMatchObject({
      standardLossStatus: "computed",
      standardLossGrade: "unrecognized_standard_loss",
      evidenceGrade: "unrecognized_standard_loss",
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: standardized?.standardLossUsd,
      computationTrace: {
        method: "call_cost_floor_v1",
        basis: "failed_to_deliver_usable_output",
      },
    });
  });

  it("detects Anthropic provider refusal fields when completion was expected", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-anthropic-refusal",
        expectCompletion: true,
      },
      response: {
        finishReason: "refusal",
        content: "I cannot help with that.",
      },
      usage: {
        input: 100,
        output: 10,
      },
    });

    expect(detectRefusal(event)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      evidence: {
        tier: "provider_anthropic",
      },
    });
  });

  it("detects OpenAI content-filter refusals when completion was expected", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-openai-content-filter",
        expectCompletion: true,
      },
      response: {
        finishReason: "content_filter",
        content: "",
      },
      usage: {
        output: 0,
      },
    });

    expect(detectRefusal(event)).toMatchObject({
      code: "REFUSAL_BILLED",
      evidence: {
        tier: "provider_openai",
      },
    });
  });

  it("detects Gemini provider refusal evidence without relabeling it as OpenAI", () => {
    const signal = detectRefusal(providerSafetyEvent([{
      kind: "refusal",
      source: "provider",
      reason: "gemini_policy_refusal",
      raw: { fieldPath: "candidates[0].finishReason" },
    }], {
      provider: "gemini",
      model: GEMINI_MODEL,
      requestId: "req-gemini-refusal",
    }));

    expect(signal).toMatchObject({
      code: "REFUSAL_BILLED",
      provider: "gemini",
      evidence: {
        tier: "provider_gemini",
        providerSafetyKinds: ["refusal"],
      },
    });
  });

  it("emits tier0.5 regex refusals when completion was expected", () => {
    const refusal = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-regex-refusal",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "As an AI language model, I cannot complete that request.",
      },
    });
    const notExpected = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-regex-not-expected",
        expectCompletion: false,
      },
      response: {
        finishReason: "stop",
        content: "As an AI language model, I cannot complete that request.",
      },
    });

    expect(regexRefusalTier(refusal.response.content)).toBe("regex");
    expect(detectRefusal(refusal)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      evidence: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "regex",
      },
    });
    expect(detectRefusal(notExpected)).toBeNull();
  });

  it("matches real refusal phrasings and emits classifier-source REFUSAL_BILLED", () => {
    const refusalPhrases = [
      "I'm sorry, I can't assist with that.",
      "I can't help with that request.",
      "I'm unable to assist with that.",
      "I cannot provide that information.",
      "Sorry, but I can't help with that.",
    ] as const;

    for (const [index, content] of refusalPhrases.entries()) {
      const event = buildCanonicalEvent({
        request: {
          tenantId: TENANT_ID,
          provider: "openai",
          model: OPENAI_MODEL,
          requestId: `req-real-refusal-${index}`,
          expectCompletion: true,
        },
        response: {
          finishReason: "stop",
          content,
        },
      });

      expect(regexRefusalTier(event.response.content)).toBe("regex");
      expect(detectRefusal(event)).toMatchObject({
        code: "REFUSAL_BILLED",
        evidence: {
          refusalDetectionSource: "classifier",
          refusalDetectionMechanism: "regex",
        },
      });
    }
  });

  it("emits registered ProtectAI tier1 classifier verdicts as REFUSAL_BILLED", () => {
    registerRefusalClassifierVerdict({
      tenantId: TENANT_ID,
      provider: "openai",
      requestId: "req-classifier-refusal",
      isRefusal: true,
      score: 0.94,
      model: "protectai/distilroberta-base-rejection-v1",
    });
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "openai",
        model: OPENAI_MODEL,
        requestId: "req-classifier-refusal",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "No.",
      },
    });

    expect(classifierRefusalTier(event)).toMatchObject({
      tier: "classifier",
      verdict: {
        score: 0.94,
        model: "protectai/distilroberta-base-rejection-v1",
      },
    });
    expect(detectRefusal(event)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      providerRecoverableLossUsd: 0,
      evidence: {
        refusalDetectionSource: "classifier",
        refusalDetectionMechanism: "protectai",
        classifierScore: 0.94,
      },
    });
  });

  it("returns null for clean completions", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: TENANT_ID,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        requestId: "req-clean-refusal",
        expectCompletion: true,
      },
      response: {
        finishReason: "stop",
        content: "The request is complete.",
      },
    });

    expect(detectRefusal(event)).toBeNull();
  });

  it("does not emit REFUSAL_BILLED when completion was not expected or no usage was billed", () => {
    expect(detectStatelessRefusal(providerSafetyEvent([{
      kind: "content_filter",
      source: "provider",
      reason: "content_filter",
    }], { expectCompletion: false }))).toBeNull();
    expect(detectStatelessRefusal(providerSafetyEvent([{
      kind: "refusal",
      source: "provider",
      reason: "refusal",
    }], { input: 0, output: 0 }))).toBeNull();
  });

  it("classifies streamed native refusal safety as REFUSAL_BILLED instead of BILLED_EMPTY", () => {
    const signals = runStatelessDetectors(providerSafetyEvent([{
      kind: "refusal",
      source: "provider",
      reason: "refusal",
      raw: {
        fieldPath: "choices[0].delta.refusal",
        refusal: "I cannot help with that request.",
      },
    }]));

    expect(signals.map((signal) => signal.code)).toEqual(["REFUSAL_BILLED"]);
  });
});

function providerSafetyEvent(
  providerSafety: ProviderSafety,
  overrides: {
    readonly provider?: CanonicalEventV1["request"]["provider"];
    readonly model?: string;
    readonly requestId?: string;
    readonly expectCompletion?: boolean;
    readonly input?: number;
    readonly output?: number;
  } = {},
): EventWithProviderSafety {
  const event = buildCanonicalEvent({
    request: {
      tenantId: TENANT_ID,
      provider: overrides.provider ?? "openai",
      model: overrides.model ?? OPENAI_MODEL,
      requestId: overrides.requestId ?? "req-provider-native-refusal",
      expectCompletion: overrides.expectCompletion ?? true,
    },
    response: {
      finishReason: "stop",
      content: "",
    },
    usage: {
      input: overrides.input ?? 100,
      output: overrides.output ?? 10,
      cache: { read: 0, creation: 0 },
    },
  });
  return {
    ...event,
    response: {
      ...event.response,
      providerSafety,
    },
  };
}
