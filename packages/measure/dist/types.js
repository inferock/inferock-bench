import { z } from "zod";
import { CanonicalProvider } from "./canonical-event.js";
export const LossSignalCode = z.enum([
    "BROKEN_OUTPUT",
    "TRUNCATED",
    "BILLED_EMPTY",
    "LATENCY_BILLED",
    "PROVIDER_DOWNTIME",
    "DUPLICATE_REQUEST_ID",
    "CACHE_RATE_ANOMALY",
    "CACHE_DISCOUNT_AT_RISK",
    "OPENAI_TOKEN_RECOUNT_MISMATCH",
    "ANTHROPIC_TOKEN_CROSSCHECK",
    "REFUSAL_BILLED",
    "REFUSAL_PREOUTPUT_BILLED_INVARIANT",
    "PRICING_UNKNOWN",
    "MALFORMED_TOOL_CALL",
    "TOOL_CALL_SCHEMA_VIOLATION",
    "UNDECLARED_TOOL_CALL",
    "TOOL_CHOICE_VIOLATION",
    "TOOL_CALL_STOP_REASON_MISMATCH",
    "SERVED_MODEL_MISMATCH",
    "SECURITY_SECRET_EXACT_MATCH",
    "SECURITY_PROVIDER_SAFETY_FIELD",
    "FACTUALITY_KNOWN_ANSWER_FAIL",
    "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT",
]);
export const DetectorName = z.enum([
    "broken-output",
    "billing-integrity",
    "latency",
    "availability",
    "refusal",
    "pricing",
    "model-identity",
    "tool-call-validity",
    "security-governance",
    "factuality-known-answer",
    "factuality-citation-support",
]);
export const SignalDomain = z.enum([
    "loss",
    "drift",
    "security",
    "factuality",
    "usage",
    "latency",
]);
export const SignalStatus = z.enum([
    "candidate",
    "accepted",
    "superseded",
    "informational",
    "triage_only",
    "pricing_unknown",
]);
export const EvidenceGrade = z.enum([
    "refundable_candidate",
    "unrecognized_standard_loss",
    "triage_only",
    "not_applicable",
]);
export const LiabilityParty = z.enum([
    "provider",
    "customer",
    "shared",
    "unknown",
    "not_applicable",
]);
export const SignalValueKind = z.enum([
    "money",
    "time_loss",
    "count",
    "security",
    "triage",
]);
export const SignalPricingStatus = z.enum([
    "not_priced",
    "priced",
    "pricing_unknown",
    "partial",
]);
export const RecoverableBasis = z.enum([
    "whole_call",
    "overcharge_delta",
]);
export const StandardLossStatus = z.enum([
    "computed",
    "pricing_unknown",
    "not_applicable",
    "legacy_pre_dollarcore",
]);
export const LossSignal = z
    .object({
    code: LossSignalCode,
    detector: DetectorName,
    detectorVersion: z.string().min(1),
    tenantId: z.string().min(1),
    requestId: z.string().min(1),
    provider: CanonicalProvider,
    model: z.string().min(1),
    domain: SignalDomain,
    failureClass: z.string().min(1).nullable(),
    status: SignalStatus,
    evidenceGrade: EvidenceGrade,
    severity: z.enum(["loss", "warning"]),
    dispute: z.boolean(),
    liabilityParty: LiabilityParty,
    creditCandidate: z.boolean(),
    valueKind: SignalValueKind,
    recoverableBasis: RecoverableBasis.nullable().optional(),
    tokensBilled: z.number().nonnegative(),
    tokensDelivered: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    observedChargeUsd: z.number().nonnegative().nullable().optional(),
    expectedChargeUsd: z.number().nonnegative().nullable().optional(),
    providerRecoverableLossUsd: z.number().nonnegative().nullable().optional(),
    standardLossUsd: z.number().nonnegative().nullable().optional(),
    providerRecognizedLossUsd: z.number().nonnegative().optional(),
    recognitionGapUsd: z.number().nonnegative().nullable().optional(),
    standardLossStatus: StandardLossStatus.optional(),
    standardLossMethod: z.string().min(1).nullable().optional(),
    standardLossGrade: EvidenceGrade.nullable().optional(),
    computationTrace: z.record(z.unknown()).nullable().optional(),
    pricingVersion: z.string().min(1).nullable().optional(),
    pricingStatus: SignalPricingStatus,
    valueJson: z.record(z.unknown()).optional(),
    evidence: z.record(z.unknown()),
})
    .strict();
//# sourceMappingURL=types.js.map