import { canonicalEventErrorOrigin } from "./canonical-event.js";
import { classifyProviderDowntime } from "./availability.js";
import { lookupPriceForEvent, roundUsd } from "./pricing.js";
import { SLA_DEFAULTS } from "./sla-defaults.js";
export const RETRY_AMPLIFICATION_SIGNAL_CODES = [
    "RETRY_AMPLIFICATION_IN_CALL",
    "RETRY_AMPLIFICATION_CHAIN",
];
const DETECTOR_NAME = "retry-amplification";
const DETECTOR_VERSION = "v0";
const RETRY_EXTRA_ATTEMPT_METHOD_ID = "retry_extra_attempt_cost_v1";
const RETRY_EXTRA_ATTEMPT_METHOD_VERSION = "retry-extra-attempt-cost-2026-07-05";
const RETRY_HEADER_NAMES = new Set([
    "retry-after",
    "retry-after-ms",
    "x-should-retry",
]);
const RETRY_METHOD_SOURCE_REFS = {
    stainlessRetryCountHeader: "https://www.stainless.com/changelog/x-stainless-retry-count-header/",
    openAiPythonBaseClient: "https://github.com/openai/openai-python/blob/main/src/openai/_base_client.py",
    anthropicPythonBaseClient: "https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_base_client.py",
    anthropicErrors: "https://docs.claude.com/en/api/errors",
    openRouterZeroCompletionInsurance: "https://openrouter.ai/docs/guides/features/zero-completion-insurance",
};
/**
 * @contract-id loss-detectors-v1
 */
