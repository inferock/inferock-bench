import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import { lookupPriceForEvent, tokensBilledForEvent } from "./pricing.js";
import {
  LossSignal,
  type DetectorName,
  type EvidenceGrade,
  type LiabilityParty,
  type LossSignalCode,
  type RecoverableBasis,
  type SignalDomain,
  type SignalPricingStatus,
  type SignalStatus,
  type SignalValueKind,
} from "./types.js";
import { isHiddenOutputUsageCategory } from "./usage-categories.js";

interface BuildLossSignalInput {
  readonly code: LossSignalCode;
  readonly detector: DetectorName;
  readonly detectorVersion?: string;
  readonly event: CanonicalEventV1;
  readonly domain?: SignalDomain;
  readonly failureClass: string | null;
  readonly status?: SignalStatus;
  readonly evidenceGrade?: EvidenceGrade;
  readonly evidence: Record<string, unknown>;
  readonly severity?: "loss" | "warning";
  readonly dispute?: boolean;
  readonly liabilityParty?: LiabilityParty;
  readonly creditCandidate?: boolean;
  readonly valueKind?: SignalValueKind;
  readonly recoverableBasis?: RecoverableBasis | null;
  readonly tokensDelivered?: number;
  readonly observedChargeUsd?: number | null;
  readonly expectedChargeUsd?: number | null;
  readonly providerRecoverableLossUsd?: number | null;
  readonly pricingVersion?: string | null;
  readonly pricingStatus?: SignalPricingStatus;
  readonly valueJson?: Record<string, unknown>;
}

type ProviderSafety = NonNullable<CanonicalEventV2["response"]["providerSafety"]>;
type UsageCategory = NonNullable<CanonicalEventV2["usage"]["categories"]>[number];

interface EventWithProviderSafety {
  readonly response: {
    readonly providerSafety?: ProviderSafety;
  };
}

interface EventWithUsageCategories {
  readonly usage: CanonicalEventV1["usage"] & {
    readonly categories?: readonly UsageCategory[];
  };
}

export interface RefundableCandidateEconomics {
  readonly status: SignalStatus;
  readonly evidenceGrade: EvidenceGrade;
  readonly creditCandidate: true;
  readonly expectedChargeUsd: number | null;
  readonly providerRecoverableLossUsd: number | null;
  readonly pricingVersion: string | null;
  readonly pricingStatus: SignalPricingStatus;
}

const BILLED_EMPTY_EXCLUDED_FINISH_REASONS = new Set([
  "content_filter",
  "function_call",
  "malformed_function_call",
  "missing_thought_signature",
  "refusal",
  "tool_calls",
  "too_many_tool_calls",
  "unexpected_tool_call",
]);

const BILLED_EMPTY_EXCLUDED_SAFETY_KINDS = new Set([
  "content_filter",
  "moderation",
  "refusal",
  "safety",
]);

const PROVIDER_NATIVE_REFUSAL_OR_FILTER_KINDS = new Set([
  "content_filter",
  "refusal",
]);

