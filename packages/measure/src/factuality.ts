import { createHash } from "node:crypto";
import type { CanonicalEventV1 } from "./canonical-event.js";
import { z } from "zod";

export const FACTUALITY_SIGNAL_CODES = [
  "FACTUALITY_KNOWN_ANSWER_FAIL",
  "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT",
] as const;

export type FactualitySignalCode = (typeof FACTUALITY_SIGNAL_CODES)[number];
export type FactualityMatchType = "exact" | "numeric" | "date" | "entity";
type CitationSupportMatchType = Extract<FactualityMatchType, "numeric" | "date">;
type FactualityDetectorName = typeof KNOWN_ANSWER_DETECTOR_NAME | typeof CITATION_DETECTOR_NAME;
type FactualityDetectorVersion = typeof KNOWN_ANSWER_DETECTOR_VERSION | typeof CITATION_DETECTOR_VERSION;

export interface FactualitySignal {
  readonly code: FactualitySignalCode;
  readonly detectorName: FactualityDetectorName;
  readonly detectorVersion: FactualityDetectorVersion;
  readonly tenantId: string;
  readonly requestId: string;
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly model: string;
  readonly fieldPath: "response.content";
  readonly matchType: FactualityMatchType;
  readonly authoritative: boolean;
  readonly expectedHash: string;
  readonly servedHash: string;
  readonly evidence: Record<string, unknown>;
  readonly valueJson: Record<string, unknown>;
}

interface KnownAnswerContract {
  readonly contractId: string;
  readonly mode: "known_answer";
  readonly expectedAnswer: string | number;
  readonly matchType: FactualityMatchType;
  readonly authoritative: boolean;
  readonly aliases: readonly string[];
  readonly numericTolerance: number;
  readonly sensitive: boolean;
}

interface EventWithFactualityContract extends CanonicalEventV1 {
  readonly request: CanonicalEventV1["request"] & {
    readonly factualityContract?: Record<string, unknown>;
  };
}

interface EventWithCitationSupport extends CanonicalEventV1 {
  readonly request: CanonicalEventV1["request"] & {
    readonly generation?: Record<string, unknown>;
  };
  readonly response: CanonicalEventV1["response"] & {
    readonly citations?: readonly Record<string, unknown>[];
  };
}

interface Contradiction {
  readonly matchType: FactualityMatchType;
  readonly expectedAnswer: string;
  readonly servedAnswer: string;
}

interface CitationSupportContradiction {
  readonly matchType: CitationSupportMatchType;
  readonly expectedAnswer: string;
  readonly servedAnswer: string;
}

interface CitationCapture {
  readonly captureIndex: number;
  readonly requested: boolean;
  readonly returned: boolean;
  readonly structuredOutputIncompatible: boolean;
  readonly contentBlocks: readonly CitationContentBlock[];
}

interface CitationContentBlock {
  readonly index: number;
  readonly text: string;
  readonly citations: readonly CitationEntry[];
  readonly fieldPath: string;
}

interface CitationEntry {
  readonly index: number;
  readonly citedText: string;
  readonly fieldPath: string;
}

interface CitationContradiction extends CitationSupportContradiction {
  readonly fieldPath: string;
  readonly contentBlockIndex: number;
  readonly citationIndex: number;
}

