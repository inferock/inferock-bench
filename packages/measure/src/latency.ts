import type { CanonicalEventV1 } from "./canonical-event.js";
import { isProviderDowntimeEvent } from "./availability.js";
import { lookupPriceForEvent, tokensBilledForEvent } from "./pricing.js";
import { buildLossSignal } from "./signal.js";
import {
  evaluateDefaultLatency,
  SLA_DEFAULTS,
  SLA_STANDARD_VERSION,
  UNRECOGNIZED_STANDARD_LOSS_EVIDENCE_GRADE,
  type LatencyDefaultEvaluation,
} from "./sla-defaults.js";
import {
  dollarTranslationForTimeLoss,
  TIME_LOSS_METHOD_LATENCY_EXCESS,
} from "./time-loss.js";
import type { LossSignal } from "./types.js";

export const DEFAULT_LATENCY_THRESHOLD_MS = 30_000;
export const DEFAULT_LATENCY_IMPACT_TPS_FLOOR = 5;

export const LATENCY_PERCENTILE_BUCKETS = [
  "p50_or_below",
  "p50_p75",
  "p75_p90",
  "p90_p95",
  "p95_p99",
  "p99_plus",
] as const;

const DEFAULT_LATENCY_IMPACT_BUCKETS: readonly LatencyPercentileBucket[] = [
  "p95_p99",
  "p99_plus",
];

export type LatencySloCreditBasis = "billed_wait";
export type LatencyPercentileBucket = (typeof LATENCY_PERCENTILE_BUCKETS)[number];
export type LatencyReasoningSegment = "reasoning" | "non_reasoning";

export interface LatencyImpactUsageCategory {
  readonly category: string;
  readonly tokens: number;
  readonly sourceField?: string;
}

export interface NoSloLatencyImpactSample {
  readonly sampleId?: string;
  readonly tenantId: string;
  readonly requestId: string;
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly model: string;
  readonly route?: string | null;
  readonly workloadClass?: string | null;
  readonly latencyMs: number;
  readonly outputTokens: number;
  readonly usageCategories?: readonly LatencyImpactUsageCategory[];
}

export interface NoSloLatencyImpactOptions {
  readonly minimumOutputTokensPerSecond?: number;
  readonly impactBuckets?: readonly LatencyPercentileBucket[];
}

export interface OutputBearingTpsInput {
  readonly latencyMs: number;
  readonly outputTokens: number;
  readonly minimumOutputTokensPerSecond?: number;
}

export interface NoSloLatencyImpactClassification extends NoSloLatencyImpactSample {
  readonly reasoningSegment: LatencyReasoningSegment;
  readonly partitionKey: string;
  readonly percentileRank: number;
  readonly bucket: LatencyPercentileBucket;
  readonly outputTokensPerSecond: number | null;
  readonly outputTpsFloorMet: boolean;
  readonly impactEligible: boolean;
  readonly timeLossMs: number;
}

export interface LatencySloPolicy {
  readonly policyId: string;
  readonly tenantId: string;
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly model: string | null;
  readonly route: string | null;
  readonly workloadClass: string | null;
  readonly totalSloMs: number;
  readonly sloSource: string;
  readonly sloVersion: string;
  readonly disclosedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly creditBasis: LatencySloCreditBasis | null;
  readonly inferockStandardDefault?: boolean;
}

export interface LatencyDetectorOptions {
  readonly latencySloPolicy?: LatencySloPolicy | null;
}

export interface LatencyTimeLossRepriceInput {
  readonly observedMs: number;
  readonly outputTokens: number;
  readonly acceptableStartMs: number;
  readonly acceptableMsPerOutputToken: number;
  readonly rateUsdPerHour: number;
}

export interface LatencyTimeLossRepriceResult {
  readonly acceptableTotalMs: number;
  readonly timeLossMs: number;
  readonly dollarTranslationUsd: number;
}

type LatencyTimingAttribution = "provider_elapsed" | "gateway_total_elapsed";

