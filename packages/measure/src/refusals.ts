import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import { observedChargeUsdForEvent } from "./billing-integrity.js";
import { hasOutputSchema } from "./output-schemas.js";
import { roundUsd, tokensBilledForEvent } from "./pricing.js";
import {
  buildLossSignal,
  eventKey,
  providerSafetyForEvent,
  refundableCandidateEconomics,
} from "./signal.js";
import type { LossSignal } from "./types.js";

const REFUSAL_ACTION_PATTERN =
  "(?:assist|help|provide|complete|comply|fulfill|answer|continue|support)";
const OPTIONAL_REFUSAL_OPENING_PATTERN =
  String.raw`(?:(?:sorry|i(?:'|’)m sorry|i am sorry|apologies|no|unfortunately)[\s,.!-]*(?:but\s+)?)?`;
const AS_AI_PREFIX_PATTERN = String.raw`(?:as an ai(?: language model)?[\s,]+)?`;
const FIRST_PERSON_REFUSAL_PATTERN = [
  String.raw`i\s+(?:cannot|can't|can’t|won't|will not)\s+${REFUSAL_ACTION_PATTERN}\b`,
  String.raw`i\s+am\s+unable\s+to\s+${REFUSAL_ACTION_PATTERN}\b`,
  String.raw`i(?:'|’)?m\s+unable\s+to\s+${REFUSAL_ACTION_PATTERN}\b`,
].join("|");
const IMPERSONAL_REFUSAL_PATTERN =
  String.raw`(?:(?:cannot|can't|can’t)\s+(?:assist|help|provide|complete|comply|fulfill)\b|i\s+must\s+refuse\b)`;

// Regex-tier refusal matching stays deliberately narrow: answer-opening refusal
// shapes only. Provider-native safety fields and classifier verdicts are stronger tiers.
const REFUSAL_PATTERNS = [
  new RegExp(
    String.raw`^\s*${OPTIONAL_REFUSAL_OPENING_PATTERN}` +
      String.raw`${AS_AI_PREFIX_PATTERN}(?:${FIRST_PERSON_REFUSAL_PATTERN}|${IMPERSONAL_REFUSAL_PATTERN})`,
    "i",
  ),
];

export interface RefusalClassifierVerdict {
  readonly tenantId: string;
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly requestId: string;
  readonly isRefusal: boolean;
  readonly score: number;
  readonly model: "protectai/distilroberta-base-rejection-v1";
}

const classifierVerdicts = new Map<string, RefusalClassifierVerdict>();
const PROVIDER_REFUSAL_KINDS = new Set(["content_filter", "refusal"]);
const ANTHROPIC_REFUSAL_BILLING_DOC_URL =
  "https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback";
const CONTENT_FILTER_DETECTOR_NAME = "content-filter-omitted-output";
const CONTENT_FILTER_DETECTOR_VERSION = "v0";
const CONTENT_FILTER_BILLING_BASIS_LABEL = "UNVERIFIED" satisfies ContentFilterOmittedOutputBillingBasisLabel;

export const CONTENT_FILTER_OMITTED_OUTPUT_SIGNAL_CODES = [
  "OPENAI_CONTENT_FILTER_OMITTED_OUTPUT",
] as const;

export type ContentFilterOmittedOutputSignalCode =
  (typeof CONTENT_FILTER_OMITTED_OUTPUT_SIGNAL_CODES)[number];
export type ContentFilterOmittedOutputEvidenceGrade = "triage_only";
export type ContentFilterOmittedOutputSignalStatus = "triage_only";
export type ContentFilterOmittedOutputBillingBasisLabel = "UNVERIFIED";

export interface ContentFilterOmittedOutputSignal {
  readonly code: ContentFilterOmittedOutputSignalCode;
  readonly detectorName: typeof CONTENT_FILTER_DETECTOR_NAME;
  readonly detectorVersion: typeof CONTENT_FILTER_DETECTOR_VERSION;
  readonly tenantId: string;
  readonly requestId: string;
  readonly provider: "openai";
  readonly model: string;
  readonly status: ContentFilterOmittedOutputSignalStatus;
  readonly evidenceGrade: ContentFilterOmittedOutputEvidenceGrade;
  readonly dispute: false;
  readonly liabilityParty: "unknown";
  readonly creditCandidate: false;
  readonly fieldPath: string;
  readonly billingBasisLabel: ContentFilterOmittedOutputBillingBasisLabel;
  readonly evidence: Record<string, unknown>;
  readonly valueJson: Record<string, unknown>;
}

type ProviderSafetyEntry = NonNullable<CanonicalEventV2["response"]["providerSafety"]>[number];

