import type { CanonicalEventV1 } from "./canonical-event.js";
export declare const RETRY_AMPLIFICATION_SIGNAL_CODES: readonly ["RETRY_AMPLIFICATION_IN_CALL", "RETRY_AMPLIFICATION_CHAIN"];
export type RetryAmplificationSignalCode = (typeof RETRY_AMPLIFICATION_SIGNAL_CODES)[number];
export type RetryAmplificationEvidenceGrade = "triage_only" | "unrecognized_standard_loss";
export type RetryAmplificationSignalStatus = "triage_only" | "candidate";
export type RetryAmplificationValueKind = "triage" | "money";
export type RetryAmplificationPricingStatus = "not_priced" | "priced" | "pricing_unknown" | "partial";
export type RetryAmplificationLinkageTier = "in_call_retry_evidence" | "stainless_retry_count" | "body_hash";
export type RetryAmplificationMethodGrade = "A" | "B";
export interface RetryAmplificationSignal {
    readonly code: RetryAmplificationSignalCode;
    readonly detectorName: typeof DETECTOR_NAME;
    readonly detectorVersion: typeof DETECTOR_VERSION;
    readonly tenantId: string;
    readonly requestId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly failureClass: "retry_amplification" | null;
    readonly status: RetryAmplificationSignalStatus;
    readonly evidenceGrade: RetryAmplificationEvidenceGrade;
    readonly dispute: false;
    readonly liabilityParty: "provider" | "unknown";
    readonly creditCandidate: false;
    readonly observedChargeUsd: null;
    readonly expectedChargeUsd: null;
    readonly providerRecoverableLossUsd: 0;
    readonly pricingVersion: string | null;
    readonly pricingStatus: RetryAmplificationPricingStatus;
    readonly recoverableBasis: null;
    readonly valueKind: RetryAmplificationValueKind;
    readonly standardLossUsd: number | null;
    readonly providerRecognizedLossUsd: 0;
    readonly recognitionGapUsd: number | null;
    readonly standardLossStatus: "computed" | "not_applicable";
    readonly standardLossMethod: "call_cost_floor_v1" | null;
    readonly standardLossGrade: RetryAmplificationEvidenceGrade | null;
    readonly computationTrace: Record<string, unknown> | null;
    readonly valueJson: Record<string, unknown>;
    readonly evidence: Record<string, unknown>;
}
export interface RetryAmplificationChainContext {
    readonly linkageTier: Extract<RetryAmplificationLinkageTier, "stainless_retry_count" | "body_hash">;
    readonly chainSize: number;
    readonly inducedEventCount: number;
    readonly inducedRank: number;
    readonly originalEventId: string;
    readonly originalEventTime: string;
    readonly originalRequestId: string;
    readonly inducedEventId: string;
    readonly inducedEventTime: string;
    readonly chainStartAt: string;
    readonly chainEndAt: string;
    readonly chainEventIds: readonly string[];
    readonly chainRequestIds: readonly string[];
    readonly listPriceInducedSpendUsd: number | null;
    readonly listPricePricingStatus: RetryAmplificationPricingStatus;
    readonly pricingVersion?: string | null;
    readonly providerDirected: boolean;
    readonly providerDirectedReasons: readonly string[];
    readonly methodGrade?: RetryAmplificationMethodGrade;
    readonly apiKeyHash?: string | null;
    readonly retryCountSequence?: readonly (number | null)[];
    readonly extraAttemptEventCount?: number;
    readonly extraAttemptSpendUsd?: number | null;
    readonly providerFaultExtraAttemptSpendUsd?: number | null;
    readonly providerFaultStatus?: number | "timeout";
    readonly providerFaultReason?: string;
    readonly finalEventId?: string;
    readonly finalEventTime?: string;
    readonly finalRequestId?: string;
}
export interface ListPriceEvidence {
    readonly usd: number | null;
    readonly pricingStatus: RetryAmplificationPricingStatus;
    readonly pricingVersion: string | null;
}
interface ProviderDirectedEvidence {
    readonly providerDirected: boolean;
    readonly reasons: readonly string[];
    readonly retryHeaders: Record<string, string>;
    readonly retryStatusCodes: readonly number[];
}
declare const DETECTOR_NAME: "retry-amplification";
declare const DETECTOR_VERSION: "v0";
/**
 * @contract-id loss-detectors-v1
 */
export declare function runRetryAmplificationDetectors(event: CanonicalEventV1): RetryAmplificationSignal[];
export declare function buildRetryAmplificationChainSignal(event: CanonicalEventV1, context: RetryAmplificationChainContext): RetryAmplificationSignal;
export declare function listPriceEvidenceForEvent(event: CanonicalEventV1): ListPriceEvidence;
export declare function sumListPriceEvidence(events: readonly CanonicalEventV1[]): ListPriceEvidence;
export declare function providerDirectedRetryEvidenceForEvent(event: CanonicalEventV1): ProviderDirectedEvidence;
export declare function retryCountForEvent(event: CanonicalEventV1): number | null;
export declare function providerFaultStatusForRetryDollarization(event: CanonicalEventV1): {
    readonly providerFault: true;
    readonly status: number | "timeout";
    readonly reason: string;
} | null;
export {};
//# sourceMappingURL=retry-amplification.d.ts.map