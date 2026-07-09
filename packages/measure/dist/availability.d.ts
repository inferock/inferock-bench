import type { CanonicalEventV1 } from "./canonical-event.js";
import { TIME_LOSS_METHOD_DOWNTIME_WINDOW } from "./time-loss.js";
import type { LossSignal } from "./types.js";
export interface DowntimeClassification {
    readonly reason: string;
    readonly branch: string;
    readonly ownership: "provider" | "ambiguous";
    readonly triageReason?: string;
    readonly failureClass?: "downtime" | null;
}
export type DowntimeWindowEvidenceGrade = "claim_grade_provider_sla" | "status_corroborated_observed" | "organic_strong" | "organic_sparse";
export interface DowntimeWindow {
    readonly timeLossMethodId: typeof TIME_LOSS_METHOD_DOWNTIME_WINDOW;
    readonly timeLossKind: "downtime_unavailable_window";
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly windowDurationMs: number;
    readonly timeLossMs: number;
    readonly windowSource: "passive_window";
    readonly windowConfidence: "claim_grade" | "observed_traffic_window";
    readonly tenantId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly route: string | null;
    readonly serviceTier: string | null;
    readonly region: string | null;
    readonly eligibleOperationCount: number;
    readonly providerOwnedFailureOperationCount: number;
    readonly providerFaultRate: number;
    readonly threshold: number;
    readonly thresholdSource: string;
    readonly thresholdSourceLabel: string;
    readonly thresholdSourceRefs: readonly string[];
    readonly creditTermsVerified: boolean;
    readonly evidenceGrade: DowntimeWindowEvidenceGrade;
    readonly lastGoodBefore: string | null;
    readonly firstGoodAfter: string | null;
    readonly uncertaintyEnvelopeMs: number | null;
    readonly sparseTraffic: boolean;
    readonly statusFeedCorroborated: boolean;
    readonly providerRecognizedTimeLossMs: 0;
    readonly recognitionGapTimeMs: number;
}
export interface DowntimeWindowOptions {
    readonly rollingWindowMs?: number;
    readonly stepMs?: number;
    readonly defaultProviderFaultRateThreshold?: number;
}
export declare function classifyProviderDowntime(event: CanonicalEventV1): DowntimeClassification | null;
export declare function isProviderDowntimeEvent(event: CanonicalEventV1): boolean;
export declare function detectProviderDowntime(event: CanonicalEventV1): LossSignal | null;
export declare function identifyDowntimeWindows(events: readonly CanonicalEventV1[], options?: DowntimeWindowOptions): DowntimeWindow[];
//# sourceMappingURL=availability.d.ts.map