interface ProviderLatencyObservation {
  readonly observedMs: number;
  readonly timingAttribution: Extract<LatencyTimingAttribution, "provider_elapsed">;
  readonly providerRequestStartedAt: string;
  readonly providerResponseEndedAt: string;
}

export function latencyPercentileBucket(percentileRank: number): LatencyPercentileBucket {
  const bounded = Math.max(0, Math.min(1, percentileRank));
  if (bounded <= 0.50) return "p50_or_below";
  if (bounded <= 0.75) return "p50_p75";
  if (bounded <= 0.90) return "p75_p90";
  if (bounded <= 0.95) return "p90_p95";
  if (bounded < 1) return "p95_p99";
  return "p99_plus";
}

export function outputBearingCallMeetsTpsFloor(input: OutputBearingTpsInput): boolean {
  if (input.outputTokens <= 0) return false;
  if (input.latencyMs <= 0) return true;

  const minimum = input.minimumOutputTokensPerSecond ?? DEFAULT_LATENCY_IMPACT_TPS_FLOOR;
  return outputTokensPerSecond(input.latencyMs, input.outputTokens) >= minimum;
}

export function recomputeLatencyTimeLoss(
  input: LatencyTimeLossRepriceInput,
): LatencyTimeLossRepriceResult {
  const acceptableTotalMs = input.acceptableStartMs +
    input.outputTokens * input.acceptableMsPerOutputToken;
  const timeLossMs = Math.max(0, input.observedMs - acceptableTotalMs);
  return {
    acceptableTotalMs,
    timeLossMs,
    dollarTranslationUsd: dollarTranslationForTimeLoss(timeLossMs, input.rateUsdPerHour),
  };
}

export function latencyReasoningSegmentForUsageCategories(
  categories: readonly LatencyImpactUsageCategory[] = [],
): LatencyReasoningSegment {
  return categories.some((category) =>
    category.tokens > 0 &&
    (isReasoningCategoryName(category.category) ||
      isReasoningCategoryName(category.sourceField ?? ""))
  )
    ? "reasoning"
    : "non_reasoning";
}

export function classifyNoSloLatencyImpact(
  samples: readonly NoSloLatencyImpactSample[],
  options: NoSloLatencyImpactOptions = {},
): NoSloLatencyImpactClassification[] {
  const minimumOutputTokensPerSecond =
    options.minimumOutputTokensPerSecond ?? DEFAULT_LATENCY_IMPACT_TPS_FLOOR;
  const impactBuckets = new Set(options.impactBuckets ?? DEFAULT_LATENCY_IMPACT_BUCKETS);
  const partitions = new Map<string, NoSloLatencyImpactSample[]>();

  for (const sample of samples) {
    const partitionKey = latencyImpactPartitionKey(sample);
    partitions.set(partitionKey, [...(partitions.get(partitionKey) ?? []), sample]);
  }

  const rows: NoSloLatencyImpactClassification[] = [];
  for (const [partitionKey, partition] of partitions) {
    const sorted = [...partition].sort((left, right) =>
      left.latencyMs === right.latencyMs
        ? left.requestId.localeCompare(right.requestId)
        : left.latencyMs - right.latencyMs
    );

    for (const [index, sample] of sorted.entries()) {
      const percentileRank = (index + 1) / sorted.length;
      const bucket = latencyPercentileBucket(percentileRank);
      const outputTpsFloorMet = outputBearingCallMeetsTpsFloor({
        latencyMs: sample.latencyMs,
        outputTokens: sample.outputTokens,
        minimumOutputTokensPerSecond,
      });
      const impactEligible = impactBuckets.has(bucket) &&
        (sample.outputTokens <= 0 || !outputTpsFloorMet);

      rows.push({
        ...sample,
        reasoningSegment: latencyReasoningSegmentForUsageCategories(sample.usageCategories),
        partitionKey,
        percentileRank,
        bucket,
        outputTokensPerSecond: sample.outputTokens > 0
          ? outputTokensPerSecond(sample.latencyMs, sample.outputTokens)
          : null,
        outputTpsFloorMet,
        impactEligible,
        timeLossMs: impactEligible ? sample.latencyMs : 0,
      });
    }
  }

  return rows.sort((left, right) => left.requestId.localeCompare(right.requestId));
}

