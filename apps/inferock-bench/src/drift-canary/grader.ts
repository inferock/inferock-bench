export type DriftCanaryDataset = "gsm8k_platinum" | "mmlu_hendrycks_test";

export interface DriftCanaryGradeInput {
  readonly dataset: DriftCanaryDataset;
  readonly expectedAnswer: string;
  readonly responseText: string;
}

export interface DriftCanaryGradeResult {
  readonly passed: boolean;
  readonly extractedAnswer: string | null;
  readonly expectedAnswer: string;
}

export function gradeDriftCanaryResponse(
  input: DriftCanaryGradeInput,
): DriftCanaryGradeResult {
  const expectedAnswer = input.dataset === "gsm8k_platinum"
    ? normalizeNumericAnswer(input.expectedAnswer)
    : normalizeChoiceAnswer(input.expectedAnswer);
  const extractedAnswer = input.dataset === "gsm8k_platinum"
    ? extractNumericAnswer(input.responseText)
    : extractChoiceAnswer(input.responseText);
  return {
    passed: expectedAnswer !== null && extractedAnswer === expectedAnswer,
    extractedAnswer,
    expectedAnswer: expectedAnswer ?? input.expectedAnswer,
  };
}

export function normalizeNumericAnswer(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .replace(/^\+/, "");
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(cleaned)) return null;
  return cleaned.replace(/\.0+$/, "");
}

function extractNumericAnswer(responseText: string): string | null {
  const hashMatch = /####\s*([-+]?\$?\d[\d,]*(?:\.\d+)?%?)/.exec(responseText);
  if (hashMatch?.[1]) return normalizeNumericAnswer(hashMatch[1]);

  const matches = [...responseText.matchAll(/[-+]?\$?\d[\d,]*(?:\.\d+)?%?/g)];
  const last = matches.at(-1)?.[0];
  return last ? normalizeNumericAnswer(last) : null;
}

function normalizeChoiceAnswer(value: string): "A" | "B" | "C" | "D" | null {
  const trimmed = value.trim().toUpperCase();
  return trimmed === "A" || trimmed === "B" || trimmed === "C" || trimmed === "D"
    ? trimmed
    : null;
}

function extractChoiceAnswer(responseText: string): "A" | "B" | "C" | "D" | null {
  const explicit = /(?:answer|option|choice)\s*(?:is|:)?\s*[([]?\s*([ABCD])\s*[)\].:]?/i.exec(responseText);
  const normalizedExplicit = explicit?.[1] ? normalizeChoiceAnswer(explicit[1]) : null;
  if (normalizedExplicit) return normalizedExplicit;

  const firstStandalone = /(?:^|[^A-Za-z])([ABCD])(?:[^A-Za-z]|$)/i.exec(responseText);
  return firstStandalone?.[1] ? normalizeChoiceAnswer(firstStandalone[1]) : null;
}
