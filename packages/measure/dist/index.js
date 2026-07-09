import { detectProviderDowntime } from "./availability.js";
import { buildCacheDiscountAtRiskSignal, detectBillingIntegrity, } from "./billing-integrity.js";
import { detectBrokenOutput } from "./broken-output.js";
import { detectLatencyBilled, } from "./latency.js";
import { detectServedModelMismatch } from "./model-identity.js";
import { detectPricingStatusSignal } from "./pricing-signal.js";
import { detectRefusal } from "./refusals.js";
import { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
import { detectToolCallValidity } from "./tool-call-validity.js";
const DETECTORS = [
    (event) => detectPricingStatusSignal(event),
    (event) => detectServedModelMismatch(event),
    (event) => detectBrokenOutput(event),
    (event) => detectProviderDowntime(event),
    (event, options) => detectLatencyBilled(event, {
        latencySloPolicy: options.latencySloPolicy,
    }),
    (event) => detectBillingIntegrity(event),
    (event) => buildCacheDiscountAtRiskSignal(event),
    (event) => detectRefusal(event),
    (event) => detectToolCallValidity(event),
];
/**
 * @contract-id loss-detectors-v1
 */
export function runDetectors(event, options = {}) {
    const signals = [];
    const seenCodes = new Set();
    for (const detector of DETECTORS) {
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
export * from "./anthropic-token-crosscheck.js";
export * from "./availability.js";
export * from "./billing-integrity.js";
export * from "./broken-output.js";
export * from "./canonical-event.js";
export * from "./factuality.js";
export * from "./latency.js";
export * from "./model-identity.js";
export * from "./output-schemas.js";
export * from "./pricing.js";
export * from "./pricing-signal.js";
export * from "./security-secrets.js";
export * from "./refusals.js";
export * from "./retry-amplification.js";
export * from "./scorecard.js";
export * from "./security.js";
export * from "./signal.js";
export * from "./sla-defaults.js";
export * from "./standard-loss.js";
export * from "./stream-termination.js";
export * from "./time-loss.js";
export * from "./tool-call-validity.js";
export * from "./types.js";
export * from "./usage-categories.js";
//# sourceMappingURL=index.js.map