export function detectLatencyBilled(
  event: CanonicalEventV1,
  options: LatencyDetectorOptions = {},
): LossSignal | null {
  const policy = options.latencySloPolicy;
  if (!policy) return null;
  if (policy.inferockStandardDefault) {
    return detectInferockStandardDefaultLatency(event, policy);
  }
  const observation = providerLatencyObservation(event);
  if (!observation) return null;
  if (observation.observedMs <= policy.totalSloMs) return null;
  if (tokensBilledForEvent(event) <= 0) return null;
  if (isProviderDowntimeEvent(event)) return null;

  const priceLookup = lookupPriceForEvent(event);
  const hasBilledWaitBasis = policy.creditBasis === "billed_wait";
  const hasKnownPrice = priceLookup.ok && priceLookup.pricingStatus === "priced";
  const refundableCandidate = hasBilledWaitBasis && hasKnownPrice;
  const excessWaitMs = observation.observedMs - policy.totalSloMs;
  const pricingStatus = priceLookup.ok ? priceLookup.pricingStatus : "pricing_unknown";
  const pricingVersion = priceLookup.ok ? priceLookup.pricingVersion : null;
  const expectedChargeUsd = refundableCandidate ? priceLookup.expectedChargeUsd : null;
  const providerRecognizedTimeLossMs = 0;
  const recognitionGapTimeMs = excessWaitMs;
  const dollarTranslationUsd = dollarTranslationForTimeLoss(
    excessWaitMs,
    SLA_DEFAULTS.timeValueRate.usdPerHour,
  );
  const providerRecognitionLine = latencyProviderRecognitionLine(event, policy, refundableCandidate);
  const timeLossTrace = disclosedLatencyTimeLossTrace(event, policy, observation, {
    timeLossMs: excessWaitMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs,
    dollarTranslationUsd,
  });

  return buildLossSignal({
    code: "LATENCY_BILLED",
    detector: "latency",
    event,
    failureClass: "latency",
    status: refundableCandidate ? "candidate" : "triage_only",
    evidenceGrade: refundableCandidate ? "refundable_candidate" : "triage_only",
    dispute: refundableCandidate,
    liabilityParty: refundableCandidate ? "provider" : "unknown",
    creditCandidate: refundableCandidate,
    valueKind: "time_loss",
    recoverableBasis: null,
    expectedChargeUsd,
    providerRecoverableLossUsd: expectedChargeUsd,
    pricingVersion,
    pricingStatus,
    valueJson: {
      latencyMs: observation.observedMs,
      providerElapsedMs: observation.observedMs,
      timingAttribution: observation.timingAttribution,
      sloMs: policy.totalSloMs,
      excessWaitMs,
      timeLossMs: excessWaitMs,
      timeLossSeconds: Math.round(excessWaitMs) / 1_000,
      timeLossKind: "latency_excess",
      timeLossPrimary: true,
      timeLossMethodId: TIME_LOSS_METHOD_LATENCY_EXCESS,
      observedMs: observation.observedMs,
      acceptableMs: policy.totalSloMs,
      excessMs: excessWaitMs,
      thresholdProposalId: policy.policyId,
      thresholdSourceLabel: policy.sloSource,
      thresholdConfirmed: true,
      thresholdEffectiveFrom: policy.effectiveFrom,
      thresholdEffectiveTo: policy.effectiveTo,
      acceptableStartMs: policy.totalSloMs,
      acceptableMsPerOutputToken: 0,
      dollarTranslationUsd,
      dollarTranslationRateId: "inferock-default-time-value-rate",
      dollarTranslationRateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
      dollarTranslationConfirmed: false,
      providerRecognizedTimeLossMs,
      providerRecognizedCreditUsd: expectedChargeUsd ?? 0,
      recognitionGapTimeMs,
      providerRecognitionLine,
      serviceTier: serviceTierForEvent(event),
      sloSource: policy.sloSource,
      timeLossTrace,
    },
    evidence: {
      latencyMs: observation.observedMs,
      providerElapsedMs: observation.observedMs,
      timingAttribution: observation.timingAttribution,
      sloMs: policy.totalSloMs,
      excessWaitMs,
      timeLossMs: excessWaitMs,
      providerRecognizedTimeLossMs,
      recognitionGapTimeMs,
      dollarTranslationUsd,
      sloSource: policy.sloSource,
      sloVersion: policy.sloVersion,
      sloDisclosedAt: policy.disclosedAt,
      sloEffectiveFrom: policy.effectiveFrom,
      sloEffectiveTo: policy.effectiveTo,
      route: event.request.route ?? policy.route,
      workloadClass: event.request.workloadClass ?? policy.workloadClass,
      startedAt: observation.providerRequestStartedAt,
      endedAt: observation.providerResponseEndedAt,
      providerRequestStartedAt: observation.providerRequestStartedAt,
      providerResponseEndedAt: observation.providerResponseEndedAt,
      coldStartExcluded: true,
      creditBasis: policy.creditBasis,
      pricingStatus,
      pricingVersion,
      serviceTier: serviceTierForEvent(event),
      providerRecognitionLine,
      timeLossTrace,
    },
  });
}