export function buildLossSignal(input: BuildLossSignalInput): LossSignal {
  const priceLookup = lookupPriceForEvent(input.event);
  const inferredPricingStatus = priceLookup.ok ? priceLookup.pricingStatus : "pricing_unknown";
  const inferredPricingVersion = priceLookup.ok ? priceLookup.pricingVersion : null;
  const inferredCostUsd = priceLookup.ok ? priceLookup.expectedChargeUsd : 0;
  return LossSignal.parse({
    code: input.code,
    detector: input.detector,
    detectorVersion: input.detectorVersion ?? "v1",
    tenantId: input.event.request.tenantId,
    requestId: input.event.request.requestId,
    provider: input.event.request.provider,
    model: input.event.request.model,
    domain: input.domain ?? defaultDomain(input.code),
    failureClass: input.failureClass,
    status: input.status ?? "candidate",
    evidenceGrade: input.evidenceGrade ?? "triage_only",
    severity: input.severity ?? "loss",
    dispute: input.dispute ?? true,
    liabilityParty: input.liabilityParty ?? "provider",
    creditCandidate: input.creditCandidate ?? false,
    valueKind: input.valueKind ?? defaultValueKind(input.code),
    recoverableBasis: input.recoverableBasis === undefined
      ? defaultRecoverableBasis(input.code)
      : input.recoverableBasis,
    tokensBilled: tokensBilledForEvent(input.event),
    tokensDelivered: input.tokensDelivered ?? 0,
    costUsd: inferredCostUsd,
    observedChargeUsd: input.observedChargeUsd,
    expectedChargeUsd: input.expectedChargeUsd,
    providerRecoverableLossUsd: input.providerRecoverableLossUsd,
    pricingVersion: input.pricingVersion === undefined
      ? inferredPricingVersion
      : input.pricingVersion,
    pricingStatus: input.pricingStatus ?? inferredPricingStatus,
    valueJson: input.valueJson,
    evidence: input.evidence,
  });
}

export function refundableCandidateEconomics(
  event: CanonicalEventV1,
): RefundableCandidateEconomics {
  const priceLookup = lookupPriceForEvent(event);
  if (!priceLookup.ok) {
    return {
      status: "pricing_unknown",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      expectedChargeUsd: null,
      providerRecoverableLossUsd: null,
      pricingVersion: null,
      pricingStatus: "pricing_unknown",
    };
  }

  if (priceLookup.pricingStatus === "partial") {
    return {
      status: "pricing_unknown",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      expectedChargeUsd: priceLookup.expectedChargeUsd,
      providerRecoverableLossUsd: null,
      pricingVersion: priceLookup.pricingVersion,
      pricingStatus: "partial",
    };
  }

  return {
    status: "candidate",
    evidenceGrade: "refundable_candidate",
    creditCandidate: true,
    expectedChargeUsd: priceLookup.expectedChargeUsd,
    providerRecoverableLossUsd: priceLookup.expectedChargeUsd,
    pricingVersion: priceLookup.pricingVersion,
    pricingStatus: "priced",
  };
}

function defaultDomain(code: LossSignalCode): SignalDomain {
  switch (code) {
    case "LATENCY_BILLED":
      return "latency";
    case "CACHE_RATE_ANOMALY":
    case "CACHE_DISCOUNT_AT_RISK":
    case "DUPLICATE_REQUEST_ID":
    case "OPENAI_TOKEN_RECOUNT_MISMATCH":
    case "ANTHROPIC_TOKEN_CROSSCHECK":
    case "PRICING_UNKNOWN":
    case "SERVED_MODEL_MISMATCH":
      return "usage";
    case "SECURITY_SECRET_EXACT_MATCH":
    case "SECURITY_PROVIDER_SAFETY_FIELD":
      return "security";
    case "FACTUALITY_KNOWN_ANSWER_FAIL":
    case "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT":
      return "factuality";
    default:
      return "loss";
  }
}

function defaultValueKind(code: LossSignalCode): SignalValueKind {
  if (code === "SECURITY_PROVIDER_SAFETY_FIELD") return "security";
  if (code === "SERVED_MODEL_MISMATCH") return "triage";
  if (code === "PRICING_UNKNOWN") return "triage";
  return code === "LATENCY_BILLED" ? "time_loss" : "money";
}