interface ContentFilterEvidence {
  readonly fieldPath: string;
  readonly safetyKinds: readonly string[];
  readonly safetyReasons: readonly string[];
  readonly safetyFieldPaths: readonly string[];
}

export function registerRefusalClassifierVerdict(
  verdict: RefusalClassifierVerdict,
): void {
  classifierVerdicts.set(
    `${verdict.tenantId}:${verdict.provider}:${verdict.requestId}`,
    verdict,
  );
}

export function clearRefusalClassifierVerdicts(): void {
  classifierVerdicts.clear();
}

export interface ProviderRefusalEvidence {
  readonly tier: "provider_anthropic" | "provider_gemini" | "provider_openai";
  readonly safetyKinds: readonly string[];
  readonly safetyReasons: readonly string[];
  readonly safetyRaw: readonly unknown[];
}

interface ClassifierRefusalEvidence {
  readonly tier: "classifier";
  readonly source: "classifier";
  readonly mechanism: "regex" | "protectai";
  readonly score?: number;
  readonly model?: RefusalClassifierVerdict["model"];
}

interface RefusalStandardLossEligibility {
  readonly eligible: boolean;
  readonly reason: "classifier_refusal" | "task_contract_refusal" | "regex_only_triage";
  readonly taskContractEvidence?: Record<string, unknown>;
}

export interface ObservedChargeEvidence {
  readonly chargedUsd: number;
  readonly currency?: string;
  readonly source?: string;
  readonly observedAt?: string;
}

function providerRefusalTier(event: CanonicalEventV1): ProviderRefusalEvidence | null {
  const providerSafety = providerSafetyForEvent(event).filter((entry) =>
    entry.source === "provider" && PROVIDER_REFUSAL_KINDS.has(entry.kind)
  );
  const tier = providerRefusalEvidenceTier(event.request.provider);

  if (providerSafety.length > 0) {
    return {
      tier,
      safetyKinds: uniqueStrings(providerSafety.map((entry) => entry.kind)),
      safetyReasons: uniqueStrings(providerSafety.flatMap((entry) => entry.reason ? [entry.reason] : [])),
      safetyRaw: providerSafety.flatMap((entry) => entry.raw === undefined ? [] : [entry.raw]),
    };
  }

  if (
    event.request.provider === "anthropic" &&
    event.response.finishReason === "refusal"
  ) {
    return { tier, safetyKinds: ["refusal"], safetyReasons: ["refusal"], safetyRaw: [] };
  }

  if (
    event.request.provider === "openai" &&
    event.response.finishReason === "content_filter"
  ) {
    return {
      tier,
      safetyKinds: ["content_filter"],
      safetyReasons: ["content_filter"],
      safetyRaw: [],
    };
  }

  return null;
}

function providerRefusalEvidenceTier(
  provider: CanonicalEventV1["request"]["provider"],
): ProviderRefusalEvidence["tier"] {
  if (provider === "anthropic") return "provider_anthropic";
  if (provider === "gemini") return "provider_gemini";
  return "provider_openai";
}

export function regexRefusalTier(content: string): "regex" | null {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(content)) ? "regex" : null;
}

export function classifierRefusalTier(
  event: CanonicalEventV1,
): { tier: "classifier"; verdict: RefusalClassifierVerdict } | null {
  const verdict = classifierVerdicts.get(eventKey(event));
  if (!verdict?.isRefusal) return null;
  return { tier: "classifier", verdict };
}

function expectsCompletion(event: CanonicalEventV1): boolean {
  const outputSchemaVersion = event.meta.outputSchemaVersion;
  return event.request.expectCompletion === true ||
    (outputSchemaVersion
      ? hasOutputSchema(event.request.tenantId, outputSchemaVersion)
      : false);
}