export function defaultLatencySloPolicyForEvent(event: CanonicalEventV1): LatencySloPolicy {
  const evaluation = evaluateDefaultLatency(event);
  return {
    policyId: `inferock-default:${evaluation.segment.segmentId}`,
    tenantId: event.request.tenantId,
    provider: event.request.provider,
    model: event.request.model,
    route: event.request.route ?? null,
    workloadClass: event.request.workloadClass ?? null,
    totalSloMs: evaluation.acceptableTotalMs,
    sloSource: "inferock-standard://sla-defaults/latency",
    sloVersion: SLA_STANDARD_VERSION,
    disclosedAt: SLA_DEFAULTS.signoff.signedOffAt,
    effectiveFrom: SLA_DEFAULTS.signoff.signedOffAt,
    effectiveTo: null,
    creditBasis: null,
    inferockStandardDefault: true,
  };
}

function detectInferockStandardDefaultLatency(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
): LossSignal | null {
  const evaluation = evaluateDefaultLatency(event);
  if (!evaluation.exercised || evaluation.excessMs <= 0) return null;
  if (tokensBilledForEvent(event) <= 0) return null;
  if (isProviderDowntimeEvent(event)) return null;

  return buildLossSignal({
    code: "LATENCY_BILLED",
    detector: "latency",
    event,
    failureClass: "latency",
    status: "candidate",
    evidenceGrade: UNRECOGNIZED_STANDARD_LOSS_EVIDENCE_GRADE,
    dispute: true,
    liabilityParty: "provider",
    creditCandidate: false,
    valueKind: "time_loss",
    recoverableBasis: null,
    expectedChargeUsd: null,
    providerRecoverableLossUsd: 0,
    pricingVersion: null,
    pricingStatus: "not_priced",
    valueJson: {
      latencyMs: event.timing.latencyMs,
      timingAttribution: "gateway_total_elapsed",
      sloMs: policy.totalSloMs,
      excessWaitMs: evaluation.excessMs,
      ...latencyTimeLossValueJson(event, policy, evaluation),
      standardLossUsd: evaluation.standardLossUsd,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: evaluation.standardLossUsd,
      activeSegment: evaluation.segment.segmentId,
      timeValueUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
    },
    evidence: defaultLatencyEvidence(event, policy, evaluation),
  });
}

