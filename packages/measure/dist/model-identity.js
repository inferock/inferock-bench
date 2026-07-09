import { lookupPriceForEventModel, roundUsd, } from "./pricing.js";
import { buildLossSignal } from "./signal.js";
import { SLA_DEFAULTS } from "./sla-defaults.js";
const DETECTOR_VERSION = "smm-v1";
const OPENAI_DATED_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
const ANTHROPIC_DATED_SNAPSHOT_SUFFIX = /-\d{8}$/;
const GEMINI_ALLOWED_SERVED_VERSION_ALIASES = new Map([
    ["gemini-2.5-flash", ["gemini-2.5-flash-001"]],
]);
/**
 * Detects provider-response model identity mismatches.
 *
 * Evidence gates are intentionally strict: only canonical v2 events with both
 * requested and provider-served model IDs, and with response.servedModelSource
 * explicitly set to provider_response, can emit.
 */
export function detectServedModelMismatch(event, options = {}) {
    if (schemaVersionForEvent(event) !== "v2")
        return null;
    const requestFields = event.request;
    const responseFields = event.response;
    if (responseFields.servedModelSource !== "provider_response")
        return null;
    const requestedModel = cleanModelId(requestFields.requestedModel ?? event.request.model);
    const servedModel = cleanModelId(responseFields.servedModel);
    if (!requestedModel || !servedModel)
        return null;
    const requestedNormalized = normalizeModelId(event.request.provider, requestedModel);
    const servedNormalized = normalizeModelId(event.request.provider, servedModel);
    if (requestedNormalized === servedNormalized)
        return null;
    const aliasGuard = documentedAliasRollover(event.request.provider, requestedNormalized, servedNormalized);
    if (aliasGuard.allowed)
        return null;
    const pricing = priceContextForMismatch(event, requestedModel, servedModel);
    const economics = economicsForMismatch({
        event,
        requestedModel,
        servedModel,
        requestedNormalized,
        servedNormalized,
        pricing,
        billingContext: options.billingContext,
    });
    return buildLossSignal({
        code: "SERVED_MODEL_MISMATCH",
        detector: "model-identity",
        detectorVersion: DETECTOR_VERSION,
        event,
        domain: "usage",
        failureClass: "served_model_mismatch",
        severity: "loss",
        status: economics.status,
        evidenceGrade: economics.evidenceGrade,
        dispute: economics.dispute,
        liabilityParty: economics.liabilityParty,
        creditCandidate: economics.creditCandidate,
        valueKind: economics.valueKind,
        recoverableBasis: economics.recoverableBasis,
        observedChargeUsd: economics.observedChargeUsd,
        expectedChargeUsd: economics.expectedChargeUsd,
        providerRecoverableLossUsd: economics.providerRecoverableLossUsd,
        pricingVersion: economics.pricingVersion,
        pricingStatus: economics.pricingStatus,
        valueJson: compactRecord({
            requestedModel,
            servedModel,
            servedModelSource: responseFields.servedModelSource,
            evidenceMode: economics.evidenceMode,
            pricingDeltaUsd: economics.providerRecoverableLossUsd,
            standardLossUsd: economics.standardLossUsd,
        }),
        evidence: compactRecord({
            reason: "provider_response_served_model_differs_from_requested_model",
            provider: event.request.provider,
            requestedModel,
            servedModel,
            normalizedRequestedModel: requestedNormalized,
            normalizedServedModel: servedNormalized,
            responseServedModelSource: responseFields.servedModelSource,
            evidenceRequirements: {
                canonicalSchemaVersion: "v2",
                requestedModelPresent: true,
                servedModelPresent: true,
                servedModelSource: "provider_response",
                provenance: "response.servedModelSource=provider_response",
            },
            falsePositiveGuards: {
                caseOnlyDifferenceSuppressed: true,
                documentedAliasRolloverSuppressed: true,
                serviceTierOnlyIgnored: true,
                systemFingerprintOnlyIgnored: true,
                aliasGuardVersion: "provider-alias-guards-v1",
            },
            aliasResolution: {
                allowed: false,
                reason: aliasGuard.reason,
            },
            modelComparison: {
                requestedModel,
                servedModel,
                providerCaseRule: "trim_and_case_fold_before_comparison",
            },
            providerRequestId: responseFields.providerRequestId ?? requestFields.providerRequestId,
            providerResponseId: responseFields.providerResponseId,
            rawObjectId: responseFields.rawObjectId,
            systemFingerprint: responseFields.systemFingerprint,
            serviceTier: responseFields.serviceTier,
            pricing: pricingEvidence(pricing),
            billingContext: billingContextEvidence(options.billingContext),
            computationTrace: economics.computationTrace,
        }),
    });
}
function economicsForMismatch(input) {
    const refundable = refundableOvercharge(input);
    if (refundable)
        return refundable;
    return triageOnlyEconomics(input);
}
function refundableOvercharge(input) {
    const billedModel = cleanModelId(input.billingContext?.provenBilledModel);
    if (!billedModel)
        return null;
    if (normalizeModelId(input.event.request.provider, billedModel) !== input.requestedNormalized)
        return null;
    if (!bothModelsFullyPriced(input.pricing))
        return null;
    const requestedChargeUsd = input.pricing.requestedLookup.expectedChargeUsd;
    const servedChargeUsd = input.pricing.servedLookup.expectedChargeUsd;
    const observedChargeUsd = observedCharge(input.billingContext);
    const overchargeDeltaUsd = observedChargeUsd === null
        ? roundUsd(Math.max(0, requestedChargeUsd - servedChargeUsd))
        : roundUsd(Math.max(0, observedChargeUsd - servedChargeUsd));
    if (overchargeDeltaUsd <= 0)
        return null;
    return {
        status: "candidate",
        evidenceGrade: "refundable_candidate",
        dispute: true,
        liabilityParty: "provider",
        creditCandidate: true,
        valueKind: "money",
        recoverableBasis: "overcharge_delta",
        observedChargeUsd,
        expectedChargeUsd: servedChargeUsd,
        providerRecoverableLossUsd: overchargeDeltaUsd,
        pricingVersion: input.pricing.pricingVersion,
        pricingStatus: "priced",
        standardLossUsd: overchargeDeltaUsd,
        evidenceMode: "overcharge_delta",
        computationTrace: overchargeComputationTrace({
            ...input,
            billedModel,
            observedChargeUsd,
            requestedChargeUsd,
            servedChargeUsd,
            overchargeDeltaUsd,
        }),
    };
}
function triageOnlyEconomics(input) {
    return {
        status: "triage_only",
        evidenceGrade: "triage_only",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        valueKind: "triage",
        recoverableBasis: null,
        observedChargeUsd: null,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: 0,
        pricingVersion: input.pricing.pricingVersion,
        pricingStatus: input.pricing.pricingStatus,
        standardLossUsd: 0,
        evidenceMode: "identity_triage",
        computationTrace: zeroDollarComputationTrace({
            requestedModel: input.requestedModel,
            servedModel: input.servedModel,
            pricingStatus: input.pricing.pricingStatus,
            billingBasisPresent: Boolean(input.billingContext?.provenBilledModel),
        }),
    };
}
function priceContextForMismatch(event, requestedModel, servedModel) {
    const requestedLookup = lookupPriceForEventModel(event, requestedModel);
    const servedLookup = lookupPriceForEventModel(event, servedModel);
    return {
        requestedLookup,
        servedLookup,
        pricingStatus: combinedPricingStatus(requestedLookup, servedLookup),
        pricingVersion: combinedPricingVersion(requestedLookup, servedLookup),
    };
}
function bothModelsFullyPriced(pricing) {
    return pricing.requestedLookup.ok &&
        pricing.servedLookup.ok &&
        pricing.requestedLookup.pricingStatus === "priced" &&
        pricing.servedLookup.pricingStatus === "priced";
}
function combinedPricingStatus(requestedLookup, servedLookup) {
    if (!requestedLookup.ok || !servedLookup.ok)
        return "pricing_unknown";
    if (requestedLookup.pricingStatus === "partial" || servedLookup.pricingStatus === "partial") {
        return "pricing_unknown";
    }
    return "priced";
}
function combinedPricingVersion(requestedLookup, servedLookup) {
    if (!requestedLookup.ok || !servedLookup.ok)
        return null;
    if (requestedLookup.pricingVersion === servedLookup.pricingVersion) {
        return requestedLookup.pricingVersion;
    }
    return `${requestedLookup.pricingVersion}+${servedLookup.pricingVersion}`;
}
function documentedAliasRollover(provider, requested, served) {
    if (provider === "openai")
        return openAiAliasRollover(requested, served);
    if (provider === "anthropic")
        return anthropicAliasRollover(requested, served);
    return geminiAliasRollover(requested, served);
}
function openAiAliasRollover(requested, served) {
    if (!OPENAI_DATED_SNAPSHOT_SUFFIX.test(requested) &&
        OPENAI_DATED_SNAPSHOT_SUFFIX.test(served) &&
        served.replace(OPENAI_DATED_SNAPSHOT_SUFFIX, "") === requested) {
        return {
            allowed: true,
            reason: "openai_versionless_alias_served_as_same_family_dated_snapshot",
        };
    }
    return { allowed: false, reason: "not_a_documented_openai_alias_rollover" };
}
function anthropicAliasRollover(requested, served) {
    if (requested.endsWith("-latest") &&
        ANTHROPIC_DATED_SNAPSHOT_SUFFIX.test(served) &&
        served.startsWith(`${requested.slice(0, -"-latest".length)}-`)) {
        return {
            allowed: true,
            reason: "anthropic_latest_alias_served_as_dated_snapshot",
        };
    }
    if (isAnthropicDatelessPinnedSnapshot(requested)) {
        return {
            allowed: false,
            reason: "anthropic_4_6_plus_dateless_id_is_treated_as_pinned_snapshot",
        };
    }
    if (!ANTHROPIC_DATED_SNAPSHOT_SUFFIX.test(requested) &&
        ANTHROPIC_DATED_SNAPSHOT_SUFFIX.test(served) &&
        served.startsWith(`${requested}-`)) {
        return {
            allowed: true,
            reason: "anthropic_pre_4_6_alias_served_as_same_family_dated_snapshot",
        };
    }
    return { allowed: false, reason: "not_a_documented_anthropic_alias_rollover" };
}
function isAnthropicDatelessPinnedSnapshot(model) {
    const match = /^claude-[a-z]+-(\d+)(?:-(\d+))?$/.exec(model);
    if (!match)
        return false;
    const major = Number.parseInt(match[1] ?? "", 10);
    const minor = match[2] ? Number.parseInt(match[2], 10) : null;
    return major >= 5 || (major === 4 && minor !== null && minor >= 6);
}
function geminiAliasRollover(requested, served) {
    const allowedServedVersions = GEMINI_ALLOWED_SERVED_VERSION_ALIASES.get(requested) ?? [];
    return allowedServedVersions.includes(served)
        ? {
            allowed: true,
            reason: "gemini_registry_backed_served_model_version",
        }
        : {
            allowed: false,
            reason: "not_a_registry_backed_gemini_served_version",
        };
}
function zeroDollarComputationTrace(input) {
    return {
        methodId: "served_model_mismatch_identity_triage_v1",
        methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
        standardVersion: SLA_DEFAULTS.standardVersion,
        whyZero: "identity mismatch only; no provider billing basis proved an overcharge delta",
        inputs: {
            requestedModel: input.requestedModel,
            servedModel: input.servedModel,
            pricingStatus: input.pricingStatus,
            billingBasisPresent: input.billingBasisPresent,
        },
        outputs: {
            standardLossUsd: 0,
            providerRecognizedLossUsd: 0,
            recognitionGapUsd: 0,
        },
        oneLine: `served model mismatch triage: requested ${input.requestedModel}, provider served ${input.servedModel}; no billing basis attached`,
    };
}
function overchargeComputationTrace(input) {
    return {
        methodId: "served_model_mismatch_overcharge_delta_v1",
        methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
        standardVersion: SLA_DEFAULTS.standardVersion,
        inputs: {
            requestedModel: input.requestedModel,
            servedModel: input.servedModel,
            provenBilledModel: input.billedModel,
            observedChargeUsd: input.observedChargeUsd,
            overchargeBasis: input.observedChargeUsd === null
                ? "proven_billed_requested_model_without_exact_observed_charge"
                : "exact_observed_charge",
            requestedModelExpectedChargeUsd: input.requestedChargeUsd,
            servedModelExpectedChargeUsd: input.servedChargeUsd,
        },
        formulas: {
            overchargeDeltaUsd: input.observedChargeUsd === null
                ? "max(0, requested-model expected charge - served-model expected charge)"
                : "max(0, observed charge - served-model expected charge)",
            providerRecognizedLossUsd: "overchargeDeltaUsd",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
        },
        outputs: {
            standardLossUsd: input.overchargeDeltaUsd,
            providerRecognizedLossUsd: input.overchargeDeltaUsd,
            recognitionGapUsd: 0,
        },
        oneLine: input.observedChargeUsd === null
            ? `requested-model price $${input.requestedChargeUsd.toFixed(6)} minus served-model price $${input.servedChargeUsd.toFixed(6)} = $${input.overchargeDeltaUsd.toFixed(6)} overcharge delta`
            : `observed charge $${input.observedChargeUsd.toFixed(6)} minus served-model price $${input.servedChargeUsd.toFixed(6)} = $${input.overchargeDeltaUsd.toFixed(6)} overcharge delta`,
    };
}
function pricingEvidence(pricing) {
    return {
        pricingStatus: pricing.pricingStatus,
        pricingVersion: pricing.pricingVersion,
        requestedModel: priceLookupEvidence(pricing.requestedLookup),
        servedModel: priceLookupEvidence(pricing.servedLookup),
    };
}
function priceLookupEvidence(lookup) {
    if (!lookup.ok) {
        return {
            priced: false,
            reason: lookup.reason,
            provider: lookup.provider,
            model: lookup.model,
            usageCategories: lookup.usageCategories,
        };
    }
    return {
        priced: true,
        pricingStatus: lookup.pricingStatus,
        pricingVersion: lookup.pricingVersion,
        source: lookup.source,
        expectedChargeUsd: lookup.expectedChargeUsd,
        components: lookup.components,
    };
}
function billingContextEvidence(context) {
    if (!context)
        return undefined;
    return compactRecord({
        provenBilledModel: context.provenBilledModel,
        observedChargeUsd: observedCharge(context),
        observedChargeSource: context.observedChargeSource,
        observedAt: context.observedAt,
        overchargeDeltaGate: "requires provenBilledModel=requestedModel plus priced requested and served models",
    });
}
function observedCharge(context) {
    const observed = context?.observedChargeUsd;
    return observed !== undefined && Number.isFinite(observed) && observed >= 0 ? observed : null;
}
function cleanModelId(value) {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}
function normalizeModelId(provider, value) {
    const normalized = value.trim().toLowerCase();
    if (provider === "gemini" && normalized.startsWith("models/")) {
        return normalized.slice("models/".length);
    }
    return normalized;
}
function schemaVersionForEvent(event) {
    const maybeVersion = event.schemaVersion;
    return typeof maybeVersion === "string" ? maybeVersion : undefined;
}
function compactRecord(input) {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined)
            output[key] = value;
    }
    return output;
}
//# sourceMappingURL=model-identity.js.map