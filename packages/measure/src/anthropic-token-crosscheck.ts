import type { CanonicalEventV1 } from "./canonical-event.js";
import {
  lookupPriceForEvent,
  roundUsd,
  type PriceLookupResult,
} from "./pricing.js";
import { buildLossSignal } from "./signal.js";
import type { LossSignal } from "./types.js";
import {
  CLAUDE_TOKENIZER_ESTIMATOR,
  CLAUDE_TOKENIZER_LICENSE,
  CLAUDE_TOKENIZER_REVISION,
  CLAUDE_TOKENIZER_SOURCE_URL,
  estimateAnthropicOfflineOutputTokens,
} from "./anthropic-local-tokenizer.js";

export { estimateAnthropicOfflineOutputTokens } from "./anthropic-local-tokenizer.js";

export const ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID = "anthropic_count_tokens_recount_v1";
export const ANTHROPIC_COUNT_TOKENS_DOCS_URL =
  "https://platform.claude.com/docs/en/build-with-claude/token-counting";
export const ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT =
  "Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.";
export const ANTHROPIC_TOKEN_CROSSCHECK_NOTE =
  `${ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT} Evidence is capped at provider-assisted grade B; unverified calibration remains gross-bound triage only.`;
export const ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER = 6;
export const ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS = 16;
export const ANTHROPIC_TOKEN_CALIBRATION_DEFAULT_MIN_SAMPLES = 8;

type CalibrationStatus = "verified" | "unverified";

interface UsageCategory {
  readonly category: string;
  readonly tokens: number;
  readonly sourceField?: string;
}

type EventWithUsageCategories = CanonicalEventV1 & {
  readonly usage: CanonicalEventV1["usage"] & {
    readonly categories?: readonly UsageCategory[];
  };
};

export interface AnthropicCountTokensRecount {
  readonly outputTokens: number;
  readonly source?: string;
}

export interface AnthropicTokenCalibrationProvenance {
  readonly source: "runtime_count_tokens";
  readonly countTokensSource: string;
  readonly localEstimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
  readonly localEstimatorRevision: typeof CLAUDE_TOKENIZER_REVISION;
  readonly localEstimatorSourceUrl?: typeof CLAUDE_TOKENIZER_SOURCE_URL;
  readonly localEstimatorLicense?: typeof CLAUDE_TOKENIZER_LICENSE;
  readonly countTokensDocsUrl?: typeof ANTHROPIC_COUNT_TOKENS_DOCS_URL;
  readonly updatedAt: string;
}

export interface AnthropicTokenCalibration {
  readonly model: string;
  readonly status: CalibrationStatus;
  readonly sampleCount: number;
  readonly minSampleCount: number;
  readonly ratio?: number;
  readonly overheadTokens?: number;
  readonly toleranceTokens?: number;
  readonly provenance: AnthropicTokenCalibrationProvenance;
}

export interface AddAnthropicTokenCalibrationSampleInput {
  readonly model: string;
  readonly deliveredOutputContent: string;
  readonly billedVisibleOutputTokens: number;
  readonly countedOutputTokens: number;
  readonly countTokensSource: string;
  readonly observedAt?: string;
}

export interface AnthropicTokenCalibrationCache {
  addCountTokensSample(input: AddAnthropicTokenCalibrationSampleInput): AnthropicTokenCalibration;
  calibrationForModel(model: string): AnthropicTokenCalibration;
  reset(): void;
}

export interface AnthropicTokenCalibrationCacheOptions {
  readonly minSampleCount?: number;
}

export interface AnthropicTokenCrossCheckOptions {
  readonly countTokens?: AnthropicCountTokensRecount | null;
  readonly calibration?: AnthropicTokenCalibration | null;
  readonly fallbackReason?: string;
}

interface AnthropicTokenMethodMetadata {
  readonly methodId: typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID;
  readonly evidenceGradeCap: "B";
  readonly evidenceGradeCapReason: "provider_assisted_recount";
  readonly recountOracle: "anthropic.messages.count_tokens";
  readonly recountOracleDocsUrl: typeof ANTHROPIC_COUNT_TOKENS_DOCS_URL;
  readonly localEstimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
  readonly localEstimatorUrl: typeof CLAUDE_TOKENIZER_SOURCE_URL;
  readonly localEstimatorRevision: typeof CLAUDE_TOKENIZER_REVISION;
  readonly localEstimatorLicense: typeof CLAUDE_TOKENIZER_LICENSE;
  readonly caveat: typeof ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT;
}

