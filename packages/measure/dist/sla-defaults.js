import { ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT } from "./anthropic-token-crosscheck.js";
const MILLISECONDS_PER_HOUR = 3_600_000;
export const SLA_DEFAULTS = {
    standardVersion: "sla-defaults-2026-07-03-user-approved",
    signoff: {
        signedOffBy: "user",
        signedOffAt: "2026-07-03",
        numbersShipAs: "approved",
    },
    evidenceGrades: {
        unrecognizedStandardLoss: "standard-defined loss, provider-unrecognized (owed by Inferock Standard; not yet provider-recognized)",
    },
    timeValueRate: {
        usdPerHour: 92,
        currency: "USD",
        unit: "hour",
        label: "Inferock DEFAULT ASSUMPTION - not customer-confirmed, not provider-recognized loss (default — override)",
        oneLineWhy: "BLS median software developer wage, loaded by BLS private-industry benefit share.",
        sourceIds: ["BLS-OOH", "BLS-OEWS-2080", "BLS-ECEC"],
        sourceNote: "This default is the Inferock proposed time-value assumption, computed from BLS software-developer wage data and BLS private-industry benefit share (`BLS-OOH`, `BLS-OEWS-2080`, `BLS-ECEC`). It is not customer-confirmed and not provider-recognized. Receipts must preserve the override key `time_value_usd_per_hour` so customers can replace it with their own loaded rate or set it to zero.",
        signoffRequired: false,
        overrideKey: "time_value_usd_per_hour",
        excessOnly: true,
    },
    latencySegments: {
        interactive_streaming_non_reasoning: {
            label: "interactive streaming / non-reasoning (default — override)",
            interactionClass: "interactive_streaming",
            reasoningClass: "non_reasoning",
            thresholds: {
                goodStartMs: 1_000,
                acceptableStartMs: 10_000,
                goodOutputTokensPerSecond: 50,
                acceptableOutputTokensPerSecond: 44,
                goodMsPerOutputToken: 20,
                acceptableMsPerOutputToken: 23,
            },
            oneLineWhy: "Nielsen 1s/10s response-time limits plus OpenAI/Azure/Bedrock published TPS anchors.",
            sourceIds: ["UX-NIELSEN", "OPENAI-SCALE", "AZURE-PRIORITY", "BEDROCK-OTPS"],
            overrideKey: "latency.interactive_streaming.non_reasoning",
        },
        interactive_streaming_reasoning: {
            label: "interactive streaming / reasoning (default — override)",
            interactionClass: "interactive_streaming",
            reasoningClass: "reasoning",
            thresholds: {
                goodStartMs: 10_000,
                acceptableStartMs: 500_000,
                goodOutputTokensPerSecond: 50,
                acceptableOutputTokensPerSecond: 44,
                goodMsPerOutputToken: 20,
                acceptableMsPerOutputToken: 23,
            },
            oneLineWhy: "Reasoning allowance from OpenAI 25,000-token experimentation reserve divided by the 50 TPS anchor.",
            sourceIds: [
                "UX-NIELSEN",
                "OPENAI-REASONING",
                "OPENAI-REASONING-BEST",
                "ANTHROPIC-THINKING",
                "ANTHROPIC-CONTEXT",
                "OPENAI-SCALE",
                "AZURE-PRIORITY",
            ],
            overrideKey: "latency.interactive_streaming.reasoning",
        },
        batch_non_reasoning: {
            label: "batch / non-reasoning (default — override)",
            interactionClass: "batch",
            reasoningClass: "non_reasoning",
            thresholds: {
                goodStartMs: 30_000,
                acceptableStartMs: 3_600_000,
                goodOutputTokensPerSecond: 50,
                acceptableOutputTokensPerSecond: 44,
                goodMsPerOutputToken: 20,
                acceptableMsPerOutputToken: 23,
            },
            oneLineWhy: "Current local 30s non-interactive good boundary plus Anthropic batch typical-completion boundary.",
            sourceIds: ["LOCAL-LATENCY", "ANTHROPIC-BATCH", "OPENAI-SCALE", "AZURE-PRIORITY"],
            overrideKey: "latency.batch.non_reasoning",
        },
        batch_reasoning: {
            label: "batch / reasoning (default — override)",
            interactionClass: "batch",
            reasoningClass: "reasoning",
            thresholds: {
                goodStartMs: 500_000,
                acceptableStartMs: 3_600_000,
                goodOutputTokensPerSecond: 50,
                acceptableOutputTokensPerSecond: 44,
                goodMsPerOutputToken: 20,
                acceptableMsPerOutputToken: 23,
            },
            oneLineWhy: "Reasoning reserve good boundary plus Anthropic batch typical-completion acceptable boundary.",
            sourceIds: ["OPENAI-REASONING", "ANTHROPIC-BATCH", "OPENAI-SCALE", "AZURE-PRIORITY"],
            overrideKey: "latency.batch.reasoning",
        },
    },
    renderCopy: {
        latencyTimingMissing: "not exercised by this traffic: no latency timing captured",
        noJsonSchemaContract: "not exercised by this traffic: no JSON/schema output contract",
        openAiRecountNotEligible: "not exercised by this traffic: not eligible for OpenAI visible-output recount",
        anthropicCrosscheckNotEligible: "not exercised by this traffic: no Anthropic output-token traffic for recount cross-check",
        duplicateEvidenceAbsent: "not exercised by this traffic: no duplicate request-ID evidence",
        cacheChargeObservationMissing: "not exercised by this traffic: no provider charge observation for cache reconciliation",
        driftBaselineMissing: "not exercised by this traffic: no approved drift baseline or replay contract",
        toolTrafficMissing: "not exercised by this traffic: no tool-call traffic",
        securityEvidenceMissing: "not exercised by this traffic: no security evidence source captured",
        factualityContractMissing: "not exercised by this traffic: no factuality contract captured",
        contentFilterMissing: "not exercised by this traffic: no provider content-filter event",
        notStreaming: "not exercised by this traffic: not a streaming request",
        streamTerminalEvidenceMissing: "not exercised by this traffic: stream request without terminal evidence",
        retryEvidenceMissing: "not exercised by this traffic: no retry evidence captured",
        servedModelEvidenceMissing: "not exercised by this traffic: no provider-response served-model evidence",
    },
    measureDefaultPolicies: {
        brokenOutputJsonMode: "JSON mode defaults to must be parseable JSON.",
        anthropicTokenCrosscheck: `Anthropic output token cross-check uses the calibrated count_tokens recount when verified, otherwise the conservative gross-bound fallback. ${ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT}`,
        duplicateRequestId: "Bench groups events by tenant/provider/request ID for duplicate evidence.",
        latency: "Bench applies the segmented Inferock default latency standard to every timed call.",
        securityGovernance: "Bench surfaces provider safety and exact secret evidence as evidence-only overlays.",
        contentFilter: "Bench surfaces provider content-filter evidence as an evidence-only overlay.",
        streamTermination: "Bench surfaces stream terminal-state anomalies as evidence-only overlays.",
        retryAmplification: "Bench surfaces captured retry evidence as an evidence-only overlay.",
        servedModelMismatch: "Bench surfaces provider-response served-model mismatches as identity triage unless billing evidence proves an overcharge delta.",
    },
    sourceRegister: {
        "UX-NIELSEN": "Nielsen Norman Group response-time limits: 0.1s, 1s, 10s.",
        "OPENAI-SCALE": "OpenAI Scale Tier published TPS latency anchors.",
        "OPENAI-PRIORITY": "OpenAI Priority Processing enterprise SLA guidance.",
        "OPENAI-REASONING": "OpenAI reasoning-token guidance and 25,000 generated-token reserve.",
        "OPENAI-REASONING-BEST": "OpenAI reasoning best-practice speed/cost positioning.",
        "AZURE-PRIORITY": "Azure OpenAI priority processing TPS targets.",
        "AZURE-LATENCY": "Azure OpenAI latency metric formula.",
        "AZURE-METRICS": "Azure OpenAI TTFT/TBT/TTLB/TPS metrics.",
        "BEDROCK-METRICS": "Amazon Bedrock runtime latency and token metrics.",
        "BEDROCK-OTPS": "Amazon Bedrock OTPS p50 and 80% alarm-threshold example.",
        "ANTHROPIC-THINKING": "Anthropic extended-thinking behavior.",
        "ANTHROPIC-CONTEXT": "Anthropic thinking tokens and context accounting.",
        "ANTHROPIC-BATCH": "Anthropic batch completion and expiry windows.",
        "LOCAL-LATENCY": "Existing local latency default in packages/measure/src/latency.ts.",
        "BLS-OOH": "BLS May 2024 software developer median annual wage.",
        "BLS-OEWS-2080": "BLS 2,080-hour annual wage conversion.",
        "BLS-ECEC": "BLS private-industry wage and benefit share.",
    },
};
export const SLA_STANDARD_VERSION = SLA_DEFAULTS.standardVersion;
export const DEFAULT_TIME_VALUE_USD_PER_HOUR = SLA_DEFAULTS.timeValueRate.usdPerHour;
export const UNRECOGNIZED_STANDARD_LOSS_EVIDENCE_GRADE = "unrecognized_standard_loss";
export function selectDefaultLatencySegment(event) {
    const interactionClass = latencyInteractionClass(event);
    const reasoningClass = latencyReasoningClass(event);
    const segmentId = `${interactionClass}_${reasoningClass}`;
    const segment = SLA_DEFAULTS.latencySegments[segmentId];
    return {
        segmentId,
        interactionClass,
        reasoningClass,
        label: segment.label,
        selectionReason: latencySelectionReason(event, interactionClass, reasoningClass),
    };
}
export function evaluateDefaultLatency(event) {
    const segment = selectDefaultLatencySegment(event);
    const thresholds = SLA_DEFAULTS.latencySegments[segment.segmentId].thresholds;
    const outputTokens = event.usage.output;
    const observedTotalMs = event.timing.latencyMs;
    const firstResultMs = firstResultMsForEvent(event);
    const outputTokensPerSecond = outputTokens > 0 && observedTotalMs > 0
        ? outputTokens / (observedTotalMs / 1000)
        : null;
    const acceptableTotalMs = thresholds.acceptableStartMs +
        outputTokens * thresholds.acceptableMsPerOutputToken;
    const goodTotalMs = thresholds.goodStartMs + outputTokens * thresholds.goodMsPerOutputToken;
    const excessMs = Math.max(0, observedTotalMs - acceptableTotalMs);
    const standardLossUsd = roundUsd(excessMs / MILLISECONDS_PER_HOUR * SLA_DEFAULTS.timeValueRate.usdPerHour);
    return {
        exercised: Number.isFinite(observedTotalMs) && observedTotalMs > 0,
        segment,
        thresholds,
        observed: {
            totalMs: observedTotalMs,
            firstResultMs,
            outputTokens,
            outputTokensPerSecond,
        },
        acceptableTotalMs,
        goodTotalMs,
        excessMs,
        standardLossUsd,
        metricGrades: {
            firstResult: firstResultMs === null
                ? "not_exercised"
                : latencyDurationGrade(firstResultMs, thresholds.goodStartMs, thresholds.acceptableStartMs),
            outputThroughput: outputTokensPerSecond === null
                ? "not_exercised"
                : latencyThroughputGrade(outputTokensPerSecond, thresholds.goodOutputTokensPerSecond, thresholds.acceptableOutputTokensPerSecond),
            total: latencyDurationGrade(observedTotalMs, goodTotalMs, acceptableTotalMs),
        },
        ...(Number.isFinite(observedTotalMs) && observedTotalMs > 0
            ? {}
            : { notExercisedLabel: SLA_DEFAULTS.renderCopy.latencyTimingMissing }),
    };
}
function latencyInteractionClass(event) {
    const generation = event.request.generation;
    if (generation?.stream === true || hasPositiveStreamTimingEvidence(event)) {
        return "interactive_streaming";
    }
    return event.request.workloadClass === "batch" ? "batch" : "interactive_streaming";
}
function latencyReasoningClass(event) {
    if (usageCategoriesShowReasoning(event))
        return "reasoning";
    const generation = event.request.generation;
    if (isRecord(generation?.reasoning) || isRecord(generation?.thinking))
        return "reasoning";
    if (typeof generation?.reasoningEffort === "string")
        return "reasoning";
    if (typeof generation?.reasoning_effort === "string")
        return "reasoning";
    const model = event.request.model.toLowerCase();
    if (model.startsWith("o") && /^o\d(?:-|$)/.test(model)) {
        return "reasoning";
    }
    if (model.includes("reasoning"))
        return "reasoning";
    return "non_reasoning";
}
function latencySelectionReason(event, interactionClass, reasoningClass) {
    const interactionReason = interactionClass === "batch"
        ? "batch selected from request workloadClass=batch"
        : hasPositiveStreamTimingEvidence(event)
            ? "interactive streaming selected from captured stream timing"
            : "interactive streaming inferred from default live bench traffic";
    const reasoningReason = reasoningClass === "reasoning"
        ? "reasoning selected from reasoning/thinking evidence"
        : "non-reasoning selected because no reasoning/thinking evidence was captured";
    return `${interactionReason}; ${reasoningReason}`;
}
function firstResultMsForEvent(event) {
    const timing = event.timing;
    return firstFiniteNumber(timing.timeToFirstContentDeltaMs, timing.timeToFirstTokenMs, timing.timeToFirstByteMs, timing.timeToFirstEventMs);
}
function hasPositiveStreamTimingEvidence(event) {
    const timing = event.timing;
    return Boolean((typeof timing.chunkCount === "number" && timing.chunkCount > 0) ||
        timing.firstEventAt ||
        timing.firstContentDeltaAt ||
        timing.lastChunkAt);
}
function usageCategoriesShowReasoning(event) {
    const categories = event.usage.categories;
    if (!Array.isArray(categories))
        return false;
    return categories.some((category) => {
        if (!category || typeof category !== "object")
            return false;
        const record = category;
        const tokens = typeof record.tokens === "number" ? record.tokens : 0;
        const categoryName = typeof record.category === "string" ? record.category : "";
        const sourceField = typeof record.sourceField === "string" ? record.sourceField : "";
        return tokens > 0 && (isReasoningCategory(categoryName) || isReasoningCategory(sourceField));
    });
}
function isReasoningCategory(value) {
    const normalized = value.toLowerCase();
    return normalized.includes("reasoning") ||
        normalized.includes("thinking") ||
        normalized.includes("hidden_output") ||
        normalized.includes("output_hidden");
}
function latencyDurationGrade(observedMs, goodMs, acceptableMs) {
    if (observedMs <= goodMs)
        return "good";
    if (observedMs <= acceptableMs)
        return "degraded";
    return "loss";
}
function latencyThroughputGrade(observedTokensPerSecond, goodTokensPerSecond, acceptableTokensPerSecond) {
    if (observedTokensPerSecond >= goodTokensPerSecond)
        return "good";
    if (observedTokensPerSecond >= acceptableTokensPerSecond)
        return "degraded";
    return "loss";
}
function firstFiniteNumber(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            return value;
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function roundUsd(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
//# sourceMappingURL=sla-defaults.js.map