function defaultLatencyEvidence(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
  evaluation: LatencyDefaultEvaluation,
): Record<string, unknown> {
  const thresholds = evaluation.thresholds;
  const standardLossUsd = evaluation.standardLossUsd;
  const providerRecognizedLossUsd = 0;
  const recognitionGapUsd = standardLossUsd - providerRecognizedLossUsd;
  const timeLossTrace = latencyTimeLossTrace(event, policy, evaluation);
  return {
    latencyMs: event.timing.latencyMs,
    timingAttribution: "gateway_total_elapsed",
    sloMs: policy.totalSloMs,
    excessWaitMs: evaluation.excessMs,
    sloSource: policy.sloSource,
    sloVersion: policy.sloVersion,
    sloDisclosedAt: policy.disclosedAt,
    sloEffectiveFrom: policy.effectiveFrom,
    sloEffectiveTo: policy.effectiveTo,
    route: event.request.route ?? policy.route,
    workloadClass: event.request.workloadClass ?? policy.workloadClass,
    startedAt: event.timing.startedAt,
    endedAt: event.timing.endedAt,
    coldStartExcluded: true,
    creditBasis: policy.creditBasis,
    providerRecognizedLossUsd,
    standardLossUsd,
    recognitionGapUsd,
    evidenceGradeLabel: SLA_DEFAULTS.evidenceGrades.unrecognizedStandardLoss,
    timeLossMs: evaluation.excessMs,
    providerRecognizedTimeLossMs: 0,
    recognitionGapTimeMs: evaluation.excessMs,
    providerRecognitionLine: latencyProviderRecognitionLine(event, policy, false),
    activeLatencySegment: evaluation.segment,
    latencyThresholds: thresholds,
    observedLatency: evaluation.observed,
    latencyMetricGrades: evaluation.metricGrades,
    timeValueRate: SLA_DEFAULTS.timeValueRate,
    computationTrace: {
      methodId: "latency_excess_v1",
      methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
      standardVersion: SLA_STANDARD_VERSION,
      timeLossTrace,
      inputs: {
        observedTotalMs: evaluation.observed.totalMs,
        timingAttribution: "gateway_total_elapsed",
        acceptableTotalMs: evaluation.acceptableTotalMs,
        acceptableStartMs: thresholds.acceptableStartMs,
        acceptableMsPerOutputToken: thresholds.acceptableMsPerOutputToken,
        outputTokens: evaluation.observed.outputTokens,
        segmentId: evaluation.segment.segmentId,
        segmentLabel: evaluation.segment.label,
        rateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
        providerRecognizedLossUsd,
      },
      formulas: {
        acceptableTotalMs:
          "acceptableStartMs + outputTokens * acceptableMsPerOutputToken",
        excessMs: "max(0, observedTotalMs - acceptableTotalMs)",
        timeLossMs: "excessMs",
        dollarTranslationUsd: "timeLossMs * rateUsdPerHour / 3600000",
        standardLossUsd: "excessMs * rateUsdPerHour / 3600000",
        recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
      },
      intermediateSteps: {
        acceptableTotalMs: evaluation.acceptableTotalMs,
        excessMs: evaluation.excessMs,
        standardLossFormula:
          `${evaluation.excessMs} * ${SLA_DEFAULTS.timeValueRate.usdPerHour} / 3600000`,
        recognitionGapFormula:
          `${standardLossUsd} - ${providerRecognizedLossUsd}`,
      },
      outputs: {
        timeLossMs: evaluation.excessMs,
        excessMs: evaluation.excessMs,
        dollarTranslationUsd: standardLossUsd,
        standardLossUsd,
        providerRecognizedLossUsd,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: evaluation.excessMs,
        recognitionGapUsd,
      },
      sourceRefs: {
        thresholds: SLA_DEFAULTS.latencySegments[evaluation.segment.segmentId].sourceIds,
        rate: SLA_DEFAULTS.timeValueRate.sourceIds,
      },
      oneLine: `observed ${formatSeconds(evaluation.observed.totalMs)} - ${
        formatSeconds(evaluation.acceptableTotalMs)
      } acceptable (${evaluation.segment.label}) = ${formatSeconds(evaluation.excessMs)} excess x $${
        SLA_DEFAULTS.timeValueRate.usdPerHour
      }/hr = $${standardLossUsd.toFixed(2)} standard loss; provider-recognized $${providerRecognizedLossUsd.toFixed(2)} -> $${recognitionGapUsd.toFixed(2)} unrecognized`,
    },
  };
}

