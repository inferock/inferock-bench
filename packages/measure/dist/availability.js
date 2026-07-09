import { tokensBilledForEvent } from "./pricing.js";
import { buildLossSignal } from "./signal.js";
import { TIME_LOSS_METHOD_DOWNTIME_WINDOW } from "./time-loss.js";
const PROVIDER_UNAVAILABILITY_TERMS = [
    "overloaded",
    "capacity",
    "timeout",
    "provider_unavailable",
    "provider-unavailable",
    "provider_rate_limit",
    "provider-rate_limit",
    "provider rate limit",
];
const DEFAULT_PROVIDER_FAULT_THRESHOLD_SOURCE = "inferock-default-provider-fault-rate-gemini-aligned";
const DEFAULT_PROVIDER_FAULT_THRESHOLD_LABEL = "Inferock default >5% over 5 minutes, aligned with Gemini's published downtime definition; standard-defined, not credit proof";
const PROVIDER_SLA_THRESHOLDS = {
    gcp_gemini_online_inference_api: {
        threshold: 0.05,
        thresholdSource: "provider-published-sla-threshold:gcp-gemini-online-inference-api",
        thresholdSourceLabel: "Gemini Online Inference API on Vertex/Gemini Enterprise SLA downtime threshold: >5% HTTP 5xx error rate over five or more consecutive minutes",
        sourceRefs: [
            "provider-sla-latency-compensation-2026-07-05:Gemini Online Inference API on Vertex/Gemini Enterprise SLA",
            "downtime-identification-method-2026-07-05:Window threshold",
        ],
        creditTermsVerified: true,
    },
};
function normalizedEvidence(event) {
    return [
        event.response.errorClass,
        event.response.content,
        providerEvidence(event).response.rawErrorType,
        providerEvidence(event).response.rawErrorCode,
    ]
        .filter((value) => Boolean(value))
        .join(" ")
        .toLowerCase();
}
function hasProviderCapacityEvidence(text) {
    return PROVIDER_UNAVAILABILITY_TERMS.some((term) => text.includes(term));
}
export function classifyProviderDowntime(event) {
    const statusCode = event.response.statusCode;
    if (statusCode === 401 || statusCode === 403)
        return null;
    const errorClass = event.response.errorClass ?? "";
    const evidenceText = normalizedEvidence(event);
    if (errorClass.startsWith("transport:")) {
        return {
            reason: "transport_error",
            branch: "transport",
            ownership: hasProviderReceipt(event) ? "provider" : "ambiguous",
            ...(hasProviderReceipt(event)
                ? {}
                : { triageReason: "ambiguous_transport_without_provider_receipt" }),
        };
    }
    if (isOpenAiSlowDown503(event)) {
        return {
            reason: "openai_slow_down_503",
            branch: "status_code",
            ownership: "ambiguous",
            triageReason: "customer_ramp_slow_down",
        };
    }
    if (event.request.provider === "gemini") {
        const geminiClassification = classifyGeminiProviderDowntime(event, evidenceText);
        return geminiClassification;
    }
    const ossClassification = classifyOssProviderDowntime(event, evidenceText);
    if (ossClassification !== undefined)
        return ossClassification;
    if (statusCode >= 500) {
        if (hasProviderReceipt(event) || hasProviderRawErrorEvidence(event)) {
            return {
                reason: providerStatusReason(event),
                branch: "status_code",
                ownership: "provider",
            };
        }
        return {
            reason: `ambiguous_status_${statusCode}_without_provider_receipt`,
            branch: "status_code",
            ownership: "ambiguous",
            triageReason: "ambiguous_5xx_without_provider_receipt",
            failureClass: null,
        };
    }
    if (statusCode === 408) {
        return {
            reason: "provider_timeout_status",
            branch: "status_code",
            ownership: hasProviderReceipt(event) ? "provider" : "ambiguous",
            ...(hasProviderReceipt(event)
                ? {}
                : { triageReason: "ambiguous_timeout_ownership" }),
        };
    }
    if (statusCode === 429) {
        if (hasProviderOwnedCapacityCode(event)) {
            return {
                reason: "provider_rate_limit_capacity",
                branch: "rate_limit_evidence",
                ownership: "provider",
            };
        }
        return hasProviderCapacityEvidence(evidenceText)
            ? {
                reason: "provider_rate_limit_capacity_text",
                branch: "rate_limit_evidence",
                ownership: "ambiguous",
                triageReason: "ambiguous_rate_limit_ownership",
            }
            : null;
    }
    if (hasProviderErrorSurface(event) && hasProviderCapacityEvidence(evidenceText)) {
        return {
            reason: "provider_unavailability_evidence",
            branch: "error_class_or_content",
            ownership: hasProviderOwnedCapacityCode(event) ? "provider" : "ambiguous",
            ...(hasProviderOwnedCapacityCode(event)
                ? {}
                : { triageReason: "ambiguous_unavailability_evidence" }),
        };
    }
    return null;
}
function classifyOssProviderDowntime(event, evidenceText) {
    switch (event.request.provider) {
        case "deepseek_platform":
            return classifyDeepSeekProviderDowntime(event);
        case "moonshot_kimi":
            return classifyKimiProviderDowntime(event, evidenceText);
        case "zai":
            return classifyZaiProviderDowntime(event);
        case "deepinfra":
            return classifyDeepInfraProviderDowntime(event, evidenceText);
        case "mistral":
        case "alibaba_dashscope_us_virginia":
        case "together":
        case "groq":
            return classifyConservativeOpenAiCompatibleDowntime(event, evidenceText);
        case "openrouter":
            return classifyOpenRouterProviderDowntime(event, evidenceText);
        case "openai":
        case "anthropic":
        case "gemini":
            return undefined;
        default:
            return undefined;
    }
}
function classifyDeepSeekProviderDowntime(event) {
    if (event.response.statusCode === 500 || event.response.statusCode === 503) {
        return {
            reason: `deepseek_provider_fault_status_${event.response.statusCode}`,
            branch: "published_status_code",
            ownership: "provider",
        };
    }
    if (event.response.statusCode === 429)
        return null;
    return null;
}
function classifyKimiProviderDowntime(event, evidenceText) {
    if (evidenceText.includes("engine_overloaded_error")) {
        return {
            reason: "kimi_engine_overloaded_error",
            branch: "published_error_type",
            ownership: "provider",
        };
    }
    if (event.response.statusCode === 429 && kimiTenantRateLimitEvidence(evidenceText))
        return null;
    if (event.response.statusCode >= 500 && hasProviderReceipt(event)) {
        return {
            reason: `kimi_provider_receipted_status_${event.response.statusCode}`,
            branch: "status_code",
            ownership: "provider",
        };
    }
    return null;
}
function classifyZaiProviderDowntime(event) {
    const code = providerEvidence(event).response.rawErrorCode;
    if (code === "1305") {
        return {
            reason: "zai_business_code_1305_overload",
            branch: "published_business_code",
            ownership: "provider",
        };
    }
    if (code === "1302" || /^13(?:0[8-9]|1[0-9]|2[0-1])$/.test(code ?? ""))
        return null;
    if ((code === "1200" || code === "1230" || code === "1234") && hasProviderReceipt(event)) {
        return {
            reason: `zai_business_code_${code}_provider_receipt`,
            branch: "published_business_code",
            ownership: "provider",
        };
    }
    return null;
}
function classifyDeepInfraProviderDowntime(event, evidenceText) {
    if (event.response.statusCode === 429) {
        if (deepInfraModelBusyEvidence(evidenceText)) {
            return {
                reason: "deepinfra_model_busy_429",
                branch: "published_rate_limit_split",
                ownership: "provider",
            };
        }
        return null;
    }
    if (event.response.statusCode >= 500 && hasProviderReceipt(event)) {
        return {
            reason: `deepinfra_provider_receipted_status_${event.response.statusCode}`,
            branch: "status_code",
            ownership: "provider",
        };
    }
    return null;
}
function classifyConservativeOpenAiCompatibleDowntime(event, evidenceText) {
    if (event.response.statusCode === 429)
        return null;
    if (event.response.statusCode >= 500) {
        return hasProviderReceipt(event)
            ? {
                reason: `${event.request.provider}_provider_receipted_status_${event.response.statusCode}`,
                branch: "conservative_status_code",
                ownership: "provider",
            }
            : {
                reason: `${event.request.provider}_ambiguous_status_${event.response.statusCode}`,
                branch: "conservative_status_code",
                ownership: "ambiguous",
                triageReason: "ambiguous_5xx_without_provider_receipt",
            };
    }
    if (hasProviderErrorSurface(event) && hasProviderCapacityEvidence(evidenceText)) {
        return {
            reason: `${event.request.provider}_ambiguous_capacity_evidence`,
            branch: "error_class_or_content",
            ownership: "ambiguous",
            triageReason: "fixture_needed_for_provider_fault_mapping",
        };
    }
    return null;
}
function classifyOpenRouterProviderDowntime(event, evidenceText) {
    const statusCode = event.response.statusCode;
    const errorType = providerEvidence(event).response.rawErrorType;
    const hasSelectedEndpointEvidence = openRouterHasSelectedEndpointEvidence(event);
    if (statusCode === 400 ||
        statusCode === 401 ||
        statusCode === 402 ||
        statusCode === 403 ||
        isOpenRouterRequestFault(errorType)) {
        return null;
    }
    if (statusCode === 429 || errorType === "rate_limit_exceeded") {
        return null;
    }
    if (statusCode === 502 || errorType === "provider_unavailable") {
        return hasSelectedEndpointEvidence
            ? {
                reason: "openrouter_provider_unavailable",
                branch: "published_error_type",
                ownership: "provider",
            }
            : {
                reason: "openrouter_provider_unavailable_ambiguous",
                branch: "published_error_type",
                ownership: "ambiguous",
                triageReason: "ambiguous_upstream_without_openrouter_metadata",
            };
    }
    if (statusCode === 503 || statusCode === 529 || errorType === "provider_overloaded") {
        return hasSelectedEndpointEvidence && (errorType === "provider_overloaded" || statusCode === 529)
            ? {
                reason: "openrouter_provider_overloaded",
                branch: "published_error_type",
                ownership: "provider",
            }
            : {
                reason: `openrouter_ambiguous_status_${statusCode}`,
                branch: "published_error_type",
                ownership: "ambiguous",
                triageReason: "ambiguous_or_routing_exhaustion_without_provider_attempt",
            };
    }
    if (statusCode === 408 || statusCode === 504 || errorType === "timeout") {
        return hasSelectedEndpointEvidence
            ? {
                reason: "openrouter_provider_timeout",
                branch: "published_error_type",
                ownership: "provider",
            }
            : {
                reason: "openrouter_timeout_ambiguous",
                branch: "published_error_type",
                ownership: "ambiguous",
                triageReason: "ambiguous_timeout_without_upstream_metadata",
            };
    }
    if (statusCode === 500 && (errorType === "server" || errorType === "unmapped")) {
        return {
            reason: "openrouter_router_service_fault",
            branch: "published_error_type",
            ownership: "provider",
        };
    }
    if (hasProviderErrorSurface(event) && hasProviderCapacityEvidence(evidenceText)) {
        return {
            reason: "openrouter_ambiguous_capacity_evidence",
            branch: "error_class_or_content",
            ownership: "ambiguous",
            triageReason: "ambiguous_openrouter_upstream_ownership",
        };
    }
    return null;
}
function isOpenRouterRequestFault(errorType) {
    return errorType === "invalid_request" ||
        errorType === "invalid_prompt" ||
        errorType === "context_length_exceeded" ||
        errorType === "max_tokens_exceeded" ||
        errorType === "token_limit_exceeded" ||
        errorType === "string_too_long" ||
        errorType === "authentication" ||
        errorType === "permission_denied" ||
        errorType === "payment_required" ||
        errorType === "not_found" ||
        errorType === "precondition_failed" ||
        errorType === "payload_too_large" ||
        errorType === "unprocessable" ||
        errorType === "content_policy_violation" ||
        errorType === "refusal";
}
function kimiTenantRateLimitEvidence(evidenceText) {
    return evidenceText.includes("quota") ||
        evidenceText.includes("rpm") ||
        evidenceText.includes("tpm") ||
        evidenceText.includes("tpd");
}
function deepInfraModelBusyEvidence(evidenceText) {
    return evidenceText.includes("model") &&
        (evidenceText.includes("busy") || evidenceText.includes("loading") || evidenceText.includes("capacity"));
}
function classifyGeminiProviderDowntime(event, evidenceText) {
    const statusCode = event.response.statusCode;
    if (statusCode === 500 || statusCode === 503) {
        return {
            reason: `gemini_provider_fault_status_${statusCode}`,
            branch: "status_code",
            ownership: "provider",
        };
    }
    if (statusCode === 429) {
        return geminiHasProviderCapacityEvidence(event, evidenceText)
            ? {
                reason: "gemini_provider_capacity_429",
                branch: "rate_limit_evidence",
                ownership: "provider",
            }
            : null;
    }
    if (statusCode === 504) {
        return geminiHasProviderCapacityEvidence(event, evidenceText) && !geminiHasCustomerTimeoutEvidence(evidenceText)
            ? {
                reason: "gemini_provider_timeout_504",
                branch: "status_code",
                ownership: "provider",
            }
            : {
                reason: "gemini_ambiguous_deadline_exceeded_504",
                branch: "status_code",
                ownership: "ambiguous",
                triageReason: "ambiguous_timeout_ownership",
            };
    }
    if (statusCode >= 500) {
        return geminiHasProviderCapacityEvidence(event, evidenceText) || hasProviderReceipt(event)
            ? {
                reason: `gemini_provider_evidenced_status_${statusCode}`,
                branch: "status_code",
                ownership: "provider",
            }
            : {
                reason: `gemini_ambiguous_status_${statusCode}`,
                branch: "status_code",
                ownership: "ambiguous",
                triageReason: "ambiguous_5xx_without_provider_evidence",
            };
    }
    return null;
}
function isOpenAiSlowDown503(event) {
    if (event.request.provider !== "openai" || event.response.statusCode !== 503)
        return false;
    const evidenceText = normalizedEvidence(event).replace(/[_-]+/g, " ");
    return evidenceText.includes("slow down");
}
export function isProviderDowntimeEvent(event) {
    return classifyProviderDowntime(event) !== null;
}
export function detectProviderDowntime(event) {
    const classification = classifyProviderDowntime(event);
    if (!classification)
        return null;
    const tokensBilled = tokensBilledForEvent(event);
    const providerOwned = classification.ownership === "provider";
    const providerOwnedBilled = providerOwned && tokensBilled > 0;
    const evidence = providerEvidence(event);
    const receiptFields = providerReceiptFields(event);
    const sanitizedHeaderKeys = evidence.response.sanitizedHeaders
        ? Object.keys(evidence.response.sanitizedHeaders).sort()
        : [];
    return buildLossSignal({
        code: "PROVIDER_DOWNTIME",
        detector: "availability",
        event,
        failureClass: classification.failureClass === undefined ? "downtime" : classification.failureClass,
        severity: providerOwned ? "loss" : "warning",
        liabilityParty: providerOwned ? "provider" : "unknown",
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: providerOwnedBilled ? 0 : null,
        valueKind: providerOwned ? "money" : "triage",
        recoverableBasis: providerOwned ? "whole_call" : null,
        valueJson: {
            timeLossPrimary: false,
            timeLossKind: "downtime_event_evidence",
            timeLossMethodId: TIME_LOSS_METHOD_DOWNTIME_WINDOW,
            timeLossMs: 0,
            providerRecognizedTimeLossMs: 0,
            recognitionGapTimeMs: 0,
            failedCallElapsedMs: event.timing.latencyMs,
            windowSource: null,
            windowConfidence: "event_only_or_ambiguous",
            providerRecognizedCreditUsd: 0,
            providerRecognitionLine: providerDowntimeRecognitionLine(event),
        },
        evidence: {
            provider: event.request.provider,
            statusCode: event.response.statusCode,
            errorClass: event.response.errorClass,
            rawErrorType: evidence.response.rawErrorType,
            rawErrorCode: evidence.response.rawErrorCode,
            providerRequestId: evidence.response.providerRequestId ?? evidence.request.providerRequestId,
            providerResponseId: evidence.response.providerResponseId,
            rawObjectId: evidence.response.rawObjectId,
            sanitizedHeaderKeys,
            providerReceiptPresent: receiptFields.length > 0,
            receiptFields,
            finishReason: event.response.finishReason,
            reason: classification.reason,
            branch: classification.branch,
            ownership: classification.ownership,
            triageReason: classification.triageReason ??
                (tokensBilled <= 0 ? "unbilled" : undefined),
            tokensBilled,
            failedCallElapsedMs: event.timing.latencyMs,
            providerRecognitionLine: providerDowntimeRecognitionLine(event),
        },
    });
}
export function identifyDowntimeWindows(events, options = {}) {
    const rollingWindowMs = options.rollingWindowMs ?? 300_000;
    const stepMs = options.stepMs ?? 60_000;
    const defaultThreshold = options.defaultProviderFaultRateThreshold ?? 0.05;
    const operationsByIdentity = new Map();
    for (const operation of collapseLogicalOperations(events)) {
        if (operation.status === "excluded")
            continue;
        const existing = operationsByIdentity.get(operation.identityKey) ?? [];
        operationsByIdentity.set(operation.identityKey, [...existing, operation]);
    }
    const windows = [];
    for (const operations of operationsByIdentity.values()) {
        windows.push(...identifyWindowsForIdentity(operations.sort((left, right) => left.startedAtMs - right.startedAtMs), rollingWindowMs, stepMs, defaultThreshold));
    }
    return windows.sort((left, right) => left.windowStart.localeCompare(right.windowStart));
}
function collapseLogicalOperations(events) {
    const groups = new Map();
    for (const event of events) {
        const key = [
            downtimeIdentityKey(event),
            logicalOperationKey(event),
        ].join("\u0000");
        groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.values()].map((group) => {
        const firstEvent = group[0];
        const providerFailures = group.filter((event) => classifyProviderDowntime(event)?.ownership === "provider");
        const successes = group.filter((event) => event.response.statusCode < 400);
        const status = providerFailures.length > 0
            ? "provider_fault"
            : successes.length > 0
                ? "success"
                : "excluded";
        const times = group.map((event) => eventTimeBounds(event));
        const identity = downtimeIdentity(firstEvent);
        const failureTimes = providerFailures.map((event) => eventTimeBounds(event));
        return {
            identityKey: downtimeIdentityKey(firstEvent),
            logicalOperationKey: logicalOperationKey(firstEvent),
            ...identity,
            status,
            startedAtMs: Math.min(...times.map((time) => time.startedAtMs)),
            endedAtMs: Math.max(...times.map((time) => time.endedAtMs)),
            firstFailureStartedAtMs: failureTimes.length > 0
                ? Math.min(...failureTimes.map((time) => time.startedAtMs))
                : null,
            lastFailureEndedAtMs: failureTimes.length > 0
                ? Math.max(...failureTimes.map((time) => time.endedAtMs))
                : null,
        };
    });
}
function identifyWindowsForIdentity(operations, rollingWindowMs, stepMs, defaultThreshold) {
    if (operations.length === 0)
        return [];
    const candidates = [];
    for (const startMs of downtimeScanStarts(operations, rollingWindowMs, stepMs)) {
        const endMs = startMs + rollingWindowMs;
        const windowOps = operations.filter((operation) => operation.startedAtMs >= startMs && operation.startedAtMs < endMs);
        const eligibleOps = windowOps.filter((operation) => operation.status === "success" || operation.status === "provider_fault");
        const failureOps = eligibleOps.filter((operation) => operation.status === "provider_fault");
        const threshold = providerFaultThresholdForOperations(eligibleOps, defaultThreshold);
        const providerFaultRate = eligibleOps.length > 0 ? failureOps.length / eligibleOps.length : 0;
        if (failureOps.length < 2 || providerFaultRate <= threshold.threshold)
            continue;
        const identity = eligibleOps[0];
        candidates.push({
            identity,
            scanStartMs: startMs,
            scanEndMs: endMs,
            failureStartMs: Math.min(...failureOps.map((operation) => operation.firstFailureStartedAtMs ?? operation.startedAtMs)),
            failureEndMs: Math.max(...failureOps.map((operation) => operation.lastFailureEndedAtMs ?? operation.endedAtMs)),
            eligibleKeys: new Set(eligibleOps.map((operation) => operation.logicalOperationKey)),
            failureKeys: new Set(failureOps.map((operation) => operation.logicalOperationKey)),
            threshold: threshold.threshold,
            thresholdSource: threshold.thresholdSource,
            thresholdSourceLabel: threshold.thresholdSourceLabel,
            thresholdSourceRefs: threshold.sourceRefs,
            creditTermsVerified: threshold.creditTermsVerified,
        });
    }
    return mergeDowntimeCandidates(candidates).map((candidate) => downtimeWindowFromCandidate(candidate, operations));
}
function mergeDowntimeCandidates(candidates) {
    const sorted = [...candidates].sort((left, right) => left.scanStartMs - right.scanStartMs);
    const merged = [];
    for (const candidate of sorted) {
        const previous = merged.at(-1);
        if (!previous || candidate.scanStartMs > previous.scanEndMs) {
            merged.push(candidate);
            continue;
        }
        merged[merged.length - 1] = {
            identity: previous.identity,
            scanStartMs: Math.min(previous.scanStartMs, candidate.scanStartMs),
            scanEndMs: Math.max(previous.scanEndMs, candidate.scanEndMs),
            failureStartMs: Math.min(previous.failureStartMs, candidate.failureStartMs),
            failureEndMs: Math.max(previous.failureEndMs, candidate.failureEndMs),
            eligibleKeys: new Set([...previous.eligibleKeys, ...candidate.eligibleKeys]),
            failureKeys: new Set([...previous.failureKeys, ...candidate.failureKeys]),
            threshold: previous.threshold,
            thresholdSource: previous.thresholdSource,
            thresholdSourceLabel: previous.thresholdSourceLabel,
            thresholdSourceRefs: previous.thresholdSourceRefs,
            creditTermsVerified: previous.creditTermsVerified,
        };
    }
    return merged;
}
function downtimeWindowFromCandidate(candidate, operations) {
    const windowDurationMs = Math.max(0, candidate.failureEndMs - candidate.failureStartMs);
    const goodBefore = operations
        .filter((operation) => operation.status === "success" && operation.endedAtMs <= candidate.failureStartMs)
        .sort((left, right) => right.endedAtMs - left.endedAtMs)[0];
    const goodAfter = operations
        .filter((operation) => operation.status === "success" && operation.startedAtMs >= candidate.failureEndMs)
        .sort((left, right) => left.startedAtMs - right.startedAtMs)[0];
    const eligibleOperationCount = candidate.eligibleKeys.size;
    const providerOwnedFailureOperationCount = candidate.failureKeys.size;
    const providerFaultRate = eligibleOperationCount > 0
        ? providerOwnedFailureOperationCount / eligibleOperationCount
        : 0;
    const evidenceGrade = downtimeWindowEvidenceGrade({
        eligibleOperationCount,
        providerOwnedFailureOperationCount,
        creditTermsVerified: candidate.creditTermsVerified,
    });
    const uncertaintyEnvelopeMs = goodBefore && goodAfter
        ? Math.max(0, goodAfter.startedAtMs - goodBefore.endedAtMs)
        : null;
    return {
        timeLossMethodId: TIME_LOSS_METHOD_DOWNTIME_WINDOW,
        timeLossKind: "downtime_unavailable_window",
        windowStart: new Date(candidate.failureStartMs).toISOString(),
        windowEnd: new Date(candidate.failureEndMs).toISOString(),
        windowDurationMs,
        timeLossMs: windowDurationMs,
        windowSource: "passive_window",
        windowConfidence: "observed_traffic_window",
        tenantId: candidate.identity.tenantId,
        provider: candidate.identity.provider,
        model: candidate.identity.model,
        route: candidate.identity.route,
        serviceTier: candidate.identity.serviceTier,
        region: candidate.identity.region,
        eligibleOperationCount,
        providerOwnedFailureOperationCount,
        providerFaultRate,
        threshold: candidate.threshold,
        thresholdSource: candidate.thresholdSource,
        thresholdSourceLabel: candidate.thresholdSourceLabel,
        thresholdSourceRefs: candidate.thresholdSourceRefs,
        creditTermsVerified: candidate.creditTermsVerified,
        evidenceGrade,
        lastGoodBefore: goodBefore ? new Date(goodBefore.endedAtMs).toISOString() : null,
        firstGoodAfter: goodAfter ? new Date(goodAfter.startedAtMs).toISOString() : null,
        uncertaintyEnvelopeMs,
        sparseTraffic: evidenceGrade === "organic_sparse",
        statusFeedCorroborated: false,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: windowDurationMs,
    };
}
function downtimeWindowEvidenceGrade(input) {
    if (input.creditTermsVerified)
        return "claim_grade_provider_sla";
    if (input.eligibleOperationCount >= 20)
        return "organic_strong";
    if (input.providerOwnedFailureOperationCount >= 3 &&
        input.providerOwnedFailureOperationCount === input.eligibleOperationCount) {
        return "organic_strong";
    }
    return "organic_sparse";
}
function providerFaultThresholdForOperations(operations, defaultThreshold) {
    const slaProvider = operations.map((operation) => operation.slaProvider)
        .find((value) => Boolean(value));
    const verified = slaProvider ? PROVIDER_SLA_THRESHOLDS[slaProvider] : undefined;
    if (verified)
        return verified;
    return {
        threshold: defaultThreshold,
        thresholdSource: DEFAULT_PROVIDER_FAULT_THRESHOLD_SOURCE,
        thresholdSourceLabel: DEFAULT_PROVIDER_FAULT_THRESHOLD_LABEL,
        sourceRefs: [
            "downtime-identification-method-2026-07-05:Default organic rule",
            "provider-sla-latency-compensation-2026-07-05:Gemini Online Inference API on Vertex/Gemini Enterprise",
        ],
        creditTermsVerified: false,
    };
}
function downtimeIdentityKey(event) {
    const identity = downtimeIdentity(event);
    return [
        identity.tenantId,
        identity.provider,
        identity.model,
        identity.route ?? "",
        identity.serviceTier ?? "",
        identity.region ?? "",
        identity.slaProvider ?? "",
    ].join("\u001f");
}
function downtimeIdentity(event) {
    const metadata = event;
    return {
        tenantId: event.request.tenantId,
        provider: event.request.provider,
        model: metadata.response.servedModel ?? metadata.request.model ??
            metadata.request.requestedModel ?? event.request.model,
        route: metadata.request.route ?? metadata.request.workloadClass ?? null,
        serviceTier: metadata.response.serviceTier ?? metadata.usage.serviceTier ?? null,
        region: metadata.usage.inferenceGeo ?? null,
        slaProvider: metadata.meta.slaProvider ?? metadata.usage.slaProvider ?? null,
    };
}
function downtimeScanStarts(operations, rollingWindowMs, stepMs) {
    if (operations.length === 0)
        return [];
    const firstStartMs = Math.min(...operations.map((operation) => operation.startedAtMs));
    const lastStartMs = Math.max(...operations.map((operation) => operation.startedAtMs));
    const starts = new Set();
    for (let startMs = Math.floor(firstStartMs / stepMs) * stepMs; startMs <= lastStartMs; startMs += stepMs) {
        starts.add(startMs);
    }
    for (const operation of operations) {
        if (operation.status !== "provider_fault")
            continue;
        starts.add(operation.startedAtMs);
        starts.add(Math.max(firstStartMs, operation.startedAtMs - rollingWindowMs + 1));
    }
    return [...starts].sort((left, right) => left - right);
}
function providerDowntimeRecognitionLine(event) {
    const metadata = event;
    const slaProvider = metadata.meta.slaProvider ?? metadata.usage.slaProvider ?? null;
    if (slaProvider && PROVIDER_SLA_THRESHOLDS[slaProvider]?.creditTermsVerified) {
        return "Credit path: service credit may be capped at eligible spend under verified cloud SLA provenance";
    }
    return "Provider-recognized: $0 / 0s - first-party credit terms unverified";
}
function logicalOperationKey(event) {
    const metadata = event;
    return metadata.request.operationId ??
        metadata.request.idempotencyKey ??
        metadata.request.retryCorrelationId ??
        metadata.request.bodyHash ??
        `${event.request.requestId}:${event.meta.attemptIndex}`;
}
function eventTimeBounds(event) {
    const startedAtMs = Date.parse(event.timing.startedAt);
    const endedAtMs = Date.parse(event.timing.endedAt);
    const safeStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : 0;
    const safeEndedAtMs = Number.isFinite(endedAtMs)
        ? endedAtMs
        : safeStartedAtMs + event.timing.latencyMs;
    return {
        startedAtMs: safeStartedAtMs,
        endedAtMs: Math.max(safeStartedAtMs, safeEndedAtMs),
    };
}
function providerEvidence(event) {
    return event;
}
function hasProviderErrorSurface(event) {
    const evidence = providerEvidence(event);
    return event.response.statusCode >= 300 ||
        Boolean(event.response.errorClass ||
            evidence.response.rawErrorType ||
            evidence.response.rawErrorCode);
}
function hasProviderReceipt(event) {
    return providerReceiptFields(event).length > 0;
}
function providerReceiptFields(event) {
    const evidence = providerEvidence(event);
    const headers = evidence.response.sanitizedHeaders ?? {};
    return [
        evidence.request.providerRequestId ? "request.providerRequestId" : null,
        evidence.response.providerRequestId ? "response.providerRequestId" : null,
        evidence.response.providerResponseId ? "response.providerResponseId" : null,
        evidence.response.rawObjectId ? "response.rawObjectId" : null,
        headers["request-id"] ? "response.sanitizedHeaders.request-id" : null,
        headers["x-request-id"] ? "response.sanitizedHeaders.x-request-id" : null,
        headers["openai-request-id"] ? "response.sanitizedHeaders.openai-request-id" : null,
        headers["anthropic-request-id"] ? "response.sanitizedHeaders.anthropic-request-id" : null,
    ].filter((field) => field !== null);
}
function hasProviderRawErrorEvidence(event) {
    const evidence = providerEvidence(event);
    if (evidence.response.rawErrorType || evidence.response.rawErrorCode)
        return true;
    const bodyText = (event.response.content ?? "").toLowerCase();
    return providerRawErrorBodyTerms(event.request.provider).some((term) => bodyText.includes(term));
}
function providerRawErrorBodyTerms(provider) {
    switch (provider) {
        case "anthropic":
            return ["overloaded_error", "api_error", "timeout_error"];
        case "openai":
            return ["server_error", "internal_server_error", "overloaded_error"];
        default:
            return [];
    }
}
function openRouterHasSelectedEndpointEvidence(event) {
    const openRouter = openRouterStopDetails(event);
    const fieldPath = stringRecordValue(openRouter, "metadataFieldPath");
    return Boolean(stringRecordValue(openRouter, "selectedUpstreamProvider") &&
        stringRecordValue(openRouter, "metadataStatus") === "captured" &&
        fieldPath?.includes(".openrouter_metadata.endpoints.available"));
}
function openRouterStopDetails(event) {
    const response = event.response;
    const value = response.stopDetails?.openRouter;
    return isRecord(value) ? value : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringRecordValue(record, key) {
    const value = record?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function providerStatusReason(event) {
    const evidence = providerEvidence(event);
    if (event.request.provider === "anthropic") {
        if (event.response.statusCode === 529 || evidence.response.rawErrorType === "overloaded_error") {
            return "anthropic_overloaded";
        }
        if (event.response.statusCode === 504 || evidence.response.rawErrorType === "timeout_error") {
            return "anthropic_timeout";
        }
        if (event.response.statusCode === 500 || evidence.response.rawErrorType === "api_error") {
            return "anthropic_api_error";
        }
    }
    return "provider_status_5xx";
}
function hasProviderOwnedCapacityCode(event) {
    const evidence = providerEvidence(event);
    const codeText = [
        evidence.response.rawErrorType,
        evidence.response.rawErrorCode,
        event.response.errorClass,
    ]
        .filter((value) => Boolean(value))
        .join(" ")
        .toLowerCase();
    return codeText.includes("overloaded") ||
        codeText.includes("provider_capacity") ||
        codeText.includes("provider_over_capacity") ||
        codeText.includes("provider_rate_limit_capacity");
}
function geminiHasProviderCapacityEvidence(event, evidenceText) {
    const evidence = providerEvidence(event);
    const codeText = [
        evidence.response.rawErrorType,
        evidence.response.rawErrorCode,
        event.response.errorClass,
        evidenceText,
    ]
        .filter((value) => Boolean(value))
        .join(" ")
        .toLowerCase();
    return codeText.includes("overloaded") ||
        codeText.includes("unavailable") ||
        codeText.includes("provider_capacity") ||
        codeText.includes("provider_rate_limit_capacity") ||
        codeText.includes("provider_timeout");
}
function geminiHasCustomerTimeoutEvidence(evidenceText) {
    const normalized = evidenceText.toLowerCase();
    return normalized.includes("quota") ||
        normalized.includes("resource_exhausted") ||
        normalized.includes("customer") ||
        normalized.includes("client_timeout") ||
        normalized.includes("request_deadline");
}
//# sourceMappingURL=availability.js.map