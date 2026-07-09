import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export interface RefusalClassifierVerdict {
    readonly tenantId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly requestId: string;
    readonly isRefusal: boolean;
    readonly score: number;
    readonly model: "protectai/distilroberta-base-rejection-v1";
}
declare const CONTENT_FILTER_DETECTOR_NAME = "content-filter-omitted-output";
declare const CONTENT_FILTER_DETECTOR_VERSION = "v0";
export declare const CONTENT_FILTER_OMITTED_OUTPUT_SIGNAL_CODES: readonly ["OPENAI_CONTENT_FILTER_OMITTED_OUTPUT"];
export type ContentFilterOmittedOutputSignalCode = (typeof CONTENT_FILTER_OMITTED_OUTPUT_SIGNAL_CODES)[number];
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
export declare function registerRefusalClassifierVerdict(verdict: RefusalClassifierVerdict): void;
export declare function clearRefusalClassifierVerdicts(): void;
export interface ProviderRefusalEvidence {
    readonly tier: "provider_anthropic" | "provider_gemini" | "provider_openai";
    readonly safetyKinds: readonly string[];
    readonly safetyReasons: readonly string[];
    readonly safetyRaw: readonly unknown[];
}
export interface ObservedChargeEvidence {
    readonly chargedUsd: number;
    readonly currency?: string;
    readonly source?: string;
    readonly observedAt?: string;
}
export declare function regexRefusalTier(content: string): "regex" | null;
export declare function classifierRefusalTier(event: CanonicalEventV1): {
    tier: "classifier";
    verdict: RefusalClassifierVerdict;
} | null;
export declare function buildAnthropicPreOutputRefusalBilledInvariantSignal(event: CanonicalEventV1, observedCharge: ObservedChargeEvidence, providerEvidence?: ProviderRefusalEvidence | null): LossSignal | null;
export declare function detectStatelessRefusal(event: CanonicalEventV1): LossSignal | null;
export declare function detectRefusal(event: CanonicalEventV1): LossSignal | null;
export declare function runContentFilterOmittedOutputDetectors(event: CanonicalEventV1): ContentFilterOmittedOutputSignal[];
export declare function detectOpenAiContentFilterOmittedOutput(event: CanonicalEventV1): ContentFilterOmittedOutputSignal | null;
export declare function isOpenAiContentFilterOnlyRefusalBilledSignal(signal: LossSignal): boolean;
export {};
//# sourceMappingURL=refusals.d.ts.map