function buildRefusalSignal(
  event: CanonicalEventV1,
  providerEvidence: ProviderRefusalEvidence | null,
  observedChargeUsd: number | null,
): LossSignal | null {
  const tokensBilled = tokensBilledForEvent(event);
  if (!providerEvidence || !expectsCompletion(event)) return null;

  if (observedChargeUsd !== null) {
    const invariant = buildAnthropicPreOutputRefusalBilledInvariantSignal(
      event,
      { chargedUsd: observedChargeUsd },
      providerEvidence,
    );
    if (invariant) return invariant;
  }

  if (tokensBilled === 0) return null;
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

function buildClassifierRefusalSignal(
  event: CanonicalEventV1,
  classifierEvidence: ClassifierRefusalEvidence | null,
): LossSignal | null {
  if (!classifierEvidence || !expectsCompletion(event)) return null;
  if (tokensBilledForEvent(event) === 0) return null;

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
        pricingStatus: "not_priced" as const,
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

function classifierRefusalStandardLossEligibility(
  event: CanonicalEventV1,
  classifierEvidence: ClassifierRefusalEvidence,
): RefusalStandardLossEligibility {
  if (classifierEvidence.mechanism !== "regex") {
    return { eligible: true, reason: "classifier_refusal" };
  }

  const taskContractEvidence = registeredOutputSchemaTaskContractEvidence(event);
  if (taskContractEvidence) {
    return { eligible: true, reason: "task_contract_refusal", taskContractEvidence };
  }

  return { eligible: false, reason: "regex_only_triage" };
}

function registeredOutputSchemaTaskContractEvidence(event: CanonicalEventV1): Record<string, unknown> | null {
  const outputSchemaVersion = event.meta.outputSchemaVersion;
  if (!outputSchemaVersion) return null;
  if (!hasOutputSchema(event.request.tenantId, outputSchemaVersion)) return null;
  return {
    kind: "registered_output_schema",
    outputSchemaVersion,
  };
}

export function buildAnthropicPreOutputRefusalBilledInvariantSignal(
  event: CanonicalEventV1,
  observedCharge: ObservedChargeEvidence,
  providerEvidence: ProviderRefusalEvidence | null = providerRefusalTier(event),
): LossSignal | null {
  if (!providerEvidence || !expectsCompletion(event)) return null;
  if (!isAnthropicPreOutputRefusal(event)) return null;
  if (observedCharge.chargedUsd <= 0) return null;

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

export function detectStatelessRefusal(event: CanonicalEventV1): LossSignal | null {
  return buildRefusalSignal(event, providerRefusalTier(event), null) ??
    buildClassifierRefusalSignal(event, classifierEvidenceForEvent(event));
}

export function detectRefusal(event: CanonicalEventV1): LossSignal | null {
  return buildRefusalSignal(event, providerRefusalTier(event), observedChargeUsdForEvent(event)) ??
    buildClassifierRefusalSignal(event, classifierEvidenceForEvent(event));
}

export function runContentFilterOmittedOutputDetectors(
  event: CanonicalEventV1,
): ContentFilterOmittedOutputSignal[] {
  const signal = detectOpenAiContentFilterOmittedOutput(event);
  return signal ? [signal] : [];
}

export function detectOpenAiContentFilterOmittedOutput(
  event: CanonicalEventV1,
): ContentFilterOmittedOutputSignal | null {
  if (event.request.provider !== "openai") return null;

  const contentFilterEvidence = contentFilterEvidenceForEvent(event);
  if (!contentFilterEvidence) return null;

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

export function isOpenAiContentFilterOnlyRefusalBilledSignal(
  signal: LossSignal,
): boolean {
  if (signal.code !== "REFUSAL_BILLED") return false;
  if (signal.provider !== "openai") return false;

  const providerSafetyKinds = stringArrayEvidence(signal.evidence.providerSafetyKinds);
  const hasContentFilter = providerSafetyKinds.includes("content_filter") ||
    signal.evidence.finishReason === "content_filter";
  const hasRefusal = providerSafetyKinds.includes("refusal");

  return hasContentFilter && !hasRefusal;
}

function contentFilterEvidenceForEvent(event: CanonicalEventV1): ContentFilterEvidence | null {
  const safetyEntries = providerSafetyForEvent(event).filter(isProviderContentFilterEntry);
  if (safetyEntries.length === 0 && event.response.finishReason !== "content_filter") return null;

  const safetyFieldPaths = uniqueStrings(safetyEntries.map(providerSafetyFieldPath));
  return {
    fieldPath: safetyFieldPaths[0] ?? "response.finishReason",
    safetyKinds: safetyEntries.length > 0 ? ["content_filter"] : [],
    safetyReasons: uniqueStrings(safetyEntries.flatMap((entry) => entry.reason ? [entry.reason] : [])),
    safetyFieldPaths,
  };
}

function isProviderContentFilterEntry(entry: ProviderSafetyEntry): boolean {
  return entry.source === "provider" && entry.kind === "content_filter";
}

function providerSafetyFieldPath(entry: ProviderSafetyEntry): string {
  if (isRecord(entry.raw) && typeof entry.raw.fieldPath === "string" && entry.raw.fieldPath.length > 0) {
    return entry.raw.fieldPath;
  }
  return "response.providerSafety";
}

function stringArrayEvidence(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isAnthropicRefusal(event: CanonicalEventV1): boolean {
  return event.request.provider === "anthropic" &&
    event.response.finishReason === "refusal";
}

function isAnthropicPreOutputRefusal(event: CanonicalEventV1): boolean {
  return isAnthropicRefusal(event) && event.response.content.trim().length === 0;
}

function classifierEvidenceForEvent(event: CanonicalEventV1): ClassifierRefusalEvidence | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
