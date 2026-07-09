import { lookupPriceForEvent } from "./pricing.js";
import { buildLossSignal } from "./signal.js";
export function detectPricingStatusSignal(event) {
    return buildPricingStatusSignal(event, lookupPriceForEvent(event));
}
export function buildPricingStatusSignal(event, priceLookup, context = {}) {
    if (priceLookup.ok && priceLookup.pricingStatus === "priced")
        return null;
    const pricingStatus = priceLookup.ok ? priceLookup.pricingStatus : "pricing_unknown";
    return buildLossSignal({
        code: "PRICING_UNKNOWN",
        detector: "pricing",
        detectorVersion: "v1",
        event,
        domain: "usage",
        failureClass: pricingStatus === "partial" ? "pricing_partial" : "pricing_unknown",
        status: "pricing_unknown",
        evidenceGrade: "triage_only",
        severity: "warning",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        valueKind: "triage",
        observedChargeUsd: context.observedChargeUsd,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: null,
        pricingVersion: priceLookup.ok ? priceLookup.pricingVersion : null,
        pricingStatus,
        evidence: pricingEvidence(event, priceLookup, context),
    });
}
function pricingEvidence(event, priceLookup, context) {
    return {
        provider: event.request.provider,
        model: event.request.model,
        usageCategories: priceLookup.ok
            ? unpricedUsageCategories(priceLookup)
            : priceLookup.usageCategories,
        ...(priceLookup.ok
            ? {
                pricedSubtotalUsd: priceLookup.expectedChargeUsd,
                pricingVersion: priceLookup.pricingVersion,
                components: priceLookup.components,
            }
            : {}),
        ...(context.observedChargeUsd !== undefined
            ? { observedChargeUsd: context.observedChargeUsd }
            : {}),
        ...(context.observedChargeSource ? { observedChargeSource: context.observedChargeSource } : {}),
        ...(context.observedAt ? { observedAt: context.observedAt } : {}),
    };
}
function unpricedUsageCategories(priceLookup) {
    return priceLookup.components
        .filter((component) => component.pricingStatus === "unpriced")
        .map((component) => component.category);
}
//# sourceMappingURL=pricing-signal.js.map