const KNOWN_ANSWER_DETECTOR_NAME = "factuality-known-answer";
const KNOWN_ANSWER_DETECTOR_VERSION = "v0";
const CITATION_DETECTOR_NAME = "factuality-citation-support";
const CITATION_DETECTOR_VERSION = "anthropic-citation-v0";
const CANDIDATE_FAILURE_CLASS = "known_answer_failure";
const CITATION_CONTRADICTION_FAILURE_CLASS = "anthropic_citation_contradicts_cited_text";
const REFUNDABLE_CLASSIFICATION = "deferred_to_refund_layer";
const CITATION_REFUNDABLE_CLASSIFICATION = "triage_only_not_refundable";
const RESPONSE_FIELD_PATH = "response.content";
const MAX_ATOMIC_ANSWER_LENGTH = 160;
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTH_DATE_PATTERN =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/gi;
const NUMBER_PATTERN = /(?<![\w])-?\d+(?:,\d{3})*(?:\.\d+)?\b/g;
const TEXT_PREFIX_PATTERN =
  /^(?:answer|final answer|the answer is|the correct answer is|it is|it's|that is)\s*[:-]?\s*/i;
const UNCERTAINTY_OR_REFUSAL_PATTERN =
  /\b(?:i\s+(?:am\s+)?not\s+sure|i\s+do\s+not\s+know|i\s+don't\s+know|cannot\s+determine|can't\s+determine|unknown|unable\s+to|no\s+answer|insufficient\s+information)\b/i;
const NON_AFFIRMATIVE_PATTERN =
  /\b(?:not|no|never|cannot|can\s+not|can't|cant|could\s+not|couldn't|should\s+not|shouldn't|would\s+not|wouldn't|will\s+not|won't|do\s+not|don't|does\s+not|doesn't|did\s+not|didn't|is\s+not|isn't|are\s+not|aren't|was\s+not|wasn't|were\s+not|weren't|has\s+not|hasn't|have\s+not|haven't|had\s+not|hadn't|must\s+not|mustn't|\w+n['’]t)\b/i;
const AMBIGUOUS_ATOMIC_ANSWER_PATTERN = /\b(?:and|or)\b|[,;/]/i;
const AMBIGUOUS_NUMERIC_CONTENT_PATTERN =
  /%|\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b|\d\s*[kKmMbB]\b|[$€£¥]\s*-?\d|-?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:[A-Za-z°µμ]+|[$€£¥])/;

const MONTH_INDEX: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const KnownAnswerContractSchema = z
  .object({
    contractId: z.string().min(1),
    mode: z.literal("known_answer"),
    expectedAnswer: z.union([z.string().min(1), z.number().refine(Number.isFinite)]),
    matchType: z.enum(["exact", "numeric", "date", "entity"]),
    authoritative: z.boolean().default(false),
    aliases: z.array(z.string().min(1)).default([]),
    numericTolerance: z.number().nonnegative().default(0),
    sensitive: z.boolean().default(false),
  })
  .strict();

/**
 * Runs evidence-gated factuality detectors over customer-supplied known-answer
 * contracts and hosted Anthropic citation-support evidence.
 *
 * @contract-id hosted-factuality-detectors
 */
export function runFactualityDetectors(event: CanonicalEventV1): FactualitySignal[] {
  const signals: FactualitySignal[] = [];
  const signal = detectKnownAnswerContradiction(event);
  if (signal) signals.push(signal);
  signals.push(...detectAnthropicCitationSupport(event));
  return signals;
}

export function detectKnownAnswerContradiction(
  event: CanonicalEventV1,
): FactualitySignal | null {
  const contract = factualityContractForEvent(event);
  if (!contract) return null;

  const contradiction = contradictionForContract(contract, event.response.content);
  if (!contradiction) return null;

  return factualitySignal(event, contract, contradiction);
}

export function detectAnthropicCitationSupport(
  event: CanonicalEventV1,
): FactualitySignal[] {
  if (event.request.provider !== "anthropic") return [];

  const signals: FactualitySignal[] = [];
  for (const capture of citationCapturesForEvent(event)) {
    if (!capture.requested && !capture.returned) continue;
    if (capture.structuredOutputIncompatible) continue;

    const contradiction = citationContradictionForCapture(capture);
    if (contradiction) {
      signals.push(citationContradictionSignal(event, capture, contradiction));
    }
  }
  return signals;
}

export function hashFactualityAnswer(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function factualityContractForEvent(event: CanonicalEventV1): KnownAnswerContract | null {
  const contract = (event as EventWithFactualityContract).request.factualityContract;
  if (!contract) return null;

  const parsed = KnownAnswerContractSchema.safeParse(contract);
  if (!parsed.success) return null;
  return parsed.data;
}

function contradictionForContract(
  contract: KnownAnswerContract,
  content: string,
): Contradiction | null {
  if (isUncertaintyOrRefusal(content)) return null;
  if (isNonAffirmative(content)) return null;

  switch (contract.matchType) {
    case "exact":
      return exactContradiction(contract, content);
    case "numeric":
      return numericContradiction(contract, content);
    case "date":
      return dateContradiction(contract, content);
    case "entity":
      return entityContradiction(contract, content);
  }
}

function exactContradiction(
  contract: KnownAnswerContract,
  content: string,
): Contradiction | null {
  if (contentContainsKnownAnswer(content, expectedAndAliases(contract))) return null;

  const servedAnswer = normalizedAtomicAnswer(content);
  if (!servedAnswer) return null;

  const expectedAnswers = expectedAndAliases(contract).map(normalizeTextAnswer);
  if (expectedAnswers.includes(servedAnswer)) return null;

  return {
    matchType: "exact",
    expectedAnswer: normalizeTextAnswer(String(contract.expectedAnswer)),
    servedAnswer,
  };
}

function numericContradiction(
  contract: KnownAnswerContract,
  content: string,
): Contradiction | null {
  const expectedNumber = numericValue(contract.expectedAnswer);
  if (expectedNumber === null) return null;
  if (hasAmbiguousNumericFormat(content)) return null;

  const observedNumbers = uniqueNumbers(extractNumbers(content));
  if (observedNumbers.length !== 1) return null;

  const servedNumber = observedNumbers[0];
  if (servedNumber === undefined) return null;
  if (Math.abs(servedNumber - expectedNumber) <= contract.numericTolerance) return null;

  return {
    matchType: "numeric",
    expectedAnswer: numberEvidenceValue(expectedNumber),
    servedAnswer: numberEvidenceValue(servedNumber),
  };
}

function dateContradiction(
  contract: KnownAnswerContract,
  content: string,
): Contradiction | null {
  if (typeof contract.expectedAnswer !== "string") return null;

  const expectedDate = parseUnambiguousDate(contract.expectedAnswer);
  if (!expectedDate) return null;

  const observedDates = uniqueStrings(extractUnambiguousDates(content));
  if (observedDates.length !== 1) return null;

  const servedDate = observedDates[0];
  if (!servedDate) return null;
  if (servedDate === expectedDate) return null;

  return {
    matchType: "date",
    expectedAnswer: expectedDate,
    servedAnswer: servedDate,
  };
}

function entityContradiction(
  contract: KnownAnswerContract,
  content: string,
): Contradiction | null {
  if (contentContainsKnownAnswer(content, expectedAndAliases(contract))) return null;

  const servedAnswer = normalizedAtomicAnswer(content);
  if (!servedAnswer || !/[a-z0-9]/.test(servedAnswer)) return null;

  const expectedAnswers = expectedAndAliases(contract).map(normalizeTextAnswer);
  if (expectedAnswers.includes(servedAnswer)) return null;

  return {
    matchType: "entity",
    expectedAnswer: normalizeTextAnswer(String(contract.expectedAnswer)),
    servedAnswer,
  };
}

function factualitySignal(
  event: CanonicalEventV1,
  contract: KnownAnswerContract,
  contradiction: Contradiction,
): FactualitySignal {
  const expectedHash = hashFactualityAnswer(contradiction.expectedAnswer);
  const servedHash = hashFactualityAnswer(contradiction.servedAnswer);
  const evidence = evidenceForContradiction(contract, contradiction, expectedHash, servedHash);

  return {
    code: "FACTUALITY_KNOWN_ANSWER_FAIL",
    detectorName: KNOWN_ANSWER_DETECTOR_NAME,
    detectorVersion: KNOWN_ANSWER_DETECTOR_VERSION,
    tenantId: event.request.tenantId,
    requestId: event.request.requestId,
    provider: event.request.provider,
    model: event.request.model,
    fieldPath: RESPONSE_FIELD_PATH,
    matchType: contradiction.matchType,
    authoritative: contract.authoritative,
    expectedHash,
    servedHash,
    evidence,
    valueJson: {
      matchType: contradiction.matchType,
      authoritative: contract.authoritative,
      candidateFailureClass: CANDIDATE_FAILURE_CLASS,
      refundableClassification: REFUNDABLE_CLASSIFICATION,
    },
  };
}

function citationContradictionSignal(
  event: CanonicalEventV1,
  capture: CitationCapture,
  contradiction: CitationContradiction,
): FactualitySignal {
  const expectedHash = hashFactualityAnswer(contradiction.expectedAnswer);
  const servedHash = hashFactualityAnswer(contradiction.servedAnswer);

  return {
    code: "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT",
    detectorName: CITATION_DETECTOR_NAME,
    detectorVersion: CITATION_DETECTOR_VERSION,
    tenantId: event.request.tenantId,
    requestId: event.request.requestId,
    provider: event.request.provider,
    model: event.request.model,
    fieldPath: RESPONSE_FIELD_PATH,
    matchType: contradiction.matchType,
    authoritative: true,
    expectedHash,
    servedHash,
    evidence: {
      reason: CITATION_CONTRADICTION_FAILURE_CLASS,
      provider: "anthropic",
      fieldPath: contradiction.fieldPath,
      contentBlockIndex: contradiction.contentBlockIndex,
      citationIndex: contradiction.citationIndex,
      matchType: contradiction.matchType,
      citedAnswerHash: expectedHash,
      servedAnswerHash: servedHash,
      citationsRequested: capture.requested,
      citationsReturned: capture.returned,
      structuredOutputCompatibility: "compatible",
      providerCitationGuarantee: "valid_pointer_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dollarClaim: "none",
      surfaceComparisonOnly: true,
      refundableClassification: CITATION_REFUNDABLE_CLASSIFICATION,
    },
    valueJson: {
      matchType: contradiction.matchType,
      authoritative: true,
      candidateFailureClass: CITATION_CONTRADICTION_FAILURE_CLASS,
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dollarClaim: "none",
      surfaceComparisonOnly: true,
      refundableClassification: CITATION_REFUNDABLE_CLASSIFICATION,
    },
  };
}

function evidenceForContradiction(
  contract: KnownAnswerContract,
  contradiction: Contradiction,
  expectedHash: string,
  servedHash: string,
): Record<string, unknown> {
  return {
    reason: "known_answer_contradiction",
    contractId: contract.contractId,
    contractMode: contract.mode,
    matchType: contradiction.matchType,
    authoritative: contract.authoritative,
    sensitive: contract.sensitive,
    fieldPath: RESPONSE_FIELD_PATH,
    expectedAnswerHash: expectedHash,
    servedAnswerHash: servedHash,
    candidateFailureClass: CANDIDATE_FAILURE_CLASS,
    refundableClassification: REFUNDABLE_CLASSIFICATION,
    confidence: "high",
    ...(contract.sensitive
      ? {}
      : {
        expectedAnswer: contradiction.expectedAnswer,
        servedAnswer: contradiction.servedAnswer,
      }),
  };
}

function citationCapturesForEvent(event: CanonicalEventV1): readonly CitationCapture[] {
  const citationEvent = event as EventWithCitationSupport;
  const captures = citationEvent.response.citations;
  if (!captures || captures.length === 0) return [];

  const generation = asRecord(citationEvent.request.generation);
  const requestCitationsEnabled = booleanValue(generation?.citationsEnabled) === true;
  const requestStructuredOutputIncompatible =
    booleanValue(generation?.citationsStructuredOutputIncompatible) === true;

  return captures.flatMap((capture, captureIndex) => {
    const contentBlocks = citationContentBlocksForCapture(capture, captureIndex);
    if (contentBlocks.length === 0) return [];

    const returned = contentBlocks.some((block) => block.citations.length > 0);
    return [{
      captureIndex,
      requested: booleanValue(capture.requested) ?? requestCitationsEnabled,
      returned: booleanValue(capture.returned) ?? returned,
      structuredOutputIncompatible:
        requestStructuredOutputIncompatible ||
        booleanValue(capture.structuredOutputIncompatible) === true,
      contentBlocks,
    }];
  });
}

function citationContentBlocksForCapture(
  capture: Record<string, unknown>,
  captureIndex: number,
): readonly CitationContentBlock[] {
  const blocks = Array.isArray(capture.contentBlocks)
    ? capture.contentBlocks.filter(isRecord)
    : [capture].filter(isRecord);

  return blocks.flatMap((block, ordinal) => {
    const text = stringValue(block.text);
    if (text === null) return [];
    const index = numberValue(block.index) ?? ordinal;
    return [{
      index,
      text,
      citations: citationEntriesForBlock(block, captureIndex, index),
      fieldPath: `response.citations[${captureIndex}].contentBlocks[${index}]`,
    }];
  });
}

function citationEntriesForBlock(
  block: Record<string, unknown>,
  captureIndex: number,
  blockIndex: number,
): readonly CitationEntry[] {
  const citations = Array.isArray(block.citations) ? block.citations.filter(isRecord) : [];
  return citations.flatMap((citation, citationIndex) => {
    const citedText = stringValue(citation.cited_text);
    if (citedText === null) return [];
    return [{
      index: citationIndex,
      citedText,
      fieldPath: `response.citations[${captureIndex}].contentBlocks[${blockIndex}].citations[${citationIndex}]`,
    }];
  });
}

function citationContradictionForCapture(
  capture: CitationCapture,
): CitationContradiction | null {
  for (const block of capture.contentBlocks) {
    if (isUncertaintyOrRefusal(block.text) || isNonAffirmative(block.text)) continue;
    for (const citation of block.citations) {
      if (isUncertaintyOrRefusal(citation.citedText) || isNonAffirmative(citation.citedText)) {
        continue;
      }
      const contradiction = contradictionBetweenCitedAndServedText(
        citation.citedText,
        block.text,
      );
      if (!contradiction) continue;
      return {
        ...contradiction,
        fieldPath: citation.fieldPath,
        contentBlockIndex: block.index,
        citationIndex: citation.index,
      };
    }
  }
  return null;
}

function contradictionBetweenCitedAndServedText(
  citedText: string,
  servedText: string,
): CitationSupportContradiction | null {
  return numericContradictionBetweenTexts(citedText, servedText) ??
    dateContradictionBetweenTexts(citedText, servedText);
}

function numericContradictionBetweenTexts(
  citedText: string,
  servedText: string,
): CitationSupportContradiction | null {
  if (hasAmbiguousNumericFormat(citedText) || hasAmbiguousNumericFormat(servedText)) return null;

  const expectedNumbers = uniqueNumbers(extractNumbers(citedText));
  const servedNumbers = uniqueNumbers(extractNumbers(servedText));
  if (expectedNumbers.length !== 1 || servedNumbers.length !== 1) return null;

  const expected = expectedNumbers[0];
  const served = servedNumbers[0];
  if (expected === undefined || served === undefined || expected === served) return null;

  return {
    matchType: "numeric",
    expectedAnswer: numberEvidenceValue(expected),
    servedAnswer: numberEvidenceValue(served),
  };
}

function dateContradictionBetweenTexts(
  citedText: string,
  servedText: string,
): CitationSupportContradiction | null {
  const expectedDates = uniqueStrings(extractUnambiguousDates(citedText));
  const servedDates = uniqueStrings(extractUnambiguousDates(servedText));
  if (expectedDates.length !== 1 || servedDates.length !== 1) return null;

  const expected = expectedDates[0];
  const served = servedDates[0];
  if (expected === undefined || served === undefined || expected === served) return null;

  return {
    matchType: "date",
    expectedAnswer: expected,
    servedAnswer: served,
  };
}

function expectedAndAliases(contract: KnownAnswerContract): readonly string[] {
  return [String(contract.expectedAnswer), ...contract.aliases];
}

function contentContainsKnownAnswer(
  content: string,
  answers: readonly string[],
): boolean {
  const normalizedContent = normalizeBoundaryText(content);
  return answers.some((answer) => {
    const normalized = normalizeBoundaryText(answer).trim();
    if (normalized.length === 0) return false;
    return answerBoundaryPattern(normalized).test(normalizedContent);
  });
}

function answerBoundaryPattern(answer: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(answer)}([^A-Za-z0-9]|$)`);
}

function normalizeBoundaryText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function normalizedAtomicAnswer(content: string): string | null {
  const atomic = atomicAnswer(content);
  if (!atomic) return null;
  const normalized = normalizeTextAnswer(atomic);
  return normalized.length > 0 ? normalized : null;
}

function atomicAnswer(content: string): string | null {
  let value = content.trim();
  if (value.length === 0 || value.length > MAX_ATOMIC_ANSWER_LENGTH) return null;
  if (value.includes("\n")) return null;

  let previous = "";
  while (previous !== value) {
    previous = value;
    value = value.replace(TEXT_PREFIX_PATTERN, "").trim();
  }

  value = stripWrappingQuotes(value);
  value = value.replace(/[.!?]+$/u, "").trim();
  if (value.length === 0 || value.length > MAX_ATOMIC_ANSWER_LENGTH) return null;
  if (AMBIGUOUS_ATOMIC_ANSWER_PATTERN.test(value)) return null;
  return value;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function normalizeTextAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function numericValue(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!/^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractNumbers(content: string): readonly number[] {
  return [...content.matchAll(NUMBER_PATTERN)]
    .map((match) => numericValue(match[0]))
    .filter((value): value is number => value !== null);
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)];
}

function numberEvidenceValue(value: number): string {
  return String(value);
}

function parseUnambiguousDate(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return validDateKey(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const monthMatch =
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i.exec(trimmed);
  if (!monthMatch) return null;

  const month = MONTH_INDEX[monthMatch[1]?.toLowerCase() ?? ""];
  if (!month) return null;
  return validDateKey(Number(monthMatch[3]), month, Number(monthMatch[2]));
}

function extractUnambiguousDates(content: string): readonly string[] {
  const dates: string[] = [];

  for (const match of content.matchAll(ISO_DATE_PATTERN)) {
    const date = validDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) dates.push(date);
  }

  for (const match of content.matchAll(MONTH_DATE_PATTERN)) {
    const month = MONTH_INDEX[match[1]?.toLowerCase() ?? ""];
    if (!month) continue;
    const date = validDateKey(Number(match[3]), month, Number(match[2]));
    if (date) dates.push(date);
  }

  return dates;
}

function validDateKey(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isUncertaintyOrRefusal(content: string): boolean {
  return UNCERTAINTY_OR_REFUSAL_PATTERN.test(content);
}

function isNonAffirmative(content: string): boolean {
  return NON_AFFIRMATIVE_PATTERN.test(content);
}

function hasAmbiguousNumericFormat(content: string): boolean {
  return AMBIGUOUS_NUMERIC_CONTENT_PATTERN.test(content);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
