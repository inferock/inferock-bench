import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import { LossSignal, type DetectorName, type EvidenceGrade, type LiabilityParty, type LossSignalCode, type RecoverableBasis, type SignalDomain, type SignalPricingStatus, type SignalStatus, type SignalValueKind } from "./types.js";
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
export interface RefundableCandidateEconomics {
    readonly status: SignalStatus;
    readonly evidenceGrade: EvidenceGrade;
    readonly creditCandidate: true;
    readonly expectedChargeUsd: number | null;
    readonly providerRecoverableLossUsd: number | null;
    readonly pricingVersion: string | null;
    readonly pricingStatus: SignalPricingStatus;
}
export declare function buildLossSignal(input: BuildLossSignalInput): LossSignal;
export declare function refundableCandidateEconomics(event: CanonicalEventV1): RefundableCandidateEconomics;
export declare function eventKey(event: CanonicalEventV1): string;
export declare function providerSafetyForEvent(event: CanonicalEventV1): ProviderSafety;
export declare function billedEmptyEvidence(event: CanonicalEventV1): Record<string, unknown>;
export declare function isBilledButEmpty(event: CanonicalEventV1): boolean;
export declare function hasProviderNativeRefusalOrContentFilter(event: CanonicalEventV1): boolean;
export {};
//# sourceMappingURL=signal.d.ts.map