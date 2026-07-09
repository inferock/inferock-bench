import { detectProviderDowntime } from "./availability.js";
import { buildCacheDiscountAtRiskSignal, detectOpenAiTokenRecount, } from "./billing-integrity.js";
import { detectBrokenOutput } from "./broken-output.js";
import { detectLatencyBilled, } from "./latency.js";
import { detectServedModelMismatch } from "./model-identity.js";
import { estimateCostUsd } from "./pricing.js";
import { detectPricingStatusSignal } from "./pricing-signal.js";
import { detectStatelessRefusal } from "./refusals.js";
import { billedEmptyEvidence, buildLossSignal, isBilledButEmpty, refundableCandidateEconomics, } from "./signal.js";
import { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
import { detectToolCallValidity } from "./tool-call-validity.js";
function detectBilledEmpty(event) {
    if (!isBilledButEmpty(event))
        return null;
    return buildLossSignal({
        code: "BILLED_EMPTY",
        detector: "billing-integrity",
        event,
        failureClass: "empty_output",
        ...refundableCandidateEconomics(event),
        evidence: billedEmptyEvidence(event),
    });
}
function isFeatureEnabled(name) {
    return process.env[name] !== "false";
}
function statelessDetectors() {
    return [
        (event) => detectPricingStatusSignal(event),
        (event) => detectServedModelMismatch(event),
        (event) => detectBilledEmpty(event),
        (event) => detectBrokenOutput(event),
        ...(isFeatureEnabled("DOWNTIME_DETECTOR_ENABLED")
            ? [(event) => detectProviderDowntime(event)]
            : []),
        ...(isFeatureEnabled("LATENCY_DETECTOR_ENABLED")
            ? [(event, options) => detectLatencyBilled(event, {
                    latencySloPolicy: options.latencySloPolicy,
                })]
            : []),
        ...(isFeatureEnabled("OPENAI_TOKEN_RECOUNT_ENABLED")
            ? [(event) => detectOpenAiTokenRecount(event)]
            : []),
        (event) => buildCacheDiscountAtRiskSignal(event),
        (event) => detectStatelessRefusal(event),
        (event) => detectToolCallValidity(event),
    ];
}
/**
 * @contract-id loss-detectors-v1
 */
export function runStatelessDetectors(event, options = {}) {
    const signals = [];
    const seenCodes = new Set();
    for (const detector of statelessDetectors()) {
        for (const signal of detectorSignals(detector(event, options))) {
            if (seenCodes.has(signal.code))
                continue;
            seenCodes.add(signal.code);
            signals.push(signal);
        }
    }
    return applyStandardLossEconomicsToSignals(event, signals);
}
function detectorSignals(result) {
    if (!result)
        return [];
    return isLossSignalArray(result) ? result : [result];
}
function isLossSignalArray(result) {
    return Array.isArray(result);
}
export { estimateCostUsd };
export { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
//# sourceMappingURL=stateless.js.map