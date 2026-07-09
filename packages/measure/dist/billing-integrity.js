import { getEncoding, getEncodingNameForModel, } from "js-tiktoken";
import { lookupPriceForEvent, roundUsd, } from "./pricing.js";
import { buildPricingStatusSignal } from "./pricing-signal.js";
import { billedEmptyEvidence, buildLossSignal, eventKey, isBilledButEmpty, refundableCandidateEconomics, } from "./signal.js";
import { isCanonicalHiddenOutputCategory, isProviderHiddenOutputCategory, } from "./usage-categories.js";
const O200K_MODELS = [/^gpt-4o\b/, /^gpt-5\b/, /^o\d\b/];
const TOKEN_RECOUNT_TOLERANCE = 0.03;
const CACHE_CHARGE_TOLERANCE = 0.03;
export const GEMINI_COUNT_TOKENS_RECOUNT_METHOD_ID = "gemini_count_tokens_input_recount_v1";
export const GEMINI_COUNT_TOKENS_ORACLE = "gemini.models.countTokens";
export const GEMINI_COUNT_TOKENS_BILLING_STATUS = "UNVERIFIED";
// OpenAI's token-counting cookbook documents a constant 3-token assistant reply
// primer. 2026-07-02 live gpt-5.4-mini-2026-03-17 probes matched
// o200k_base(visible content) + 3 for visible lengths 1-260, with hidden,
// reasoning, audio, prediction, and refusal token categories all zero.
const OPENAI_REPLY_PRIMER_FRAMING_TOKENS = 3;
const seenRequestIds = new Set();
const observedChargeUsd = new Map();
const encoders = new Map();
function observedChargeKey(input) {
    return `${input.tenantId}:${input.provider}:${input.requestId}`;
}
function definedRecord(input) {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined)
            output[key] = value;
    }
    return output;
}
export function resetBillingIntegrityState() {
    seenRequestIds.clear();
    observedChargeUsd.clear();
}
/**
 * @deprecated Process-local observed charge state is for legacy unit tests only.
 * Production cache reconciliation must use durable billing_charge_observations.
 */
