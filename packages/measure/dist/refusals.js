import { observedChargeUsdForEvent } from "./billing-integrity.js";
import { hasOutputSchema } from "./output-schemas.js";
import { roundUsd, tokensBilledForEvent } from "./pricing.js";
import { buildLossSignal, eventKey, providerSafetyForEvent, refundableCandidateEconomics, } from "./signal.js";
const REFUSAL_ACTION_PATTERN = "(?:assist|help|provide|complete|comply|fulfill|answer|continue|support)";
const OPTIONAL_REFUSAL_OPENING_PATTERN = String.raw `(?:(?:sorry|i(?:'|’)m sorry|i am sorry|apologies|no|unfortunately)[\s,.!-]*(?:but\s+)?)?`;
const AS_AI_PREFIX_PATTERN = String.raw `(?:as an ai(?: language model)?[\s,]+)?`;
const FIRST_PERSON_REFUSAL_PATTERN = [
    String.raw `i\s+(?:cannot|can't|can’t|won't|will not)\s+${REFUSAL_ACTION_PATTERN}\b`,
    String.raw `i\s+am\s+unable\s+to\s+${REFUSAL_ACTION_PATTERN}\b`,
    String.raw `i(?:'|’)?m\s+unable\s+to\s+${REFUSAL_ACTION_PATTERN}\b`,
].join("|");
const IMPERSONAL_REFUSAL_PATTERN = String.raw `(?:(?:cannot|can't|can’t)\s+(?:assist|help|provide|complete|comply|fulfill)\b|i\s+must\s+refuse\b)`;
// Regex-tier refusal matching stays deliberately narrow: answer-opening refusal
// shapes only. Provider-native safety fields and classifier verdicts are stronger tiers.
const REFUSAL_PATTERNS = [
    new RegExp(String.raw `^\s*${OPTIONAL_REFUSAL_OPENING_PATTERN}` +
        String.raw `${AS_AI_PREFIX_PATTERN}(?:${FIRST_PERSON_REFUSAL_PATTERN}|${IMPERSONAL_REFUSAL_PATTERN})`, "i"),
];
const classifierVerdicts = new Map();
const PROVIDER_REFUSAL_KINDS = new Set(["content_filter", "refusal"]);
const ANTHROPIC_REFUSAL_BILLING_DOC_URL = "https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback";
const CONTENT_FILTER_DETECTOR_NAME = "content-filter-omitted-output";
const CONTENT_FILTER_DETECTOR_VERSION = "v0";
const CONTENT_FILTER_BILLING_BASIS_LABEL = "UNVERIFIED";
export const CONTENT_FILTER_OMITTED_OUTPUT_SIGNAL_CODES = [
    "OPENAI_CONTENT_FILTER_OMITTED_OUTPUT",
];
export function registerRefusalClassifierVerdict(verdict) {
    classifierVerdicts.set(`${verdict.tenantId}:${verdict.provider}:${verdict.requestId}`, verdict);
}
export function clearRefusalClassifierVerdicts() {
    classifierVerdicts.clear();
}
function providerRefusalTier(event) {
    const providerSafety = providerSafetyForEvent(event).filter((entry) => entry.source === "provider" && PROVIDER_REFUSAL_KINDS.has(entry.kind));
    const tier = providerRefusalEvidenceTier(event.request.provider);
    if (providerSafety.length > 0) {
        return {
            tier,
            safetyKinds: uniqueStrings(providerSafety.map((entry) => entry.kind)),
            safetyReasons: uniqueStrings(providerSafety.flatMap((entry) => entry.reason ? [entry.reason] : [])),
            safetyRaw: providerSafety.flatMap((entry) => entry.raw === undefined ? [] : [entry.raw]),
        };
    }
    if (event.request.provider === "anthropic" &&
        event.response.finishReason === "refusal") {
        return { tier, safetyKinds: ["refusal"], safetyReasons: ["refusal"], safetyRaw: [] };
    }
    if (event.request.provider === "openai" &&
        event.response.finishReason === "content_filter") {
        return {
            tier,
            safetyKinds: ["content_filter"],
            safetyReasons: ["content_filter"],
            safetyRaw: [],
        };
    }
    return null;
}
function providerRefusalEvidenceTier(provider) {
    if (provider === "anthropic")
        return "provider_anthropic";
    if (provider === "gemini")
        return "provider_gemini";
    return "provider_openai";
}
export function regexRefusalTier(content) {
    return REFUSAL_PATTERNS.some((pattern) => pattern.test(content)) ? "regex" : null;
}
export function classifierRefusalTier(event) {
    const verdict = classifierVerdicts.get(eventKey(event));
    if (!verdict?.isRefusal)
        return null;
    return { tier: "classifier", verdict };
}
function expectsCompletion(event) {
    const outputSchemaVersion = event.meta.outputSchemaVersion;
    return event.request.expectCompletion === true ||
        (outputSchemaVersion
            ? hasOutputSchema(event.request.tenantId, outputSchemaVersion)
            : false);
}
function buildRefusalSignal(event, providerEvidence, observedChargeUsd) {
    const tokensBilled = tokensBilledForEvent(event);
    if (!providerEvidence || !expectsCompletion(event))
        return null;
    if (observedChargeUsd !== null) {
        const invariant = buildAnthropicPreOutputRefusalBilledInvariantSignal(event, { chargedUsd: observedChargeUsd }, providerEvidence);
        if (invariant)
            return invariant;
    }
    if (tokensBilled === 0)
        return null;
    if (isAnthropicPreOutputRefusal(event)) {
        return buildLossSignal({
            code: "REFUSAL_BILLED",
            detector: "refusal",
            event,
            failureClass: "refusal",
            status: "triage_only",
            evidenceGrade: "triage_only",
            dispute: false,
            liabilityParty: "unknown",
            creditCandidate: false,
            valueKind: "money",
            recoverableBasis: "whole_call",
            providerRecoverableLossUsd: 0,
            evidence: {
                tier: providerEvidence.tier,
                finishReason: event.response.finishReason,
                expectCompletion: event.request.expectCompletion === true,
                tokensBilled,
                chargeEvidence: "provider_usage",
                refusalDetectionSource: "provider_native",
                refusalBillingMode: "pre_output_without_observed_charge",
                documentationUrl: ANTHROPIC_REFUSAL_BILLING_DOC_URL,
                providerSafetyKinds: providerEvidence.safetyKinds,
                providerSafetyReasons: providerEvidence.safetyReasons,
                providerSafetyRaw: providerEvidence.safetyRaw,
            },
            valueJson: {
                refusalDetectionSource: "provider_native",
                refusalBillingMode: "pre_output_without_observed_charge",
            },
        });
    }
    return buildLossSignal({
        code: "REFUSAL_BILLED",
        detector: "refusal",
        event,
        failureClass: "refusal",
        ...refundableCandidateEconomics(event),
        evidence: {
            tier: providerEvidence.tier,
            finishReason: event.response.finishReason,
            expectCompletion: event.request.expectCompletion === true,
            tokensBilled,
            chargeEvidence: "provider_usage",
            refusalDetectionSource: "provider_native",
            providerSafetyKinds: providerEvidence.safetyKinds,
            providerSafetyReasons: providerEvidence.safetyReasons,
            providerSafetyRaw: providerEvidence.safetyRaw,
            ...(isAnthropicRefusal(event)
                ? {
                    refusalBillingMode: "mid_stream_billed",
                    documentationUrl: ANTHROPIC_REFUSAL_BILLING_DOC_URL,
                }
                : {}),
        },
        valueJson: {
            refusalDetectionSource: "provider_native",
            ...(isAnthropicRefusal(event)
                ? { refusalBillingMode: "mid_stream_billed" }
                : {}),
        },
    });
}
function buildClassifierRefusalSignal(event, classifierEvidence) {
    if (!classifierEvidence || !expectsCompletion(event))
        return null;
    if (tokensBilledForEvent(event) === 0)
        return null;
    const standardLossEligibility = classifierRefusalStandardLossEligibility(event, classifierEvidence);
    const eligibleEvidence = {
        standardLossEligible: standardLossEligibility.eligible,
        standardLossEligibility: standardLossEligibility.reason,
        ...(standardLossEligibility.taskContractEvidence
            ? { taskContractEvidence: standardLossEligibility.taskContractEvidence }
            : {}),
    };
    const ineligiblePricingFields = standardLossEligibility.eligible
        ? {}
        : {
            expectedChargeUsd: null,
            pricingVersion: null,
            pricingStatus: "not_priced",
        };
    return buildLossSignal({
        code: "REFUSAL_BILLED",
        detector: "refusal",
        event,
        failureClass: standardLossEligibility.eligible ? "refusal" : null,
        status: "triage_only",
        evidenceGrade: "triage_only",
        severity: standardLossEligibility.eligible ? "loss" : "warning",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        valueKind: standardLossEligibility.eligible ? "money" : "triage",
        recoverableBasis: standardLossEligibility.eligible ? "whole_call" : null,
        observedChargeUsd: null,
        providerRecoverableLossUsd: 0,
        ...ineligiblePricingFields,
        valueJson: {
            refusalDetectionSource: classifierEvidence.source,
            refusalDetectionMechanism: classifierEvidence.mechanism,
            ...eligibleEvidence,
            ...(classifierEvidence.score !== undefined ? { classifierScore: classifierEvidence.score } : {}),
            ...(classifierEvidence.model ? { classifierModel: classifierEvidence.model } : {}),
        },
        evidence: {
            tier: classifierEvidence.tier,
            finishReason: event.response.finishReason,
            expectCompletion: event.request.expectCompletion === true,
            tokensBilled: tokensBilledForEvent(event),
            chargeEvidence: "provider_usage",
            refusalDetectionSource: classifierEvidence.source,
            refusalDetectionMechanism: classifierEvidence.mechanism,
            ...eligibleEvidence,
            ...(classifierEvidence.score !== undefined ? { classifierScore: classifierEvidence.score } : {}),
            ...(classifierEvidence.model ? { classifierModel: classifierEvidence.model } : {}),
        },
    });
}
function classifierRefusalStandardLossEligibility(event, classifierEvidence) {
    if (classifierEvidence.mechanism !== "regex") {
        return { eligible: true, reason: "classifier_refusal" };
    }
    const taskContractEvidence = registeredOutputSchemaTaskContractEvidence(event);
    if (taskContractEvidence) {
        return { eligible: true, reason: "task_contract_refusal", taskContractEvidence };
    }
    return { eligible: false, reason: "regex_only_triage" };
}
function registeredOutputSchemaTaskContractEvidence(event) {
    const outputSchemaVersion = event.meta.outputSchemaVersion;
    if (!outputSchemaVersion)
        return null;
    if (!hasOutputSchema(event.request.tenantId, outputSchemaVersion))
        return null;
    return {
        kind: "registered_output_schema",
        outputSchemaVersion,
    };
}
export function buildAnthropicPreOutputRefusalBilledInvariantSignal(event, observedCharge, providerEvidence = providerRefusalTier(event)) {
    if (!providerEvidence || !expectsCompletion(event))
        return null;
    if (!isAnthropicPreOutputRefusal(event))
        return null;
    if (observedCharge.chargedUsd <= 0)
        return null;
    const chargedUsd = roundUsd(observedCharge.chargedUsd);
    return buildLossSignal({
        code: "REFUSAL_PREOUTPUT_BILLED_INVARIANT",
        detector: "refusal",
        event,
        failureClass: "refusal",
        status: "candidate",
        evidenceGrade: "refundable_candidate",
        creditCandidate: true,
        observedChargeUsd: chargedUsd,
        expectedChargeUsd: 0,
        providerRecoverableLossUsd: chargedUsd,
        pricingVersion: null,
        pricingStatus: "priced",
        evidence: {
            provider: "anthropic",
            finishReason: event.response.finishReason,
            expectCompletion: event.request.expectCompletion === true,
            contentEmpty: true,
            inputTokens: event.usage.input,
            outputTokens: event.usage.output,
            chargeEvidence: "observed_charge",
            chargedUsd,
            documentedExpectedChargeUsd: 0,
            documentedRule: "pre_output_refusal_usage_counts_are_informational_not_charged",
            documentationUrl: ANTHROPIC_REFUSAL_BILLING_DOC_URL,
            providerSafetyKinds: providerEvidence.safetyKinds,
            providerSafetyReasons: providerEvidence.safetyReasons,
            providerSafetyRaw: providerEvidence.safetyRaw,
            ...(observedCharge.currency ? { currency: observedCharge.currency } : {}),
            ...(observedCharge.source ? { source: observedCharge.source } : {}),
            ...(observedCharge.observedAt ? { observedAt: observedCharge.observedAt } : {}),
            refusalDetectionSource: "provider_native",
        },
        valueJson: {
            refusalDetectionSource: "provider_native",
            refusalBillingMode: "pre_output_observed_charge",
        },
    });
}
export function detectStatelessRefusal(event) {
    return buildRefusalSignal(event, providerRefusalTier(event), null) ??
        buildClassifierRefusalSignal(event, classifierEvidenceForEvent(event));
}
export function detectRefusal(event) {
    return buildRefusalSignal(event, providerRefusalTier(event), observedChargeUsdForEvent(event)) ??
        buildClassifierRefusalSignal(event, classifierEvidenceForEvent(event));
}
export function runContentFilterOmittedOutputDetectors(event) {
    const signal = detectOpenAiContentFilterOmittedOutput(event);
    return signal ? [signal] : [];
}
export function detectOpenAiContentFilterOmittedOutput(event) {
    if (event.request.provider !== "openai")
        return null;
    const contentFilterEvidence = contentFilterEvidenceForEvent(event);
    if (!contentFilterEvidence)
        return null;
    const tokensBilled = tokensBilledForEvent(event);
    const contentOmitted = event.response.content.trim().length === 0;
    return {
        code: "OPENAI_CONTENT_FILTER_OMITTED_OUTPUT",
        detectorName: CONTENT_FILTER_DETECTOR_NAME,
        detectorVersion: CONTENT_FILTER_DETECTOR_VERSION,
        tenantId: event.request.tenantId,
        requestId: event.request.requestId,
        provider: "openai",
        model: event.request.model,
        status: "triage_only",
        evidenceGrade: "triage_only",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        fieldPath: contentFilterEvidence.fieldPath,
        billingBasisLabel: CONTENT_FILTER_BILLING_BASIS_LABEL,
        evidence: {
            reason: "openai_content_filter_omitted_output",
            provider: "openai",
            finishReason: event.response.finishReason,
            expectCompletion: event.request.expectCompletion === true,
            fieldPath: contentFilterEvidence.fieldPath,
            contentOmitted,
            usageTokenCount: tokensBilled,
            outputTokens: event.usage.output,
            billingBasisLabel: CONTENT_FILTER_BILLING_BASIS_LABEL,
            billingBasis: "openai_1p_explicit_billing_unverified",
            documentedBillingEvidence: false,
            providerOwedClaim: false,
            providerSafetyKinds: contentFilterEvidence.safetyKinds,
            providerSafetyReasons: contentFilterEvidence.safetyReasons,
            providerSafetyFieldPaths: contentFilterEvidence.safetyFieldPaths,
        },
        valueJson: {
            omittedOutput: contentOmitted,
            usageTokenCount: tokensBilled,
            outputTokens: event.usage.output,
            billingBasisLabel: CONTENT_FILTER_BILLING_BASIS_LABEL,
            documentedBillingEvidence: false,
            providerOwedClaim: false,
        },
    };
}
export function isOpenAiContentFilterOnlyRefusalBilledSignal(signal) {
    if (signal.code !== "REFUSAL_BILLED")
        return false;
    if (signal.provider !== "openai")
        return false;
    const providerSafetyKinds = stringArrayEvidence(signal.evidence.providerSafetyKinds);
    const hasContentFilter = providerSafetyKinds.includes("content_filter") ||
        signal.evidence.finishReason === "content_filter";
    const hasRefusal = providerSafetyKinds.includes("refusal");
    return hasContentFilter && !hasRefusal;
}
function contentFilterEvidenceForEvent(event) {
    const safetyEntries = providerSafetyForEvent(event).filter(isProviderContentFilterEntry);
    if (safetyEntries.length === 0 && event.response.finishReason !== "content_filter")
        return null;
    const safetyFieldPaths = uniqueStrings(safetyEntries.map(providerSafetyFieldPath));
    return {
        fieldPath: safetyFieldPaths[0] ?? "response.finishReason",
        safetyKinds: safetyEntries.length > 0 ? ["content_filter"] : [],
        safetyReasons: uniqueStrings(safetyEntries.flatMap((entry) => entry.reason ? [entry.reason] : [])),
        safetyFieldPaths,
    };
}
function isProviderContentFilterEntry(entry) {
    return entry.source === "provider" && entry.kind === "content_filter";
}
function providerSafetyFieldPath(entry) {
    if (isRecord(entry.raw) && typeof entry.raw.fieldPath === "string" && entry.raw.fieldPath.length > 0) {
        return entry.raw.fieldPath;
    }
    return "response.providerSafety";
}
function stringArrayEvidence(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function isAnthropicRefusal(event) {
    return event.request.provider === "anthropic" &&
        event.response.finishReason === "refusal";
}
function isAnthropicPreOutputRefusal(event) {
    return isAnthropicRefusal(event) && event.response.content.trim().length === 0;
}
function classifierEvidenceForEvent(event) {
    const classifier = classifierRefusalTier(event);
    if (classifier) {
        return {
            tier: "classifier",
            source: "classifier",
            mechanism: "protectai",
            score: classifier.verdict.score,
            model: classifier.verdict.model,
        };
    }
    if (regexRefusalTier(event.response.content)) {
        return {
            tier: "classifier",
            source: "classifier",
            mechanism: "regex",
        };
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=refusals.js.map