export interface AnthropicTokenCrossCheck {
  readonly provider: "anthropic";
  readonly mode: "count_tokens_recount" | "fallback_safe_bound";
  readonly methodId?: typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID;
  readonly methodMetadata?: AnthropicTokenMethodMetadata;
  readonly billedOutputTokens: number;
  readonly thinkingTokens: number;
  readonly billedVisibleOutputTokens: number;
  readonly responseChars: number;
  readonly outputTokenUpperBound: number;
  readonly countedOutputTokens?: number;
  readonly countTokensSource?: string;
  readonly calibrationStatus?: CalibrationStatus;
  readonly calibration?: AnthropicTokenCalibration;
  readonly overheadTokens?: number;
  readonly toleranceTokens?: number;
  readonly recountedVisibleOutputTokens?: number;
  readonly billedVsRecountDeltaTokens?: number;
  readonly overBilledOutputTokens: number;
  readonly outputRateUsdPerMillion?: number;
  readonly overchargeUsd?: number;
  readonly expectedChargeUsd?: number | null;
  readonly observedChargeUsd?: number | null;
  readonly pricingVersion?: string | null;
  readonly pricingStatus: "priced" | "pricing_unknown" | "partial" | "not_priced";
  readonly boundMultiplier: number;
  readonly fallbackOverheadTokens?: typeof ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;
  readonly fallbackReason?: string;
  readonly overBoundTokens: number;
  readonly withinBound: boolean;
  readonly disputeEligible: false;
  readonly evidenceGradeCap?: "B";
  readonly caveat: typeof ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT;
  readonly note: typeof ANTHROPIC_TOKEN_CROSSCHECK_NOTE;
}

interface CalibrationSample {
  readonly countedOutputTokens: number;
  readonly billedVisibleOutputTokens: number;
  readonly localOutputTokens: number;
  readonly overheadObservationTokens: number;
  readonly countTokensSource: string;
  readonly observedAt: string;
}

export function createAnthropicTokenCalibrationCache(
  options: AnthropicTokenCalibrationCacheOptions = {},
): AnthropicTokenCalibrationCache {
  const samplesByModel = new Map<string, CalibrationSample[]>();
  const minSampleCount = options.minSampleCount ?? ANTHROPIC_TOKEN_CALIBRATION_DEFAULT_MIN_SAMPLES;

  return {
    addCountTokensSample(input) {
      const samples = samplesByModel.get(input.model) ?? [];
      const localEstimate = estimateAnthropicOfflineOutputTokens(input.deliveredOutputContent);
      const sample: CalibrationSample = {
        countedOutputTokens: input.countedOutputTokens,
        billedVisibleOutputTokens: input.billedVisibleOutputTokens,
        localOutputTokens: localEstimate.tokens,
        overheadObservationTokens: input.countedOutputTokens - input.billedVisibleOutputTokens,
        countTokensSource: input.countTokensSource,
        observedAt: input.observedAt ?? new Date().toISOString(),
      };
      samples.push(sample);
      samplesByModel.set(input.model, samples);
      return calibrationFromSamples(input.model, samples, minSampleCount);
    },
    calibrationForModel(model) {
      return calibrationFromSamples(model, samplesByModel.get(model) ?? [], minSampleCount);
    },
    reset() {
      samplesByModel.clear();
    },
  };
}

/**
 * @contract-id loss-detectors-v1
 */
export function crossCheckAnthropicOutputTokens(
  event: CanonicalEventV1,
  options: AnthropicTokenCrossCheckOptions = {},
): AnthropicTokenCrossCheck {
  if (event.request.provider !== "anthropic") {
    throw new Error("Anthropic token cross-check received a non-Anthropic event");
  }

  const responseChars = countResponseCharacters(event.response.content);
  const thinkingTokens = anthropicThinkingTokens(event);
  const billedVisibleOutputTokens = billedVisibleAnthropicOutputTokens(event);
  const countTokens = options.countTokens ?? null;
  const calibration = options.calibration ?? null;

  if (
    countTokens &&
    calibration?.status === "verified" &&
    typeof calibration.overheadTokens === "number" &&
    typeof calibration.toleranceTokens === "number"
  ) {
    return verifiedCountTokensCrossCheck(event, {
      countTokens,
      calibration,
      responseChars,
      thinkingTokens,
      billedVisibleOutputTokens,
    });
  }

  return fallbackCrossCheck(event, {
    countTokens,
    calibration,
    responseChars,
    thinkingTokens,
    billedVisibleOutputTokens,
    fallbackReason: countTokens
      ? "count_tokens_calibration_unverified"
      : options.fallbackReason ?? "count_tokens_unavailable",
  });
}