function latencyTimeLossValueJson(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
  evaluation: LatencyDefaultEvaluation,
): Record<string, unknown> {
  return {
    timeLossMs: evaluation.excessMs,
    timeLossSeconds: Math.round(evaluation.excessMs) / 1_000,
    timeLossKind: "latency_excess",
    timeLossPrimary: true,
    timeLossMethodId: TIME_LOSS_METHOD_LATENCY_EXCESS,
    timingAttribution: "gateway_total_elapsed",
    observedMs: evaluation.observed.totalMs,
    acceptableMs: evaluation.acceptableTotalMs,
    excessMs: evaluation.excessMs,
    thresholdProposalId: policy.policyId,
    thresholdSourceLabel: "The Inferock Standard default threshold proposal",
    thresholdConfirmed: false,
    thresholdEffectiveFrom: policy.effectiveFrom,
    thresholdEffectiveTo: policy.effectiveTo,
    dollarTranslationUsd: evaluation.standardLossUsd,
    dollarTranslationRateId: "inferock-default-time-value-rate",
    dollarTranslationRateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
    dollarTranslationConfirmed: false,
    providerRecognizedTimeLossMs: 0,
    providerRecognizedCreditUsd: null,
    recognitionGapTimeMs: evaluation.excessMs,
    providerRecognitionLine: latencyProviderRecognitionLine(event, policy, false),
    timeLossTrace: latencyTimeLossTrace(event, policy, evaluation),
  };
}

function disclosedLatencyTimeLossTrace(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
  observation: ProviderLatencyObservation,
  outputs: {
    readonly timeLossMs: number;
    readonly providerRecognizedTimeLossMs: number;
    readonly recognitionGapTimeMs: number;
    readonly dollarTranslationUsd: number;
  },
): Record<string, unknown> {
  return {
    methodId: TIME_LOSS_METHOD_LATENCY_EXCESS,
    methodVersion: policy.sloVersion,
    standardVersion: SLA_STANDARD_VERSION,
    inputs: {
      requestId: event.request.requestId,
      observedProviderElapsedMs: observation.observedMs,
      timingAttribution: observation.timingAttribution,
      providerRequestStartedAt: observation.providerRequestStartedAt,
      providerResponseEndedAt: observation.providerResponseEndedAt,
      acceptableTotalMs: policy.totalSloMs,
      acceptableStartMs: policy.totalSloMs,
      acceptableMsPerOutputToken: 0,
      outputTokens: event.usage.output,
      thresholdProposalId: policy.policyId,
      thresholdConfirmed: true,
      thresholdSource: policy.sloSource,
      creditBasis: policy.creditBasis,
      rateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
    },
    formulas: {
      acceptableTotalMs: "provider or contract SLO total",
      timeLossMs: "max(0, observedProviderElapsedMs - acceptableTotalMs)",
      dollarTranslationUsd: "timeLossMs * rateUsdPerHour / 3600000",
      recognitionGapTimeMs: "timeLossMs - providerRecognizedTimeLossMs",
    },
    outputs,
  };
}

