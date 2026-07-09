import type { CanonicalEventV1 } from "./canonical-event.js";
import { detectProviderDowntime } from "./availability.js";
import {
  buildCacheDiscountAtRiskSignal,
  detectOpenAiTokenRecount,
} from "./billing-integrity.js";
import { detectBrokenOutput } from "./broken-output.js";
import {
  detectLatencyBilled,
  type LatencySloPolicy,
} from "./latency.js";
import { detectServedModelMismatch } from "./model-identity.js";
import { estimateCostUsd } from "./pricing.js";
import { detectPricingStatusSignal } from "./pricing-signal.js";
import { detectStatelessRefusal } from "./refusals.js";
import {
  billedEmptyEvidence,
  buildLossSignal,
  isBilledButEmpty,
  refundableCandidateEconomics,
} from "./signal.js";
import { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
import { detectToolCallValidity } from "./tool-call-validity.js";
import type { LossSignal } from "./types.js";

export interface StatelessDetectorOptions {
  readonly latencySloPolicy?: LatencySloPolicy | null;
}

type Detector = (
  event: CanonicalEventV1,
  options: StatelessDetectorOptions,
) => DetectorResult;

type DetectorResult = LossSignal | readonly LossSignal[] | null;

function detectBilledEmpty(event: CanonicalEventV1): LossSignal | null {
  if (!isBilledButEmpty(event)) return null;

  return buildLossSignal({
    code: "BILLED_EMPTY",
    detector: "billing-integrity",
    event,
      failureClass: "empty_output",
      ...refundableCandidateEconomics(event),
      evidence: billedEmptyEvidence(event),
    });
  }

function isFeatureEnabled(name: string): boolean {
  return process.env[name] !== "false";
}

function statelessDetectors(): readonly Detector[] {
  return [
    (event) => detectPricingStatusSignal(event),
    (event) => detectServedModelMismatch(event),
    (event) => detectBilledEmpty(event),
    (event) => detectBrokenOutput(event),
    ...(isFeatureEnabled("DOWNTIME_DETECTOR_ENABLED")
      ? [(event: CanonicalEventV1) => detectProviderDowntime(event)]
      : []),
    ...(isFeatureEnabled("LATENCY_DETECTOR_ENABLED")
      ? [(event: CanonicalEventV1, options: StatelessDetectorOptions) =>
        detectLatencyBilled(event, {
          latencySloPolicy: options.latencySloPolicy,
        })]
      : []),
    ...(isFeatureEnabled("OPENAI_TOKEN_RECOUNT_ENABLED")
      ? [(event: CanonicalEventV1) => detectOpenAiTokenRecount(event)]
      : []),
    (event) => buildCacheDiscountAtRiskSignal(event),
    (event) => detectStatelessRefusal(event),
    (event) => detectToolCallValidity(event),
  ];
}

/**
 * @contract-id loss-detectors-v1
 */
export function runStatelessDetectors(
  event: CanonicalEventV1,
  options: StatelessDetectorOptions = {},
): LossSignal[] {
  const signals: LossSignal[] = [];
  const seenCodes = new Set<string>();

  for (const detector of statelessDetectors()) {
    for (const signal of detectorSignals(detector(event, options))) {
      if (seenCodes.has(signal.code)) continue;
      seenCodes.add(signal.code);
      signals.push(signal);
    }
  }

  return applyStandardLossEconomicsToSignals(event, signals);
}

function detectorSignals(result: DetectorResult): readonly LossSignal[] {
  if (!result) return [];
  return isLossSignalArray(result) ? result : [result];
}

function isLossSignalArray(result: DetectorResult): result is readonly LossSignal[] {
  return Array.isArray(result);
}

export { estimateCostUsd };
export { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
export type { LossSignal };