function defaultRecoverableBasis(code: LossSignalCode): RecoverableBasis | null {
  switch (code) {
    case "BROKEN_OUTPUT":
    case "TRUNCATED":
    case "BILLED_EMPTY":
    case "REFUSAL_BILLED":
    case "REFUSAL_PREOUTPUT_BILLED_INVARIANT":
    case "PROVIDER_DOWNTIME":
    case "MALFORMED_TOOL_CALL":
    case "TOOL_CALL_SCHEMA_VIOLATION":
    case "UNDECLARED_TOOL_CALL":
    case "TOOL_CHOICE_VIOLATION":
    case "TOOL_CALL_STOP_REASON_MISMATCH":
    case "SECURITY_SECRET_EXACT_MATCH":
    case "FACTUALITY_KNOWN_ANSWER_FAIL":
    case "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT":
      return "whole_call";
    case "CACHE_RATE_ANOMALY":
    case "CACHE_DISCOUNT_AT_RISK":
    case "DUPLICATE_REQUEST_ID":
    case "OPENAI_TOKEN_RECOUNT_MISMATCH":
    case "ANTHROPIC_TOKEN_CROSSCHECK":
      return "overcharge_delta";
    default:
      return null;
  }
}

export function eventKey(event: CanonicalEventV1): string {
  return `${event.request.tenantId}:${event.request.provider}:${event.request.requestId}`;
}

export function providerSafetyForEvent(event: CanonicalEventV1): ProviderSafety {
  const eventWithSafety = event as CanonicalEventV1 & EventWithProviderSafety;
  return eventWithSafety.response.providerSafety ?? [];
}

export function billedEmptyEvidence(event: CanonicalEventV1): Record<string, unknown> {
  return {
    reason: "billable output tokens exist and response.content is empty",
    provider: event.request.provider,
    finishReason: event.response.finishReason,
    outputTokens: event.usage.output,
    geminiThinkingTokens: pricedGeminiThinkingTokensForEvent(event),
    hiddenOutputTokens: hiddenOutputTokensForEvent(event),
    ...(event.request.provider === "anthropic" && event.response.finishReason === "end_turn"
      ? {
          documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons",
          documentedAnthropicCase: "empty end_turn can return 2-3 output tokens with no content",
        }
      : {}),
  };
}

export function isBilledButEmpty(event: CanonicalEventV1): boolean {
  const pricedGeminiThinkingTokens = pricedGeminiThinkingTokensForEvent(event);
  return (event.usage.output > 0 || pricedGeminiThinkingTokens > 0) &&
    event.request.expectCompletion !== false &&
    event.response.content.trim().length === 0 &&
    (hiddenOutputTokensForEvent(event) === 0 ||
      (event.request.provider === "gemini" && pricedGeminiThinkingTokens > 0)) &&
    !hasToolCalls(event) &&
    !BILLED_EMPTY_EXCLUDED_FINISH_REASONS.has(event.response.finishReason) &&
    !hasProviderSafety(event);
}

export function hasProviderNativeRefusalOrContentFilter(event: CanonicalEventV1): boolean {
  return providerSafetyForEvent(event).some((entry) =>
    entry.source === "provider" &&
    PROVIDER_NATIVE_REFUSAL_OR_FILTER_KINDS.has(entry.kind)
  );
}

function hasToolCalls(event: CanonicalEventV1): boolean {
  return (event.response.toolCalls?.length ?? 0) > 0;
}

function hasProviderSafety(event: CanonicalEventV1): boolean {
  return providerSafetyForEvent(event).some((entry) =>
    BILLED_EMPTY_EXCLUDED_SAFETY_KINDS.has(entry.kind)
  );
}

function hiddenOutputTokensForEvent(event: CanonicalEventV1): number {
  return ((event as CanonicalEventV1 & EventWithUsageCategories).usage.categories ?? [])
    .filter((category) => isHiddenOutputUsageCategory(category.category))
    .reduce((total, category) => total + category.tokens, 0);
}

function pricedGeminiThinkingTokensForEvent(event: CanonicalEventV1): number {
  if (event.request.provider !== "gemini") return 0;
  return ((event as CanonicalEventV1 & EventWithUsageCategories).usage.categories ?? [])
    .filter((category) => category.category === "gemini_thinking")
    .reduce((total, category) => total + category.tokens, 0);
}