export function registerObservedCharge(input) {
    observedChargeUsd.set(observedChargeKey(input), input.chargedUsd);
}
export function observedChargeUsdForEvent(event) {
    return observedChargeUsd.get(eventKey(event)) ?? null;
}
export function buildGeminiCountTokensRecountEvidence(event, recount) {
    if (event.request.provider !== "gemini") {
        throw new Error("Gemini countTokens recount received a non-Gemini event");
    }
    // Constraint: models.countTokens billing status is UNVERIFIED, so this helper only records fixture or organic-request recount evidence and never creates provider-recoverable dollars.
    const usageMetadata = event.usage.raw;
    const usagePromptTokenCount = nonNegativeNumber(usageMetadata?.promptTokenCount);
    if (usagePromptTokenCount === null)
        return null;
    const cachedContentTokenCount = nonNegativeNumber(usageMetadata?.cachedContentTokenCount) ?? 0;
    const toolUsePromptTokenCount = nonNegativeNumber(usageMetadata?.toolUsePromptTokenCount) ?? 0;
    return {
        provider: "gemini",
        mode: "count_tokens_input_recount",
        methodId: GEMINI_COUNT_TOKENS_RECOUNT_METHOD_ID,
        oracle: recount.source ?? GEMINI_COUNT_TOKENS_ORACLE,
        evidenceGrade: "B",
        billingStatus: GEMINI_COUNT_TOKENS_BILLING_STATUS,
        countedInputTokens: recount.totalTokens,
        usagePromptTokenCount,
        cachedContentTokenCount,
        toolUsePromptTokenCount,
        promptDeltaTokens: usagePromptTokenCount - recount.totalTokens,
        comparedFields: [
            "usage.raw.promptTokenCount",
            "usage.raw.cachedContentTokenCount",
            "usage.raw.toolUsePromptTokenCount",
        ],
        note: "Gemini countTokens can recount input request tokens only; generated candidates and thinking tokens remain provider usage fields.",
    };
}
function getCachedEncoding(encodingName) {
    const cached = encoders.get(encodingName);
    if (cached)
        return cached;
    const encoding = getEncoding(encodingName);
    encoders.set(encodingName, encoding);
    return encoding;
}
function nonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function inferredOpenAiEncodingName(model) {
    return O200K_MODELS.some((pattern) => pattern.test(model))
        ? "o200k_base"
        : "cl100k_base";
}
function openAiEncodingMetadata(model) {
    try {
        return {
            encodingName: getEncodingNameForModel(model),
            encodingVerified: true,
        };
    }
    catch {
        return {
            encodingName: inferredOpenAiEncodingName(model),
            encodingVerified: false,
        };
    }
}
export function countOpenAiOutputTokens(model, content) {
    if (content.length === 0)
        return 0;
    return getCachedEncoding(openAiEncodingMetadata(model).encodingName).encode(content).length;
}
function exceedsOvercountTolerance(observed, expected, tolerance) {
    if (observed <= expected)
        return false;
    return (observed - expected) / Math.max(1, expected) > tolerance;
}
function servedOpenAiModel(event) {
    return event.response.servedModel ?? event.request.model;
}
function hasProviderToolCalls(event) {
    const response = event.response;
    return (response.toolCalls?.length ?? 0) > 0 || (response.rawToolCalls?.length ?? 0) > 0;
}
function requestedChoiceCount(event) {
    const generation = event.request.generation;
    const value = generation?.n;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function hasNativeRefusal(event) {
    const providerSafety = event.response.providerSafety ?? [];
    return providerSafety.some((entry) => entry.kind === "refusal");
}
function hiddenOutputTokens(event) {
    const categories = event.usage.categories ?? [];
    const canonical = sumCategoryTokensOnce(categories, isCanonicalHiddenOutputCategory);
    if (canonical > 0)
        return canonical;
    return sumCategoryTokensOnce(categories, isProviderHiddenOutputCategory);
}
function sumCategoryTokensOnce(categories, include) {
    const seen = new Set();
    let total = 0;
    for (const category of categories) {
        if (!include(category.category))
            continue;
        const key = category.sourceField ?? category.category;
        if (seen.has(key))
            continue;
        seen.add(key);
        total += category.tokens;
    }
    return total;
}
function pricedOutputRate(priceLookup) {
    if (!priceLookup.ok || priceLookup.pricingStatus !== "priced")
        return null;
    const output = priceLookup.components.find((component) => component.category === "output" && component.rateUsdPerMillion !== null);
    if (!output?.rateUsdPerMillion)
        return null;
    return {
        rateUsdPerMillion: output.rateUsdPerMillion,
        pricingVersion: priceLookup.pricingVersion,
    };
}
export function buildDuplicateRequestIdSignal(event, duplicateEvidence = {}) {
    const invoiceVerification = "verify_against_invoice";
    return buildLossSignal({
        code: "DUPLICATE_REQUEST_ID",
        detector: "billing-integrity",
        event,
        domain: "usage",
        failureClass: "duplicate_request_id",
        status: "triage_only",
        evidenceGrade: "triage_only",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        valueKind: "triage",
        observedChargeUsd: null,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: null,
        valueJson: definedRecord({
            originalEventId: duplicateEvidence.originalEventId,
            originalEventTime: duplicateEvidence.originalEventTime,
            duplicateRank: duplicateEvidence.duplicateRank,
            duplicateCountAtDetection: duplicateEvidence.duplicateCount,
            invoiceVerification,
            invoiceVerificationLabel: "verify against your invoice",
        }),
        evidence: {
            requestId: event.request.requestId,
            reason: "requestId was observed more than once for tenant/provider",
            detectionBasis: "tenant_provider_request_id",
            invoiceVerification,
            invoiceVerificationLabel: "verify against your invoice",
            ...definedRecord({
                duplicateEventId: duplicateEvidence.duplicateEventId,
                duplicateEventTime: duplicateEvidence.duplicateEventTime,
            }),
        },
    });
}
export function buildCacheDiscountAtRiskSignal(event) {
    if (!hasCacheBilledUsage(event))
        return null;
    const eventCacheReadTokens = event.usage.cache?.read ?? 0;
    const cacheReadTokens = eventCacheReadTokens > 0
        ? eventCacheReadTokens
        : cacheReadTokensFromCategories(event);
    if (cacheReadTokens <= 0)
        return null;
    const priceLookup = lookupPriceForEvent(event);
    if (!priceLookup.ok || priceLookup.pricingStatus !== "priced") {
        return buildLossSignal({
            code: "CACHE_DISCOUNT_AT_RISK",
            detector: "billing-integrity",
            event,
            failureClass: "cache_discount_at_risk",
            status: "pricing_unknown",
            evidenceGrade: "triage_only",
            dispute: false,
            liabilityParty: "unknown",
            creditCandidate: false,
            valueKind: "triage",
            recoverableBasis: "overcharge_delta",
            providerRecoverableLossUsd: null,
            pricingVersion: priceLookup.ok ? priceLookup.pricingVersion : null,
            pricingStatus: priceLookup.ok ? priceLookup.pricingStatus : "pricing_unknown",
            evidence: {
                reason: "cache_discount_at_risk",
                cacheReadTokens,
                invoiceVerification: "verify_against_invoice",
                invoiceVerificationLabel: "verify against your invoice",
                methodId: "cache_discount_at_risk_v1",
            },
            valueJson: {
                cacheReadTokens,
                methodId: "cache_discount_at_risk_v1",
            },
        });
    }
    const cacheRead = priceLookup.components.find((component) => component.category === "cache_read" && component.rateUsdPerMillion !== null);
    const fullInputRateUsdPerMillion = inputRateUsdPerMillionForEvent(event, priceLookup);
    const cacheReadRateUsdPerMillion = cacheRead?.rateUsdPerMillion ?? null;
    if (fullInputRateUsdPerMillion === null ||
        cacheReadRateUsdPerMillion === null ||
        cacheReadRateUsdPerMillion >= fullInputRateUsdPerMillion) {
        return null;
    }
    const cacheDiscountAtRiskUsd = roundUsd(cacheReadTokens * (fullInputRateUsdPerMillion - cacheReadRateUsdPerMillion) / 1_000_000);
    if (cacheDiscountAtRiskUsd <= 0)
        return null;
    const methodMetadata = {
        methodId: "cache_discount_at_risk_v1",
        formula: "cache_read_tokens * (full_input_rate - cache_read_rate)",
        invoiceVerification: "verify_against_invoice",
        sourceRefs: {
            pricing: "@inferock/measure/pricing",
            usage: "canonical_event.usage.cache.read",
        },
    };
    return buildLossSignal({
        code: "CACHE_DISCOUNT_AT_RISK",
        detector: "billing-integrity",
        event,
        failureClass: "cache_discount_at_risk",
        status: "triage_only",
        evidenceGrade: "triage_only",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        valueKind: "money",
        recoverableBasis: "overcharge_delta",
        providerRecoverableLossUsd: 0,
        expectedChargeUsd: priceLookup.expectedChargeUsd,
        pricingVersion: priceLookup.pricingVersion,
        pricingStatus: "priced",
        evidence: {
            reason: "cache_discount_at_risk",
            cacheReadTokens,
            fullInputRateUsdPerMillion,
            cacheReadRateUsdPerMillion,
            cacheDiscountAtRiskUsd,
            invoiceVerification: "verify_against_invoice",
            invoiceVerificationLabel: "verify against your invoice",
            methodMetadata,
        },
        valueJson: {
            cacheReadTokens,
            fullInputRateUsdPerMillion,
            cacheReadRateUsdPerMillion,
            cacheDiscountAtRiskUsd,
            standardLossUsd: cacheDiscountAtRiskUsd,
            providerRecognizedLossUsd: 0,
            recognitionGapUsd: cacheDiscountAtRiskUsd,
            methodId: "cache_discount_at_risk_v1",
            methodMetadata,
        },
    });
}
function inputRateUsdPerMillionForEvent(event, priceLookup) {
    const input = priceLookup.components.find((component) => component.category === "input" && component.rateUsdPerMillion !== null);
    if (input?.rateUsdPerMillion !== undefined && input.rateUsdPerMillion !== null) {
        return input.rateUsdPerMillion;
    }
    const probe = lookupPriceForEvent({
        ...event,
        usage: {
            ...event.usage,
            input: Math.max(1, event.usage.input),
        },
    });
    if (!probe.ok || probe.pricingStatus !== "priced")
        return null;
    return probe.components.find((component) => component.category === "input" && component.rateUsdPerMillion !== null)?.rateUsdPerMillion ?? null;
}
export function buildCacheRateAnomalySignal(event, observedCharge) {
    if (!hasCacheBilledUsage(event))
        return null;
    const chargedUsd = typeof observedCharge === "number"
        ? observedCharge
        : observedCharge.chargedUsd;
    const priceLookup = lookupPriceForEvent(event);
    if (!priceLookup.ok || priceLookup.pricingStatus === "partial") {
        return buildPricingStatusSignal(event, priceLookup, observedChargeContext(chargedUsd, observedCharge));
    }
    const expectedUsd = priceLookup.expectedChargeUsd;
    if (chargedUsd <= expectedUsd * (1 + CACHE_CHARGE_TOLERANCE))
        return null;
    const dashboardEligible = typeof observedCharge !== "number" &&
        observedCharge.dashboardEligible === true;
    const recoverableLossUsd = roundUsd(chargedUsd - expectedUsd);
    return buildLossSignal({
        code: "CACHE_RATE_ANOMALY",
        detector: "billing-integrity",
        event,
        failureClass: "cache_rate_anomaly",
        status: dashboardEligible ? "candidate" : "triage_only",
        evidenceGrade: dashboardEligible ? "refundable_candidate" : "triage_only",
        creditCandidate: dashboardEligible,
        observedChargeUsd: roundUsd(chargedUsd),
        expectedChargeUsd: expectedUsd,
        providerRecoverableLossUsd: dashboardEligible ? recoverableLossUsd : null,
        pricingVersion: priceLookup.pricingVersion,
        pricingStatus: "priced",
        evidence: {
            cacheReadTokens: event.usage.cache?.read ?? 0,
            cacheCreationTokens: event.usage.cache?.creation ?? 0,
            expectedUsd,
            chargedUsd: roundUsd(chargedUsd),
            overchargeUsd: recoverableLossUsd,
            expectedCacheReadMultiplier: cacheReadMultiplier(priceLookup.components),
            pricingVersion: priceLookup.pricingVersion,
            pricingSource: priceLookup.source,
            pricingComponents: priceLookup.components,
            tolerance: CACHE_CHARGE_TOLERANCE,
            ...(typeof observedCharge === "number"
                ? {}
                : {
                    currency: observedCharge.currency ?? "USD",
                    source: observedCharge.source,
                    observedAt: observedCharge.observedAt,
                    dashboardEligible: observedCharge.dashboardEligible === true,
                }),
        },
    });
}
function observedChargeContext(chargedUsd, observedCharge) {
    if (typeof observedCharge === "number")
        return { observedChargeUsd: roundUsd(chargedUsd) };
    return {
        observedChargeUsd: roundUsd(chargedUsd),
        observedChargeSource: observedCharge.source,
        observedAt: observedCharge.observedAt,
    };
}
function cacheReadMultiplier(components) {
    const input = components.find((component) => component.category === "input");
    const cacheRead = components.find((component) => component.category === "cache_read");
    if (!input?.rateUsdPerMillion || !cacheRead?.rateUsdPerMillion)
        return null;
    return roundUsd(cacheRead.rateUsdPerMillion / input.rateUsdPerMillion);
}
function cacheReadTokensFromCategories(event) {
    const categories = event.usage.categories ?? [];
    return categories
        .filter((category) => category.tokens > 0 && (category.category === "cached" ||
        category.category === "cache_read" ||
        category.category === "provider:openai:prompt_tokens_details.cached_tokens" ||
        category.category === "provider:openai_responses:input_tokens_details.cached_tokens" ||
        category.category === "provider:anthropic:cache_read_input_tokens"))
        .reduce((total, category) => total + category.tokens, 0);
}
export function hasCacheBilledUsage(event) {
    if ((event.usage.cache?.read ?? 0) > 0)
        return true;
    if ((event.usage.cache?.creation ?? 0) > 0)
        return true;
    const categories = event.usage.categories ?? [];
    return categories.some((category) => category.tokens > 0 && (category.category.includes("cache_creation") ||
        category.category === "cached" ||
        category.category === "cache_read"));
}
/**
 * @deprecated Process-local duplicate detection is for legacy unit tests only.
 * Production duplicate reconciliation must use durable call_events state.
 */
function detectDuplicateRequestId(event) {
    const key = eventKey(event);
    if (seenRequestIds.has(key)) {
        return buildDuplicateRequestIdSignal(event);
    }
    seenRequestIds.add(key);
    return null;
}
/**
 * @deprecated Process-local observed charge state is for legacy unit tests only.
 * Production cache reconciliation must use durable billing_charge_observations.
 */
function detectCacheRateAnomaly(event) {
    const chargedUsd = observedChargeUsd.get(eventKey(event));
    if (chargedUsd === undefined)
        return null;
    return buildCacheRateAnomalySignal(event, chargedUsd);
}
export function detectOpenAiTokenRecount(event) {
    if (event.request.provider !== "openai")
        return null;
    if (event.response.content.trim().length === 0)
        return null;
    if (hasProviderToolCalls(event))
        return null;
    if ((requestedChoiceCount(event) ?? 1) > 1)
        return null;
    if (hasNativeRefusal(event))
        return null;
    const model = servedOpenAiModel(event);
    const encoding = openAiEncodingMetadata(model);
    const recountedOutputTokens = countOpenAiOutputTokens(model, event.response.content);
    const knownHiddenOutputTokens = hiddenOutputTokens(event);
    const billedVisibleOutputTokens = Math.max(0, event.usage.output - knownHiddenOutputTokens);
    const billedVsRecountDeltaTokens = billedVisibleOutputTokens - recountedOutputTokens;
    const overBilledOutputTokens = Math.max(0, billedVsRecountDeltaTokens - OPENAI_REPLY_PRIMER_FRAMING_TOKENS);
    if (!exceedsOvercountTolerance(recountedOutputTokens + overBilledOutputTokens, recountedOutputTokens, TOKEN_RECOUNT_TOLERANCE)) {
        return null;
    }
    const priceLookup = lookupPriceForEvent(event);
    const outputRate = pricedOutputRate(priceLookup);
    const overchargeUsd = outputRate
        ? roundUsd((overBilledOutputTokens * outputRate.rateUsdPerMillion) / 1_000_000)
        : null;
    const observedUsd = priceLookup.ok ? priceLookup.expectedChargeUsd : null;
    const expectedUsd = observedUsd !== null && overchargeUsd !== null
        ? roundUsd(Math.max(0, observedUsd - overchargeUsd))
        : null;
    return buildLossSignal({
        code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
        detector: "billing-integrity",
        event,
        failureClass: "token_recount_mismatch",
        status: outputRate ? "candidate" : "pricing_unknown",
        evidenceGrade: outputRate ? "refundable_candidate" : "triage_only",
        creditCandidate: outputRate !== null,
        observedChargeUsd: observedUsd,
        expectedChargeUsd: expectedUsd,
        providerRecoverableLossUsd: overchargeUsd,
        pricingVersion: outputRate?.pricingVersion ?? null,
        pricingStatus: outputRate ? "priced" : "pricing_unknown",
        evidence: {
            provider: "openai",
            billedOutputTokens: event.usage.output,
            knownHiddenOutputTokens,
            billedVisibleOutputTokens,
            recountedOutputTokens,
            recountedVisibleOutputTokens: recountedOutputTokens,
            billedVsRecountDeltaTokens,
            framingAllowanceTokens: OPENAI_REPLY_PRIMER_FRAMING_TOKENS,
            overBilledOutputTokens,
            outputRateUsdPerMillion: outputRate?.rateUsdPerMillion ?? null,
            overchargeUsd,
            tolerance: TOKEN_RECOUNT_TOLERANCE,
            tokenizer: encoding.encodingName,
            tokenizerEncoding: encoding.encodingName,
            encodingVerified: encoding.encodingVerified,
            servedModel: model,
        },
    });
}
export function detectBillingIntegrity(event) {
    const duplicate = detectDuplicateRequestId(event);
    if (isBilledButEmpty(event)) {
        return buildLossSignal({
            code: "BILLED_EMPTY",
            detector: "billing-integrity",
            event,
            failureClass: "empty_output",
            ...refundableCandidateEconomics(event),
            evidence: billedEmptyEvidence(event),
        });
    }
    if (duplicate)
        return duplicate;
    return detectCacheRateAnomaly(event) ?? detectOpenAiTokenRecount(event);
}
//# sourceMappingURL=billing-integrity.js.map