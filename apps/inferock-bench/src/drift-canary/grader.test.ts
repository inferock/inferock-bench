import { describe, expect, it } from "vitest";
import {
  gradeDriftCanaryResponse,
  normalizeNumericAnswer,
} from "./grader.js";

describe("drift canary grader", () => {
  it("extracts GSM8K numeric exact-match answers from terse or worked responses", () => {
    expect(normalizeNumericAnswer("$57,500")).toBe("57500");
    expect(gradeDriftCanaryResponse({
      dataset: "gsm8k_platinum",
      expectedAnswer: "57500",
      responseText: "#### 57,500",
    })).toMatchObject({ passed: true, extractedAnswer: "57500" });
    expect(gradeDriftCanaryResponse({
      dataset: "gsm8k_platinum",
      expectedAnswer: "18",
      responseText: "The answer is 18.",
    })).toMatchObject({ passed: true, extractedAnswer: "18" });
  });

  it("does not turn unrelated numbers into a false MMLU A/B/C/D pass", () => {
    expect(gradeDriftCanaryResponse({
      dataset: "mmlu_hendrycks_test",
      expectedAnswer: "C",
      responseText: "Answer: C",
    })).toMatchObject({ passed: true, extractedAnswer: "C" });
    expect(gradeDriftCanaryResponse({
      dataset: "mmlu_hendrycks_test",
      expectedAnswer: "A",
      responseText: "The 4 candidates do not make option B correct.",
    })).toMatchObject({ passed: false, extractedAnswer: "B" });
    expect(gradeDriftCanaryResponse({
      dataset: "mmlu_hendrycks_test",
      expectedAnswer: "D",
      responseText: "I cannot determine it from the prompt.",
    })).toMatchObject({ passed: false, extractedAnswer: null });
  });
});