export function billedVisibleAnthropicOutputTokens(event: CanonicalEventV1): number {
  return Math.max(0, event.usage.output - anthropicThinkingTokens(event));
}

/**
 * @contract-id loss-detectors-v1
 */
export function buildAnthropicTokenCrossCheckSignal(
  event: CanonicalEventV1,
  crossCheck: AnthropicTokenCrossCheck,
): LossSignal | null {
  if (crossCheck.withinBound) return null;

  if (crossCheck.mode === "count_tokens_recount" && crossCheck.overchargeUsd !== undefined) {
    return buildLossSignal({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      detector: "billing-integrity",
      event,
      failureClass: "anthropic_token_crosscheck",
      status: "candidate",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      valueKind: "money",
      dispute: false,
      liabilityParty: "unknown",
      expectedChargeUsd: crossCheck.expectedChargeUsd ?? null,
      observedChargeUsd: crossCheck.observedChargeUsd ?? null,
      providerRecoverableLossUsd: 0,
      pricingVersion: crossCheck.pricingVersion ?? null,
      pricingStatus: crossCheck.pricingStatus,
      valueJson: {
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        standardLossUsd: crossCheck.overchargeUsd,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: crossCheck.overchargeUsd,
        overchargeUsd: crossCheck.overchargeUsd,
        methodMetadata: crossCheck.methodMetadata,
      },
      evidence: crossCheckEvidence(crossCheck),
    });
  }

  return buildLossSignal({
    code: "ANTHROPIC_TOKEN_CROSSCHECK",
    detector: "billing-integrity",
    event,
    failureClass: "anthropic_token_crosscheck",
    status: "triage_only",
    evidenceGrade: "triage_only",
    creditCandidate: false,
    valueKind: "triage",
    dispute: false,
    liabilityParty: "unknown",
    expectedChargeUsd: null,
    providerRecoverableLossUsd: null,
    pricingVersion: null,
    pricingStatus: "not_priced",
    evidence: crossCheckEvidence(crossCheck),
  });
}

function verifiedCountTokensCrossCheck(
  event: CanonicalEventV1,
  input: {
    readonly countTokens: AnthropicCountTokensRecount;
    readonly calibration: AnthropicTokenCalibration;
    readonly responseChars: number;
    readonly thinkingTokens: number;
    readonly billedVisibleOutputTokens: number;
  },
): AnthropicTokenCrossCheck {
  const recountedVisibleOutputTokens = Math.max(
    0,
    input.countTokens.outputTokens - (input.calibration.overheadTokens ?? 0),
  );
  const billedVsRecountDeltaTokens =
    input.billedVisibleOutputTokens - recountedVisibleOutputTokens;
  const overBilledOutputTokens = billedVsRecountDeltaTokens > (input.calibration.toleranceTokens ?? 0)
    ? billedVsRecountDeltaTokens
    : 0;
  const price = lookupPriceForEvent(event);
  const outputRate = pricedOutputRate(price);
  const overchargeUsd = outputRate && overBilledOutputTokens > 0
    ? roundUsd((overBilledOutputTokens * outputRate.rateUsdPerMillion) / 1_000_000)
    : undefined;
  const observedChargeUsd = price.ok ? price.expectedChargeUsd : null;
  const expectedChargeUsd = observedChargeUsd !== null && overchargeUsd !== undefined
    ? roundUsd(Math.max(0, observedChargeUsd - overchargeUsd))
    : null;

  return {
    provider: "anthropic",
    mode: "count_tokens_recount",
    methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
    methodMetadata: anthropicTokenMethodMetadata(),
    billedOutputTokens: event.usage.output,
    thinkingTokens: input.thinkingTokens,
    billedVisibleOutputTokens: input.billedVisibleOutputTokens,
    responseChars: input.responseChars,
    outputTokenUpperBound: recountedVisibleOutputTokens + (input.calibration.toleranceTokens ?? 0),
    countedOutputTokens: input.countTokens.outputTokens,
    ...(input.countTokens.source ? { countTokensSource: input.countTokens.source } : {}),
    calibrationStatus: input.calibration.status,
    calibration: input.calibration,
    overheadTokens: input.calibration.overheadTokens,
    toleranceTokens: input.calibration.toleranceTokens,
    recountedVisibleOutputTokens,
    billedVsRecountDeltaTokens,
    overBilledOutputTokens,
    ...(outputRate ? { outputRateUsdPerMillion: outputRate.rateUsdPerMillion } : {}),
    ...(overchargeUsd !== undefined ? { overchargeUsd } : {}),
    expectedChargeUsd,
    observedChargeUsd,
    pricingVersion: outputRate?.pricingVersion ?? null,
    pricingStatus: outputRate
      ? "priced"
      : price.ok
        ? price.pricingStatus
        : "pricing_unknown",
    boundMultiplier: 1,
    overBoundTokens: overBilledOutputTokens,
    withinBound: overBilledOutputTokens === 0 || overchargeUsd === undefined,
    disputeEligible: false,
    evidenceGradeCap: "B",
    caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
    note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  };
}

