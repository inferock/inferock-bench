import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  detectRefusal,
  regexRefusalTier,
} from "./refusals.js";

const TENANT_ID = "tenant-refusal-wave3";
const OPENAI_MODEL = "gpt-5.4-mini";

const OLD_REFUSAL_PATTERNS = [
  /\bi (?:cannot|can't|can’t|am unable|won't|will not)\b/i,
  /\bi'?m unable\b/i,
  /\bas an ai(?: language model)?\b/i,
  /\b(?:cannot|can't|can’t) assist\b/i,
  /\bi must refuse\b/i,
];

function oldRegexRefusalTier(content: string): "regex" | null {
  return OLD_REFUSAL_PATTERNS.some((pattern) => pattern.test(content)) ? "regex" : null;
}

describe("wave3 refusal regex false-positive tightening", () => {
  it("does not flag refusal-like phrases inside explanations, translations, or code", () => {
    const falsePositiveCases = [
      {
        name: "translation quotation",
        content:
          "In this localization file, \"I cannot provide that information\" is the English source string for a Spanish translation.",
      },
      {
        name: "explanatory model-may-refuse sentence",
        content:
          "The model may refuse by saying \"I'm unable to assist with that.\" That phrase should be treated as an example.",
      },
      {
        name: "code string literal",
        content:
          "const fallbackMessage = \"I can't help with that request.\";\nreturn fallbackMessage;",
      },
      {
        name: "ordinary inability report",
        content:
          "I cannot find evidence that this migration changed the public API, so no compatibility note is needed.",
      },
      {
        name: "as-ai glossary sentence",
        content:
          "As an AI language model is a stock phrase often found in refusal examples, but this sentence is not refusing.",
      },
      {
        name: "mid-quote refusal phrase",
        content:
          "The runbook says to record the exact text \"I can't assist with that request\" when documenting a provider refusal.",
      },
    ] as const;

    for (const testCase of falsePositiveCases) {
      expect(oldRegexRefusalTier(testCase.content), testCase.name).toBe("regex");
      expect(regexRefusalTier(testCase.content), testCase.name).toBeNull();
      expect(detectRefusal(refusalEvent(testCase.content, testCase.name))).toBeNull();
    }
  });

  it("still flags refusal-shaped answers at the response opening", () => {
    const refusalCases = [
      "As an AI language model, I cannot complete that request.",
      "I'm sorry, I can't assist with that.",
      "I can't help with that request.",
      "I'm unable to assist with that.",
      "I cannot provide that information.",
      "Sorry, but I can't help with that.",
      "I must refuse this request.",
      "Cannot assist with that request.",
      "Unfortunately, I will not provide that information.",
    ] as const;

    for (const [index, content] of refusalCases.entries()) {
      expect(oldRegexRefusalTier(content), content).toBe("regex");
      expect(regexRefusalTier(content), content).toBe("regex");
      expect(detectRefusal(refusalEvent(content, `true-positive-${index}`))).toMatchObject({
        code: "REFUSAL_BILLED",
        failureClass: "refusal",
        evidence: {
          refusalDetectionSource: "classifier",
          refusalDetectionMechanism: "regex",
        },
      });
    }
  });

  it("does not claim multilingual polite-decline coverage in the regex tier", () => {
    const spanishPoliteDecline = "Lo siento, no puedo ayudar con eso.";

    expect(oldRegexRefusalTier(spanishPoliteDecline)).toBeNull();
    expect(regexRefusalTier(spanishPoliteDecline)).toBeNull();
    expect(detectRefusal(refusalEvent(spanishPoliteDecline, "spanish-politedecline"))).toBeNull();
  });
});

function refusalEvent(content: string, requestId: string) {
  return buildCanonicalEvent({
    request: {
      tenantId: TENANT_ID,
      provider: "openai",
      model: OPENAI_MODEL,
      requestId: `req-wave3-${requestId}`,
      expectCompletion: true,
    },
    response: {
      finishReason: "stop",
      content,
    },
    usage: {
      input: 100,
      output: 20,
      cache: { read: 0, creation: 0 },
    },
  });
}
