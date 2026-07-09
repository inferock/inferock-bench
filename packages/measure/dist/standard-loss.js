import { ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID } from "./anthropic-token-crosscheck.js";
import { lookupPriceForEvent, roundUsd, tokensBilledForEvent, } from "./pricing.js";
import { SLA_DEFAULTS } from "./sla-defaults.js";
export const STANDARD_LOSS_METHOD_VERSION = "dollarcore-2026-07-04";
const WHOLE_CALL_FLOOR_PRIORITY = {
    PROVIDER_DOWNTIME: 600,
    REFUSAL_PREOUTPUT_BILLED_INVARIANT: 525,
    REFUSAL_BILLED: 500,
    FACTUALITY_KNOWN_ANSWER_FAIL: 475,
    ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT: 475,
    SECURITY_SECRET_EXACT_MATCH: 470,
    SERVED_MODEL_MISMATCH: 450,
    TRUNCATED: 400,
    TOOL_CHOICE_VIOLATION: 360,
    UNDECLARED_TOOL_CALL: 350,
    TOOL_CALL_STOP_REASON_MISMATCH: 340,
    TOOL_CALL_SCHEMA_VIOLATION: 330,
    MALFORMED_TOOL_CALL: 320,
    BROKEN_OUTPUT: 300,
    BILLED_EMPTY: 250,
    DUPLICATE_REQUEST_ID: 200,
};
const WHOLE_CALL_FLOOR_PEER_SIGNAL_CODES = new Set([
    "ANTHROPIC_TOKEN_CROSSCHECK",
]);
const DELTA_SIGNAL_CODES = new Set([
    "OPENAI_TOKEN_RECOUNT_MISMATCH",
    "ANTHROPIC_TOKEN_CROSSCHECK",
    "CACHE_RATE_ANOMALY",
    "CACHE_DISCOUNT_AT_RISK",
]);
export function applyStandardLossEconomicsToSignals(event, signals) {
    if (signals.length === 0)
        return [];
    const price = lookupPriceForEvent(event);
    const floorCandidates = signals.filter(isWholeCallFloorCandidate);
    const floorWinner = selectWholeCallFloorWinner(floorCandidates);
    return signals.map((signal) => standardLossSignalForInput(signal, {
        event,
        price,
        floorWinner,
        hasFloorCandidates: floorCandidates.length > 0,
    }));
}
function standardLossSignalForInput(signal, context) {
    if (signal.standardLossStatus && signal.computationTrace)
        return signal;
    const deltaUsd = measureSpecificDeltaUsd(signal);
    if (deltaUsd !== null) {
        return withComputedStandardLoss(signal, context.event, context.price, {
            method: deltaStandardLossMethod(signal),
            basis: deltaBasis(signal),
            basisDetail: deltaBasisDetail(signal),
            standardLossUsd: deltaUsd,
            providerRecognizedLossUsd: providerRecognizedUsd(signal, deltaUsd),
            grade: gradeForComputedLoss(signal, deltaUsd),
            confidence: "computed_measure_delta",
            extraInputs: deltaTraceInputs(signal),
            extraSourceRefs: deltaTraceSourceRefs(signal),
        });
    }
    if (isPricingUnknownDeltaCandidate(signal)) {
        return withPricingUnknownStandardLoss(signal, context.event, context.price);
    }
    if (isWholeCallFloorCandidate(signal)) {
        if (!isFullyPriced(context.price)) {
            return withPricingUnknownStandardLoss(signal, context.event, context.price);
        }
        if (signal !== context.floorWinner) {
            return withSupersededFloorTrace(signal, context.event, context.price, context.floorWinner);
        }
        const standardLossUsd = context.price.expectedChargeUsd;
        return withComputedStandardLoss(signal, context.event, context.price, {
            method: "call_cost_floor_v1",
            basis: "failed_to_deliver_usable_output",
            basisDetail: wholeCallFloorBasisDetail(signal),
            standardLossUsd,
            providerRecognizedLossUsd: providerRecognizedUsd(signal, standardLossUsd),
            grade: gradeForComputedLoss(signal, standardLossUsd),
            confidence: "priced_call_cost_floor",
        });
    }
    if (context.hasFloorCandidates && isWholeCallFloorPeerSignal(signal)) {
        return withSupersededFloorTrace(signal, context.event, context.price, context.floorWinner);
    }
    if (signal.severity === "loss" && signal.failureClass !== null && !context.hasFloorCandidates) {
        return withNotApplicableStandardTrace(signal, context.event, context.price);
    }
    return withNotApplicableStandardTrace(signal, context.event, context.price);
}
function withComputedStandardLoss(signal, event, price, input) {
    const standardLossUsd = roundUsd(input.standardLossUsd);
    const providerRecognizedLossUsd = roundUsd(Math.min(input.providerRecognizedLossUsd, standardLossUsd));
    const recognitionGapUsd = roundUsd(standardLossUsd - providerRecognizedLossUsd);
    const preservedOneLine = input.method === "measure_specific_delta_v1"
        ? existingTraceOneLine(signal)
        : null;
    const timeLossTrace = existingTimeLossTrace(signal);
    const trace = {
        ...computationTrace(event, price, {
            method: input.method,
            basis: input.basis,
            basisDetail: input.basisDetail,
            grade: input.grade,
            confidence: input.confidence,
            standardLossUsd,
            providerRecognizedLossUsd,
            recognitionGapUsd,
            extraInputs: input.extraInputs,
            extraSourceRefs: input.extraSourceRefs,
        }),
        ...(preservedOneLine
            ? { oneLine: preservedOneLine }
            : {}),
        ...(timeLossTrace ? { timeLossTrace } : {}),
    };
    return withStandardFields(signal, {
        status: "computed",
        method: input.method,
        grade: input.grade,
        standardLossUsd,
        providerRecognizedLossUsd,
        recognitionGapUsd,
        trace,
    });
}
function withSupersededFloorTrace(signal, event, price, winner) {
    const trace = computationTrace(event, price, {
        method: "call_cost_floor_superseded_v1",
        basis: "failed_to_deliver_usable_output",
        basisDetail: wholeCallFloorBasisDetail(signal),
        grade: signal.evidenceGrade,
        confidence: "floor_attributed_to_peer_signal",
        standardLossUsd: 0,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0,
        extraInputs: {
            floorAttributedToSignalCode: winner?.code ?? null,
            floorSupersessionReason: "one_call_cost_floor_per_call",
        },
    });
    return withStandardFields(signal, {
        status: "computed",
        method: "call_cost_floor_superseded_v1",
        grade: signal.evidenceGrade,
        standardLossUsd: 0,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0,
        trace,
    });
}
function withPricingUnknownStandardLoss(signal, event, price) {
    const trace = computationTrace(event, price, {
        method: "pricing_unknown_v1",
        basis: "pricing_unknown_add_model_price",
        basisDetail: "pricing_unknown_add_model_price",
        grade: signal.evidenceGrade,
        confidence: "pricing_unknown",
        standardLossUsd: null,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: null,
    });
    return withStandardFields(signal, {
        status: "pricing_unknown",
        method: "pricing_unknown_v1",
        grade: signal.evidenceGrade,
        standardLossUsd: null,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: null,
        trace,
        pricingStatus: price.ok ? signal.pricingStatus : "pricing_unknown",
    });
}
function withNotApplicableStandardTrace(signal, event, price) {
    const trace = computationTrace(event, price, {
        method: "not_applicable_v1",
        basis: "not_standard_loss",
        basisDetail: "not_standard_loss",
        grade: signal.evidenceGrade,
        confidence: "not_applicable",
        standardLossUsd: 0,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0,
    });
    return withStandardFields(signal, {
        status: "not_applicable",
        method: "not_applicable_v1",
        grade: signal.evidenceGrade,
        standardLossUsd: 0,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0,
        trace,
    });
}
function withStandardFields(signal, input) {
    const carriesNonzeroLoss = (input.standardLossUsd ?? 0) > 0;
    const evidenceGrade = carriesNonzeroLoss && signal.evidenceGrade === "triage_only"
        ? "unrecognized_standard_loss"
        : signal.evidenceGrade;
    const status = carriesNonzeroLoss && signal.status === "triage_only" ? "candidate" : signal.status;
    const valueKind = carriesNonzeroLoss && signal.valueKind === "triage" ? "money" : signal.valueKind;
    return {
        ...signal,
        status,
        evidenceGrade,
        valueKind,
        standardLossUsd: input.standardLossUsd,
        providerRecognizedLossUsd: input.providerRecognizedLossUsd,
        recognitionGapUsd: input.recognitionGapUsd,
        standardLossStatus: input.status,
        standardLossMethod: input.method,
        standardLossGrade: carriesNonzeroLoss && input.grade === "triage_only"
            ? "unrecognized_standard_loss"
            : input.grade,
        computationTrace: input.trace,
        pricingStatus: input.pricingStatus ?? signal.pricingStatus,
        valueJson: {
            ...(signal.valueJson ?? {}),
            standardLossStatus: input.status,
            standardLossMethod: input.method,
            standardLossGrade: carriesNonzeroLoss && input.grade === "triage_only"
                ? "unrecognized_standard_loss"
                : input.grade,
            standardLossUsd: input.standardLossUsd,
            providerRecognizedLossUsd: input.providerRecognizedLossUsd,
            recognitionGapUsd: input.recognitionGapUsd,
        },
        evidence: withoutComputationTrace(signal.evidence),
    };
}
function computationTrace(event, price, input) {
    return {
        method: input.method,
        methodId: input.method,
        methodVersion: STANDARD_LOSS_METHOD_VERSION,
        standardVersion: SLA_DEFAULTS.standardVersion,
        basis: input.basis,
        basisDetail: input.basisDetail,
        grade: input.grade,
        confidence: input.confidence,
        inputs: {
            requestId: event.request.requestId,
            provider: event.request.provider,
            model: event.request.model,
            billedTokens: tokensBilledForEvent(event),
            pricing: pricingInputs(price),
            providerRecognizedLossUsd: input.providerRecognizedLossUsd,
            ...(input.extraInputs ?? {}),
        },
        formulas: formulasForMethod(input.method),
        outputs: {
            standardLossUsd: input.standardLossUsd,
            providerRecognizedLossUsd: input.providerRecognizedLossUsd,
            recognitionGapUsd: input.recognitionGapUsd,
        },
        sourceRefs: {
            pricing: ["@inferock/measure/pricing"],
            standard: [SLA_DEFAULTS.standardVersion],
            standardLossMethodVersion: STANDARD_LOSS_METHOD_VERSION,
            ...(input.extraSourceRefs ?? {}),
        },
        oneLine: oneLine(input),
    };
}
function formulasForMethod(method) {
    if (method === "call_cost_floor_v1") {
        return {
            standardLossUsd: "sum(priced billed token categories)",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
        };
    }
    if (method === "call_cost_floor_superseded_v1") {
        return {
            standardLossUsd: "0 for this signal because this call's floor is attributed to one peer signal",
            recognitionGapUsd: "0 for this signal; see peer call_cost_floor_v1 trace",
        };
    }
    if (method === "measure_specific_delta_v1") {
        return {
            standardLossUsd: "detector-computed delta amount",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
        };
    }
    if (method === "cache_discount_at_risk_v1") {
        return {
            standardLossUsd: "cacheReadTokens * (fullInputRateUsdPerMillion - cacheReadRateUsdPerMillion) / 1000000",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
        };
    }
    if (method === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID) {
        return {
            billedVisibleOutputTokens: "usage.output_tokens - output_tokens_details.thinking_tokens",
            recountedVisibleOutputTokens: "messages.count_tokens(delivered assistant output) - runtime_calibrated_overhead(model)",
            standardLossUsd: "overBilledOutputTokens * outputRateUsdPerMillion / 1000000",
            recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
        };
    }
    if (method === "pricing_unknown_v1") {
        return {
            standardLossUsd: "pricing unknown until model price is added",
            recognitionGapUsd: "pricing unknown until model price is added",
        };
    }
    return {
        standardLossUsd: "not a standard-loss dollar input",
        recognitionGapUsd: "not a standard-loss dollar input",
    };
}
function oneLine(input) {
    if (input.method === "pricing_unknown_v1") {
        return "pricing unknown — add model price";
    }
    if (input.method === "call_cost_floor_superseded_v1") {
        return "call-cost floor already attributed once for this call";
    }
    if (input.method === "not_applicable_v1") {
        return "not a standard-loss dollar input";
    }
    if (input.method === "cache_discount_at_risk_v1") {
        const standard = input.standardLossUsd ?? 0;
        const gap = input.recognitionGapUsd ?? 0;
        return `cache discount at risk — verify your invoice: standard loss $${standard.toFixed(2)}; provider-recognized $${input.providerRecognizedLossUsd.toFixed(2)} -> $${gap.toFixed(2)} recognition gap`;
    }
    if (input.method === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID) {
        const standard = input.standardLossUsd ?? 0;
        const gap = input.recognitionGapUsd ?? 0;
        return `Anthropic count_tokens provider-assisted grade B recount: standard loss $${standard.toFixed(2)}; provider-recognized $${input.providerRecognizedLossUsd.toFixed(2)} -> $${gap.toFixed(2)} recognition gap`;
    }
    const standard = input.standardLossUsd ?? 0;
    const gap = input.recognitionGapUsd ?? 0;
    return `standard loss $${standard.toFixed(2)}; provider-recognized $${input.providerRecognizedLossUsd.toFixed(2)} -> $${gap.toFixed(2)} recognition gap`;
}
function pricingInputs(price) {
    if (!price.ok) {
        return {
            status: "pricing_unknown",
            reason: price.reason,
            provider: price.provider,
            model: price.model,
            usageCategories: price.usageCategories,
        };
    }
    return {
        status: price.pricingStatus,
        pricingVersion: price.pricingVersion,
        source: price.source,
        currency: price.currency,
        expectedChargeUsd: price.expectedChargeUsd,
        components: price.components.map(pricingComponentInput),
    };
}
function pricingComponentInput(component) {
    return {
        category: component.category,
        quantity: component.quantity,
        unit: component.unit,
        rateUsdPerMillion: component.rateUsdPerMillion,
        chargeUsd: component.chargeUsd,
        pricingStatus: component.pricingStatus,
        formula: component.rateUsdPerMillion === null
            ? "pricing unknown"
            : "quantity * rateUsdPerMillion / 1000000",
    };
}
function isFullyPriced(price) {
    return price.ok && price.pricingStatus === "priced";
}
function isWholeCallFloorCandidate(signal) {
    if (signal.severity !== "loss")
        return false;
    if (signal.failureClass === null)
        return false;
    if (measureSpecificDeltaUsd(signal) !== null)
        return false;
    return wholeCallFloorPriority(signal.code) > 0;
}
function isWholeCallFloorPeerSignal(signal) {
    if (signal.severity !== "loss")
        return false;
    if (signal.failureClass === null)
        return false;
    if (measureSpecificDeltaUsd(signal) !== null)
        return false;
    return WHOLE_CALL_FLOOR_PEER_SIGNAL_CODES.has(signal.code);
}
function isPricingUnknownDeltaCandidate(signal) {
    return signal.severity === "loss" &&
        signal.failureClass !== null &&
        DELTA_SIGNAL_CODES.has(signal.code) &&
        (signal.status === "pricing_unknown" ||
            signal.pricingStatus === "pricing_unknown" ||
            signal.pricingStatus === "partial");
}
function selectWholeCallFloorWinner(signals) {
    let winner = null;
    for (const signal of signals) {
        if (!winner || wholeCallFloorPriority(signal.code) > wholeCallFloorPriority(winner.code)) {
            winner = signal;
        }
    }
    return winner;
}
function wholeCallFloorPriority(code) {
    return WHOLE_CALL_FLOOR_PRIORITY[code] ?? 0;
}
function measureSpecificDeltaUsd(signal) {
    const explicitStandardLoss = numericValue(signal.valueJson?.standardLossUsd);
    if (signal.code === "LATENCY_BILLED") {
        if (explicitStandardLoss !== null)
            return positiveOrZero(explicitStandardLoss);
        return isPositive(signal.providerRecoverableLossUsd) ? signal.providerRecoverableLossUsd : null;
    }
    if (signal.code === "SERVED_MODEL_MISMATCH") {
        if (isPositive(explicitStandardLoss))
            return explicitStandardLoss;
        return isPositive(signal.providerRecoverableLossUsd) && signal.recoverableBasis === "overcharge_delta"
            ? signal.providerRecoverableLossUsd
            : null;
    }
    if (DELTA_SIGNAL_CODES.has(signal.code)) {
        return positiveOrZero(explicitStandardLoss ??
            numericValue(signal.valueJson?.cacheDiscountAtRiskUsd) ??
            numericValue(signal.valueJson?.overchargeUsd) ??
            signal.providerRecoverableLossUsd ??
            null);
    }
    return null;
}
function deltaBasis(signal) {
    if (signal.code === "LATENCY_BILLED")
        return "latency_time_excess";
    if (signal.code === "SERVED_MODEL_MISMATCH")
        return "served_model_overcharge_delta";
    if (signal.code === "CACHE_DISCOUNT_AT_RISK")
        return "cache_discount_at_risk";
    if (signal.code === "CACHE_RATE_ANOMALY")
        return "cache_overcharge_delta";
    return "token_overcharge_delta";
}
function deltaBasisDetail(signal) {
    if (signal.code === "LATENCY_BILLED")
        return "delivered_call_time_excess";
    if (signal.code === "SERVED_MODEL_MISMATCH")
        return "served_model_overcharge_delta";
    if (signal.code === "CACHE_DISCOUNT_AT_RISK")
        return "cache_discount_at_risk_verify_invoice";
    if (signal.code === "CACHE_RATE_ANOMALY")
        return "cache_rate_overcharge_delta";
    if (signal.code === "ANTHROPIC_TOKEN_CROSSCHECK")
        return "anthropic_count_tokens_recount_overcharge_delta";
    return "token_overcharge_delta";
}
function deltaStandardLossMethod(signal) {
    if (signal.code === "CACHE_DISCOUNT_AT_RISK")
        return "cache_discount_at_risk_v1";
    return signal.code === "ANTHROPIC_TOKEN_CROSSCHECK" &&
        signal.valueJson?.methodId === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
        ? ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
        : "measure_specific_delta_v1";
}
function deltaTraceInputs(signal) {
    const methodMetadata = methodMetadataForSignal(signal);
    if (!methodMetadata)
        return undefined;
    return { methodMetadata };
}
function deltaTraceSourceRefs(signal) {
    const methodMetadata = methodMetadataForSignal(signal);
    if (!methodMetadata)
        return undefined;
    const sourceRefs = recordValue(methodMetadata.sourceRefs) ?? {
        recountOracle: methodMetadata.recountOracleDocsUrl,
        localEstimator: methodMetadata.localEstimatorUrl,
    };
    return { methodMetadata: sourceRefs };
}
function methodMetadataForSignal(signal) {
    return recordValue(signal.valueJson?.methodMetadata) ??
        recordValue(signal.evidence.methodMetadata);
}
function wholeCallFloorBasisDetail(signal) {
    switch (signal.code) {
        case "REFUSAL_BILLED":
        case "REFUSAL_PREOUTPUT_BILLED_INVARIANT":
            return "refused";
        case "BROKEN_OUTPUT":
        case "TRUNCATED":
        case "BILLED_EMPTY":
        case "MALFORMED_TOOL_CALL":
        case "TOOL_CALL_SCHEMA_VIOLATION":
        case "UNDECLARED_TOOL_CALL":
        case "TOOL_CHOICE_VIOLATION":
        case "TOOL_CALL_STOP_REASON_MISMATCH":
            return "broken_invalid_or_unusable_output";
        case "DUPLICATE_REQUEST_ID":
            return "duplicate";
        case "SERVED_MODEL_MISMATCH":
            return "served_wrong_model";
        case "PROVIDER_DOWNTIME":
            return "downtime_with_no_output";
        case "FACTUALITY_KNOWN_ANSWER_FAIL":
        case "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT":
            return "factuality_contradiction";
        case "SECURITY_SECRET_EXACT_MATCH":
            return "security_secret_leak";
        case "ANTHROPIC_TOKEN_CROSSCHECK":
            return "billing_integrity_crosscheck_on_failed_call_floor_attributed_to_peer";
        default:
            return "failed_to_deliver_usable_output";
    }
}
function gradeForComputedLoss(signal, standardLossUsd) {
    if (standardLossUsd <= 0)
        return signal.evidenceGrade;
    return signal.evidenceGrade === "refundable_candidate"
        ? "refundable_candidate"
        : "unrecognized_standard_loss";
}
function providerRecognizedUsd(signal, standardLossUsd) {
    if (!isPositive(signal.providerRecoverableLossUsd))
        return 0;
    return roundUsd(Math.min(signal.providerRecoverableLossUsd, standardLossUsd));
}
function withoutComputationTrace(evidence) {
    if (!Object.prototype.hasOwnProperty.call(evidence, "computationTrace"))
        return evidence;
    const { computationTrace: _computationTrace, ...rest } = evidence;
    return rest;
}
function existingTraceOneLine(signal) {
    const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
    const oneLine = trace?.oneLine;
    return typeof oneLine === "string" && oneLine.trim().length > 0 ? oneLine : null;
}
function existingTimeLossTrace(signal) {
    const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
    return recordValue(signal.valueJson?.timeLossTrace) ??
        recordValue(signal.evidence.timeLossTrace) ??
        recordValue(trace?.timeLossTrace);
}
function recordValue(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function numericValue(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function positiveOrZero(value) {
    return value === null ? null : roundUsd(value);
}
function isPositive(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
//# sourceMappingURL=standard-loss.js.map