function fallbackCrossCheck(
  event: CanonicalEventV1,
  input: {
    readonly countTokens: AnthropicCountTokensRecount | null;
    readonly calibration: AnthropicTokenCalibration | null;
    readonly responseChars: number;
    readonly thinkingTokens: number;
    readonly billedVisibleOutputTokens: number;
    readonly fallbackReason: string;
  },
): AnthropicTokenCrossCheck {
  const outputTokenUpperBound =
    Math.ceil(input.responseChars * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER) +
    ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;
  const overBoundTokens = Math.max(0, input.billedVisibleOutputTokens - outputTokenUpperBound);

  return {
    provider: "anthropic",
    mode: "fallback_safe_bound",
    billedOutputTokens: event.usage.output,
    thinkingTokens: input.thinkingTokens,
    billedVisibleOutputTokens: input.billedVisibleOutputTokens,
    responseChars: input.responseChars,
    outputTokenUpperBound,
    ...(input.countTokens
      ? {
          countedOutputTokens: input.countTokens.outputTokens,
          ...(input.countTokens.source ? { countTokensSource: input.countTokens.source } : {}),
        }
      : {}),
    ...(input.calibration
      ? {
          calibrationStatus: input.calibration.status,
          calibration: input.calibration,
        }
      : {}),
    boundMultiplier: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
    fallbackOverheadTokens: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
    fallbackReason: input.fallbackReason,
    overBilledOutputTokens: 0,
    pricingStatus: "not_priced",
    overBoundTokens,
    withinBound: overBoundTokens === 0,
    disputeEligible: false,
    caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
    note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  };
}

function calibrationFromSamples(
  model: string,
  samples: readonly CalibrationSample[],
  minSampleCount: number,
): AnthropicTokenCalibration {
  const provenance = calibrationProvenance(samples);
  if (samples.length < minSampleCount) {
    return {
      model,
      status: "unverified",
      sampleCount: samples.length,
      minSampleCount,
      provenance,
    };
  }

  const ratioSamples = samples
    .filter((sample) => sample.localOutputTokens > 0)
    .map((sample) => sample.countedOutputTokens / sample.localOutputTokens);
  const overheadTokens = Math.max(
    0,
    Math.round(median(samples.map((sample) => sample.overheadObservationTokens))),
  );
  const residuals = samples.map((sample) =>
    Math.abs(sample.billedVisibleOutputTokens - Math.max(0, sample.countedOutputTokens - overheadTokens))
  );

  return {
    model,
    status: "verified",
    sampleCount: samples.length,
    minSampleCount,
    ...(ratioSamples.length > 0 ? { ratio: roundRatio(mean(ratioSamples)) } : {}),
    overheadTokens,
    toleranceTokens: Math.ceil(mean(residuals) + standardDeviation(residuals)),
    provenance,
  };
}

function calibrationProvenance(samples: readonly CalibrationSample[]): AnthropicTokenCalibrationProvenance {
  const latest = samples[samples.length - 1];
  return {
    source: "runtime_count_tokens",
    countTokensSource: latest?.countTokensSource ?? "anthropic.messages.count_tokens",
    localEstimator: CLAUDE_TOKENIZER_ESTIMATOR,
    localEstimatorRevision: CLAUDE_TOKENIZER_REVISION,
    localEstimatorSourceUrl: CLAUDE_TOKENIZER_SOURCE_URL,
    localEstimatorLicense: CLAUDE_TOKENIZER_LICENSE,
    countTokensDocsUrl: ANTHROPIC_COUNT_TOKENS_DOCS_URL,
    updatedAt: latest?.observedAt ?? new Date(0).toISOString(),
  };
}