export function runRetryAmplificationDetectors(event) {
    const evidenceEvent = event;
    if (evidenceEvent.schemaVersion !== "v2")
        return [];
    if (canonicalEventErrorOrigin(evidenceEvent) === "local")
        return [];
    const sdkRetryCount = sdkRetryCountForEvent(evidenceEvent);
    const retryAttempts = retryAttemptsForEvent(evidenceEvent);
    const capturedRetryAttemptCount = retryAttempts.length;
    const inducedAttempts = Math.max(sdkRetryCount ?? 0, capturedRetryAttemptCount);
    if (inducedAttempts <= 0)
        return [];
    const providerDirected = providerDirectedRetryEvidenceForEvent(evidenceEvent);
    const listPrice = listPriceEvidenceForEvent(evidenceEvent);
    const signal = baseRetrySignal(evidenceEvent, {
        code: "RETRY_AMPLIFICATION_IN_CALL",
        liabilityParty: providerDirected.providerDirected ? "provider" : "unknown",
        pricingStatus: listPrice.pricingStatus,
        pricingVersion: listPrice.pricingVersion,
        valueJson: {
            linkageTier: "in_call_retry_evidence",
            capturedAttemptCount: evidenceEvent.attempts.length,
            sdkRetryCount: sdkRetryCount ?? null,
            capturedRetryAttemptCount,
            inducedAttempts,
            providerDirected: providerDirected.providerDirected,
            providerDirectedReasons: providerDirected.reasons,
            callListPriceUsd: listPrice.usd,
            listPriceInducedSpendUsd: null,
            refundableChainIdentity: "missing_provider_billing_evidence",
        },
        evidence: {
            reason: "in_call_retry_evidence",
            provider: evidenceEvent.request.provider,
            requestId: evidenceEvent.request.requestId,
            operationId: evidenceEvent.request.operationId ?? null,
            bodyHash: evidenceEvent.request.bodyHash ?? null,
            bodyHashAlgorithm: evidenceEvent.request.bodyHashAlgorithm ?? null,
            bodyHashCanonicalization: evidenceEvent.request.bodyHashCanonicalization ?? null,
            requestRetryHeaders: retryHeadersFromRecord(evidenceEvent.request.sanitizedHeaders),
            responseRetryHeaders: retryHeadersFromRecord(evidenceEvent.response.sanitizedHeaders),
            attemptRetryHeaders: retryAttempts.map((attempt) => ({
                attemptNumber: attempt.attemptNumber,
                headers: retryHeadersFromRecord(attempt.sanitizedHeaders),
            })).filter((entry) => Object.keys(entry.headers).length > 0),
            retryAttempts: retryAttempts.map(compactAttemptEvidence),
            sdkRetryCount: sdkRetryCount ?? null,
            inducedAttempts,
            providerDirectedReasons: providerDirected.reasons,
            retryStatusCodes: providerDirected.retryStatusCodes,
            retryClassification: providerDirected.providerDirected
                ? "provider_directed_retry"
                : "sdk_or_app_retry_unattributed",
            liabilityAttribution: providerDirected.providerDirected
                ? "provider_directed_retry_evidence"
                : "unknown_sdk_or_customer_retry",
            recoverability: "triage_only_retry_count_or_body_hash_chain_required",
            dollarClaim: "none",
        },
        standardLoss: null,
    });
    return [signal];
}
export function buildRetryAmplificationChainSignal(event, context) {
    const evidenceEvent = event;
    const operationId = evidenceEvent.request.operationId ?? null;
    const bodyHash = evidenceEvent.request.bodyHash ?? null;
    const methodGrade = context.methodGrade ?? (context.linkageTier === "stainless_retry_count" ? "A" : "B");
    const standardLoss = retryStandardLossForContext(evidenceEvent, context);
    const providerFaultAttributed = context.providerFaultStatus !== undefined &&
        context.providerFaultReason !== undefined;
    return baseRetrySignal(evidenceEvent, {
        code: "RETRY_AMPLIFICATION_CHAIN",
        liabilityParty: providerFaultAttributed || (!standardLoss && context.providerDirected) ? "provider" : "unknown",
        pricingStatus: context.listPricePricingStatus,
        pricingVersion: context.pricingVersion ?? null,
        valueJson: {
            linkageTier: context.linkageTier,
            methodGrade,
            chainSize: context.chainSize,
            inducedEventCount: context.inducedEventCount,
            inducedRank: context.inducedRank,
            originalRequestId: context.originalRequestId,
            chainStartAt: context.chainStartAt,
            chainEndAt: context.chainEndAt,
            operationId,
            bodyHash,
            apiKeyHash: context.apiKeyHash ?? evidenceEvent.request.apiKeyHash ?? null,
            retryCountSequence: context.retryCountSequence ?? null,
            extraAttemptEventCount: context.extraAttemptEventCount ?? null,
            extraAttemptSpendUsd: context.extraAttemptSpendUsd ?? null,
            providerFaultExtraAttemptSpendUsd: context.providerFaultExtraAttemptSpendUsd ?? null,
            providerFaultStatus: context.providerFaultStatus ?? null,
            providerFaultReason: context.providerFaultReason ?? null,
            finalRequestId: context.finalRequestId ?? null,
            listPriceInducedSpendUsd: context.listPriceInducedSpendUsd,
            providerDirected: context.providerDirected,
            providerDirectedReasons: context.providerDirectedReasons,
            ...(standardLoss
                ? {
                    standardLossStatus: standardLoss.status,
                    standardLossMethod: standardLoss.method,
                    standardLossGrade: standardLoss.grade,
                    standardLossUsd: standardLoss.standardLossUsd,
                    providerRecognizedLossUsd: 0,
                    recognitionGapUsd: standardLoss.recognitionGapUsd,
                }
                : {}),
            refundableChainIdentity: context.linkageTier === "stainless_retry_count"
                ? "sdk_retry_count_grouping_provider_billing_not_recognized"
                : "body_hash_fallback_not_refundable_identity",
        },
        evidence: {
            reason: "retry_amplification_chain_linked",
            provider: evidenceEvent.request.provider,
            requestId: evidenceEvent.request.requestId,
            operationId,
            bodyHash,
            apiKeyHash: context.apiKeyHash ?? evidenceEvent.request.apiKeyHash ?? null,
            bodyHashAlgorithm: evidenceEvent.request.bodyHashAlgorithm ?? null,
            bodyHashCanonicalization: evidenceEvent.request.bodyHashCanonicalization ?? null,
            detectionBasis: context.linkageTier,
            methodGrade,
            chainSize: context.chainSize,
            inducedEventCount: context.inducedEventCount,
            inducedRank: context.inducedRank,
            originalEventId: context.originalEventId,
            originalEventTime: context.originalEventTime,
            originalRequestId: context.originalRequestId,
            inducedEventId: context.inducedEventId,
            inducedEventTime: context.inducedEventTime,
            chainStartAt: context.chainStartAt,
            chainEndAt: context.chainEndAt,
            chainEventIds: context.chainEventIds,
            chainRequestIds: context.chainRequestIds,
            retryCountSequence: context.retryCountSequence ?? null,
            extraAttemptEventCount: context.extraAttemptEventCount ?? null,
            extraAttemptSpendUsd: context.extraAttemptSpendUsd ?? null,
            providerFaultExtraAttemptSpendUsd: context.providerFaultExtraAttemptSpendUsd ?? null,
            providerFaultStatus: context.providerFaultStatus ?? null,
            providerFaultReason: context.providerFaultReason ?? null,
            finalEventId: context.finalEventId ?? null,
            finalEventTime: context.finalEventTime ?? null,
            finalRequestId: context.finalRequestId ?? null,
            listPriceInducedSpendUsd: context.listPriceInducedSpendUsd,
            listPricePricingStatus: context.listPricePricingStatus,
            providerDirectedReasons: context.providerDirectedReasons,
            retryClassification: standardLoss && providerFaultAttributed
                ? "provider_fault_extra_attempt"
                : standardLoss
                    ? "floor_conservative_extra_attempt_unattributed"
                    : context.providerDirected
                        ? "provider_directed_retry"
                        : "sdk_or_app_retry_unattributed",
            liabilityAttribution: standardLoss && providerFaultAttributed
                ? "provider_fault_retry_extra_attempt"
                : standardLoss
                    ? "unattributed_retry_extra_attempt_floor"
                    : context.providerDirected
                        ? "provider_directed_retry_evidence"
                        : "unknown_sdk_or_customer_retry",
            recoverability: standardLoss
                ? "inferock_standard_unrecognized_provider_recognized_zero"
                : "triage_only_provider_billing_evidence_missing",
            chainIdentityRequirement: context.linkageTier === "stainless_retry_count"
                ? "tenant_api_key_body_hash_retry_count_window"
                : "tenant_api_key_body_hash_time_window_fallback",
            dollarClaim: standardLoss
                ? "standard_loss_only_provider_recognized_zero"
                : "none",
            methodHonesty: "summed-extra-attempts is Inferock's floor-conservative construction; no external standard body has ratified an LLM retry-cost formula",
            citations: RETRY_METHOD_SOURCE_REFS,
        },
        standardLoss,
    });
}
export function listPriceEvidenceForEvent(event) {
    const lookup = lookupPriceForEvent(event);
    if (!lookup.ok) {
        return {
            usd: null,
            pricingStatus: "pricing_unknown",
            pricingVersion: null,
        };
    }
    return {
        usd: lookup.expectedChargeUsd,
        pricingStatus: lookup.pricingStatus,
        pricingVersion: lookup.pricingVersion,
    };
}
export function sumListPriceEvidence(events) {
    if (events.length === 0) {
        return {
            usd: 0,
            pricingStatus: "priced",
            pricingVersion: null,
        };
    }
    let totalUsd = 0;
    let sawUnknown = false;
    let sawPartial = false;
    const pricingVersions = new Set();
    for (const event of events) {
        const evidence = listPriceEvidenceForEvent(event);
        if (evidence.usd === null) {
            sawUnknown = true;
        }
        else {
            totalUsd += evidence.usd;
        }
        if (evidence.pricingStatus === "partial")
            sawPartial = true;
        if (evidence.pricingVersion)
            pricingVersions.add(evidence.pricingVersion);
    }
    return {
        usd: sawUnknown ? null : roundUsd(totalUsd),
        pricingStatus: sawUnknown ? "pricing_unknown" : sawPartial ? "partial" : "priced",
        pricingVersion: pricingVersions.size === 1 ? [...pricingVersions][0] ?? null : null,
    };
}
export function providerDirectedRetryEvidenceForEvent(event) {
    const evidenceEvent = event;
    const headers = {
        ...retryHeadersFromRecord(evidenceEvent.response?.sanitizedHeaders),
        ...retryHeadersFromRecord(evidenceEvent.request?.sanitizedHeaders),
    };
    const reasons = new Set();
    const statusCodes = new Set();
    for (const [name, value] of Object.entries(headers)) {
        if (name === "retry-after" || name === "retry-after-ms") {
            reasons.add(name);
        }
        if (name === "x-should-retry" && truthyHeaderValue(value)) {
            reasons.add("x-should-retry");
        }
    }
    if (evidenceEvent.response?.statusCode >= 500) {
        reasons.add(`response_status_${evidenceEvent.response.statusCode}`);
        statusCodes.add(evidenceEvent.response.statusCode);
    }
    for (const attempt of evidenceEvent.attempts ?? []) {
        const attemptHeaders = retryHeadersFromRecord(attempt.sanitizedHeaders);
        for (const [name, value] of Object.entries(attemptHeaders)) {
            headers[`attempt.${attempt.attemptNumber}.${name}`] = value;
            if (name === "retry-after" || name === "retry-after-ms") {
                reasons.add(`attempt_${attempt.attemptNumber}_${name}`);
            }
            if (name === "x-should-retry" && truthyHeaderValue(value)) {
                reasons.add(`attempt_${attempt.attemptNumber}_x-should-retry`);
            }
        }
        if (attempt.statusCode !== undefined && attempt.statusCode >= 500) {
            reasons.add(`attempt_${attempt.attemptNumber}_status_${attempt.statusCode}`);
            statusCodes.add(attempt.statusCode);
        }
    }
    return {
        providerDirected: reasons.size > 0,
        reasons: [...reasons].sort(),
        retryHeaders: headers,
        retryStatusCodes: [...statusCodes].sort((left, right) => left - right),
    };
}
export function retryCountForEvent(event) {
    return sdkRetryCountForEvent(event);
}
export function providerFaultStatusForRetryDollarization(event) {
    const statusCode = event.response.statusCode;
    const classification = classifyProviderDowntime(event);
    if (classification?.ownership === "provider") {
        return {
            providerFault: true,
            status: statusCode ?? "timeout",
            reason: classification.reason,
        };
    }
    return null;
}
function baseRetrySignal(event, input) {
    const standardLoss = input.standardLoss;
    return {
        code: input.code,
        detectorName: DETECTOR_NAME,
        detectorVersion: DETECTOR_VERSION,
        tenantId: event.request.tenantId,
        requestId: event.request.requestId,
        provider: event.request.provider,
        model: event.request.model,
        failureClass: standardLoss ? "retry_amplification" : null,
        status: standardLoss ? "candidate" : "triage_only",
        evidenceGrade: standardLoss ? standardLoss.grade : "triage_only",
        dispute: false,
        liabilityParty: input.liabilityParty,
        creditCandidate: false,
        observedChargeUsd: null,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: 0,
        pricingVersion: input.pricingVersion,
        pricingStatus: input.pricingStatus,
        recoverableBasis: null,
        valueKind: standardLoss ? "money" : "triage",
        standardLossUsd: standardLoss?.standardLossUsd ?? null,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: standardLoss?.recognitionGapUsd ?? null,
        standardLossStatus: standardLoss?.status ?? "not_applicable",
        standardLossMethod: standardLoss?.method ?? null,
        standardLossGrade: standardLoss?.grade ?? null,
        computationTrace: standardLoss?.computationTrace ?? null,
        valueJson: input.valueJson,
        evidence: input.evidence,
    };
}
function sdkRetryCountForEvent(event) {
    const rawValue = event.request.sanitizedHeaders?.["x-stainless-retry-count"];
    if (rawValue === undefined)
        return null;
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function retryAttemptsForEvent(event) {
    return event.attempts.filter((attempt) => attempt.status === "retry" ||
        attempt.retryReason !== undefined ||
        attempt.finalSelected === false);
}
function compactAttemptEvidence(attempt) {
    return {
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        finalSelected: attempt.finalSelected,
        latencyMs: attempt.timing.latencyMs,
        ...(attempt.statusCode !== undefined ? { statusCode: attempt.statusCode } : {}),
        ...(attempt.retryReason ? { retryReason: attempt.retryReason } : {}),
        ...(attempt.providerRequestId ? { providerRequestId: attempt.providerRequestId } : {}),
        ...(attempt.errorClass ? { errorClass: attempt.errorClass } : {}),
    };
}
function retryHeadersFromRecord(record) {
    if (!record)
        return {};
    const headers = {};
    for (const [name, value] of Object.entries(record)) {
        const normalized = name.toLowerCase();
        if (RETRY_HEADER_NAMES.has(normalized) || normalized === "x-stainless-retry-count") {
            headers[normalized] = value;
        }
    }
    return headers;
}
function truthyHeaderValue(value) {
    return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}
function retryStandardLossForContext(event, context) {
    if (context.providerFaultStatus === undefined || context.providerFaultReason === undefined)
        return null;
    if (context.extraAttemptSpendUsd === undefined)
        return null;
    if (context.extraAttemptSpendUsd === null)
        return null;
    if (context.extraAttemptSpendUsd <= 0)
        return null;
    if (context.listPricePricingStatus !== "priced")
        return null;
    const standardLossUsd = roundUsd(context.extraAttemptSpendUsd);
    return {
        status: "computed",
        method: "call_cost_floor_v1",
        grade: "unrecognized_standard_loss",
        standardLossUsd,
        recognitionGapUsd: standardLossUsd,
        computationTrace: retryExtraAttemptComputationTrace(event, context, standardLossUsd),
    };
}
function retryExtraAttemptComputationTrace(event, context, standardLossUsd) {
    const methodGrade = context.methodGrade ?? (context.linkageTier === "stainless_retry_count" ? "A" : "B");
    const providerFaultAttributed = context.providerFaultStatus !== undefined &&
        context.providerFaultReason !== undefined;
    return {
        method: RETRY_EXTRA_ATTEMPT_METHOD_ID,
        methodId: RETRY_EXTRA_ATTEMPT_METHOD_ID,
        methodVersion: RETRY_EXTRA_ATTEMPT_METHOD_VERSION,
        standardVersion: SLA_DEFAULTS.standardVersion,
        basis: providerFaultAttributed
            ? "retry_extra_attempt_provider_fault"
            : "retry_extra_attempt_floor_unattributed",
        basisDetail: providerFaultAttributed
            ? "non_final_provider_fault_attempt_cost"
            : "non_final_failed_extra_attempt_cost_without_provider_fault_attribution",
        grade: methodGrade,
        confidence: "floor_conservative_inferock_construction",
        inputs: {
            requestId: event.request.requestId,
            provider: event.request.provider,
            model: event.request.model,
            apiKeyHash: context.apiKeyHash ?? event.request.apiKeyHash ?? null,
            bodyHash: event.request.bodyHash ?? null,
            linkageTier: context.linkageTier,
            retryCountSequence: context.retryCountSequence ?? null,
            providerFaultStatus: context.providerFaultStatus ?? null,
            providerFaultReason: context.providerFaultReason ?? null,
            finalRequestId: context.finalRequestId ?? null,
            extraAttemptEventCount: context.extraAttemptEventCount ?? null,
            extraAttemptSpendUsd: standardLossUsd,
            providerRecognizedLossUsd: 0,
        },
        formulas: {
            standardLossUsd: "sum(provider-billed list-price cost for non-final failed extra retry attempts; provider-fault fields mark the liability-attributed subset when present)",
            providerRecognizedLossUsd: "0; no provider currently recognizes retry amplification cost",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
            ledgerConsistency: "this retry row uses the whole-call floor path so any co-firing whole-call failure signal supersedes duplicate counting",
        },
        outputs: {
            standardLossUsd,
            providerRecognizedLossUsd: 0,
            recognitionGapUsd: standardLossUsd,
        },
        sourceRefs: {
            ...RETRY_METHOD_SOURCE_REFS,
            methodLimitation: "summed-extra-attempts is Inferock's floor-conservative construction; no external standard body has ratified an LLM retry-cost formula",
        },
        oneLine: `retry extra-attempt standard loss $${standardLossUsd.toFixed(2)}; estimated recoverable $0.00 -> $${standardLossUsd.toFixed(2)} recognition gap`,
    };
}
//# sourceMappingURL=retry-amplification.js.map