function latencyTimeLossTrace(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
  evaluation: LatencyDefaultEvaluation,
): Record<string, unknown> {
  const thresholds = evaluation.thresholds;
  return {
    methodId: TIME_LOSS_METHOD_LATENCY_EXCESS,
    methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
    standardVersion: SLA_STANDARD_VERSION,
    inputs: {
      requestId: event.request.requestId,
      observedTotalMs: evaluation.observed.totalMs,
      timingAttribution: "gateway_total_elapsed",
      acceptableTotalMs: evaluation.acceptableTotalMs,
      acceptableStartMs: thresholds.acceptableStartMs,
      acceptableMsPerOutputToken: thresholds.acceptableMsPerOutputToken,
      outputTokens: evaluation.observed.outputTokens,
      segmentId: evaluation.segment.segmentId,
      thresholdProposalId: policy.policyId,
      thresholdConfirmed: false,
      rateUsdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
    },
    formulas: {
      acceptableTotalMs: "acceptableStartMs + outputTokens * acceptableMsPerOutputToken",
      timeLossMs: "max(0, observedTotalMs - acceptableTotalMs)",
      dollarTranslationUsd: "timeLossMs * rateUsdPerHour / 3600000",
    },
    outputs: {
      timeLossMs: evaluation.excessMs,
      providerRecognizedTimeLossMs: 0,
      recognitionGapTimeMs: evaluation.excessMs,
      dollarTranslationUsd: evaluation.standardLossUsd,
    },
  };
}

function latencyProviderRecognitionLine(
  event: CanonicalEventV1,
  policy: LatencySloPolicy,
  refundableCandidate: boolean,
): string {
  if (refundableCandidate) {
    return "Provider-recognized: configured provider latency credit basis for this receipt";
  }
  const serviceTier = serviceTierForEvent(event);
  const standardTier = serviceTier === "default" ||
    serviceTier === "standard" ||
    serviceTier === "auto";
  if (
    standardTier &&
    event.request.provider === policy.provider &&
    (event.request.provider === "openai" || event.request.provider === "anthropic")
  ) {
    return "Provider-recognized: $0 / 0s without a first-party latency SLA";
  }
  return "Provider-recognized: no configured provider latency credit basis for this receipt";
}

function serviceTierForEvent(event: CanonicalEventV1): string | null {
  const metadata = event as CanonicalEventV1 & {
    readonly response: CanonicalEventV1["response"] & {
      readonly serviceTier?: string;
    };
    readonly usage: CanonicalEventV1["usage"] & {
      readonly serviceTier?: string;
    };
  };
  return metadata.response.serviceTier ?? metadata.usage.serviceTier ?? null;
}

function providerLatencyObservation(event: CanonicalEventV1): ProviderLatencyObservation | null {
  const timing = event.timing;
  if (
    timing.providerElapsedMs === undefined ||
    !Number.isFinite(timing.providerElapsedMs) ||
    timing.providerRequestStartedAt === undefined ||
    timing.providerResponseEndedAt === undefined
  ) {
    return null;
  }
  return {
    observedMs: timing.providerElapsedMs,
    timingAttribution: "provider_elapsed",
    providerRequestStartedAt: timing.providerRequestStartedAt,
    providerResponseEndedAt: timing.providerResponseEndedAt,
  };
}

function latencyImpactPartitionKey(sample: NoSloLatencyImpactSample): string {
  return [
    sample.tenantId,
    sample.provider,
    sample.model,
    sample.route ?? "",
    sample.workloadClass ?? "",
    latencyReasoningSegmentForUsageCategories(sample.usageCategories),
  ].join("\u001f");
}

function outputTokensPerSecond(latencyMs: number, outputTokens: number): number {
  if (latencyMs <= 0) return Number.POSITIVE_INFINITY;
  return outputTokens / (latencyMs / 1000);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function isReasoningCategoryName(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    "reasoning",
    "thinking",
    "hidden_output",
    "output_hidden",
    "completion_reasoning",
    "completion_tokens_details.reasoning_tokens",
    "output_tokens_details.reasoning_tokens",
    "output_tokens_details.thinking_tokens",
    "provider:openai:completion_tokens_details.reasoning_tokens",
    "provider:openai:output_tokens_details.reasoning_tokens",
    "provider:anthropic:output_tokens_details.thinking_tokens",
  ].includes(normalized);
}