function anthropicTokenMethodMetadata(): AnthropicTokenMethodMetadata {
  return {
    methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
    evidenceGradeCap: "B",
    evidenceGradeCapReason: "provider_assisted_recount",
    recountOracle: "anthropic.messages.count_tokens",
    recountOracleDocsUrl: ANTHROPIC_COUNT_TOKENS_DOCS_URL,
    localEstimator: CLAUDE_TOKENIZER_ESTIMATOR,
    localEstimatorUrl: CLAUDE_TOKENIZER_SOURCE_URL,
    localEstimatorRevision: CLAUDE_TOKENIZER_REVISION,
    localEstimatorLicense: CLAUDE_TOKENIZER_LICENSE,
    caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
  };
}

function crossCheckEvidence(crossCheck: AnthropicTokenCrossCheck): Record<string, unknown> {
  return definedRecord({
    provider: crossCheck.provider,
    mode: crossCheck.mode,
    methodId: crossCheck.methodId,
    methodMetadata: crossCheck.methodMetadata,
    billedOutputTokens: crossCheck.billedOutputTokens,
    thinkingTokens: crossCheck.thinkingTokens,
    billedVisibleOutputTokens: crossCheck.billedVisibleOutputTokens,
    responseChars: crossCheck.responseChars,
    outputTokenUpperBound: crossCheck.outputTokenUpperBound,
    countedOutputTokens: crossCheck.countedOutputTokens,
    countTokensSource: crossCheck.countTokensSource,
    calibrationStatus: crossCheck.calibrationStatus,
    calibration: crossCheck.calibration,
    overheadTokens: crossCheck.overheadTokens,
    toleranceTokens: crossCheck.toleranceTokens,
    recountedVisibleOutputTokens: crossCheck.recountedVisibleOutputTokens,
    billedVsRecountDeltaTokens: crossCheck.billedVsRecountDeltaTokens,
    overBilledOutputTokens: crossCheck.overBilledOutputTokens,
    outputRateUsdPerMillion: crossCheck.outputRateUsdPerMillion,
    overchargeUsd: crossCheck.overchargeUsd,
    expectedChargeUsd: crossCheck.expectedChargeUsd,
    observedChargeUsd: crossCheck.observedChargeUsd,
    pricingVersion: crossCheck.pricingVersion,
    pricingStatus: crossCheck.pricingStatus,
    boundMultiplier: crossCheck.boundMultiplier,
    fallbackOverheadTokens: crossCheck.fallbackOverheadTokens,
    fallbackReason: crossCheck.fallbackReason,
    overBoundTokens: crossCheck.overBoundTokens,
    disputeEligible: crossCheck.disputeEligible,
    evidenceGradeCap: crossCheck.evidenceGradeCap,
    caveat: crossCheck.caveat,
    note: crossCheck.note,
  });
}

function anthropicThinkingTokens(event: CanonicalEventV1): number {
  const categories = (event as EventWithUsageCategories).usage.categories ?? [];
  const seen = new Set<string>();
  let total = 0;
  for (const category of categories) {
    const key = category.sourceField ?? category.category;
    if (seen.has(key)) continue;
    if (
      category.category === "thinking" ||
      category.category === "provider:anthropic:output_tokens_details.thinking_tokens" ||
      category.sourceField === "output_tokens_details.thinking_tokens"
    ) {
      seen.add(key);
      total += category.tokens;
    }
  }
  return total;
}

function pricedOutputRate(
  priceLookup: PriceLookupResult,
): { readonly rateUsdPerMillion: number; readonly pricingVersion: string } | null {
  if (!priceLookup.ok || priceLookup.pricingStatus !== "priced") return null;
  const output = priceLookup.components.find((component) =>
    component.category === "output" && component.rateUsdPerMillion !== null
  );
  if (!output?.rateUsdPerMillion) return null;
  return {
    rateUsdPerMillion: output.rateUsdPerMillion,
    pricingVersion: priceLookup.pricingVersion,
  };
}

function countResponseCharacters(content: string): number {
  return Array.from(content).length;
}

function definedRecord(input: Record<string, unknown | undefined>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0;
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
