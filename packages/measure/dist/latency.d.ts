import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export declare const DEFAULT_LATENCY_THRESHOLD_MS = 30000;
export declare const DEFAULT_LATENCY_IMPACT_TPS_FLOOR = 5;
export declare const LATENCY_PERCENTILE_BUCKETS: readonly ["p50_or_below", "p50_p75", "p75_p90", "p90_p95", "p95_p99", "p99_plus"];
export type LatencySloCreditBasis = "billed_wait";
export type LatencyPercentileBucket = (typeof LATENCY_PERCENTILE_BUCKETS)[number];
export type LatencyReasoningSegment = "reasoning" | "non_reasoning";
export interface LatencyImpactUsageCategory {
    readonly category: string;
    readonly tokens: number;
    readonly sourceField?: string;
}
export interface NoSloLatencyImpactSample {
    readonly sampleId?: string;
    readonly tenantId: string;
    readonly requestId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly route?: string | null;
    readonly workloadClass?: string | null;
    readonly latencyMs: number;
    readonly outputTokens: number;
    readonly usageCategories?: readonly LatencyImpactUsageCategory[];
}
export interface NoSloLatencyImpactOptions {
    readonly minimumOutputTokensPerSecond?: number;
    readonly impactBuckets?: readonly LatencyPercentileBucket[];
}
export interface OutputBearingTpsInput {
    readonly latencyMs: number;
    readonly outputTokens: number;
    readonly minimumOutputTokensPerSecond?: number;
}
export interface NoSloLatencyImpactClassification extends NoSloLatencyImpactSample {
    readonly reasoningSegment: LatencyReasoningSegment;
    readonly partitionKey: string;
    readonly percentileRank: number;
    readonly bucket: LatencyPercentileBucket;
    readonly outputTokensPerSecond: number | null;
    readonly outputTpsFloorMet: boolean;
    readonly impactEligible: boolean;
    readonly timeLossMs: number;
}
export interface LatencySloPolicy {
    readonly policyId: string;
    readonly tenantId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string | null;
    readonly route: string | null;
    readonly workloadClass: string | null;
    readonly totalSloMs: number;
    readonly sloSource: string;
    readonly sloVersion: string;
    readonly disclosedAt: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly creditBasis: LatencySloCreditBasis | null;
    readonly inferockStandardDefault?: boolean;
}
export interface LatencyDetectorOptions {
    readonly latencySloPolicy?: LatencySloPolicy | null;
}
export interface LatencyTimeLossRepriceInput {
    readonly observedMs: number;
    readonly outputTokens: number;
    readonly acceptableStartMs: number;
    readonly acceptableMsPerOutputToken: number;
    readonly rateUsdPerHour: number;
}
export interface LatencyTimeLossRepriceResult {
    readonly acceptableTotalMs: number;
    readonly timeLossMs: number;
    readonly dollarTranslationUsd: number;
}
export declare function latencyPercentileBucket(percentileRank: number): LatencyPercentileBucket;
export declare function outputBearingCallMeetsTpsFloor(input: OutputBearingTpsInput): boolean;
export declare function recomputeLatencyTimeLoss(input: LatencyTimeLossRepriceInput): LatencyTimeLossRepriceResult;
export declare function latencyReasoningSegmentForUsageCategories(categories?: readonly LatencyImpactUsageCategory[]): LatencyReasoningSegment;
export declare function classifyNoSloLatencyImpact(samples: readonly NoSloLatencyImpactSample[], options?: NoSloLatencyImpactOptions): NoSloLatencyImpactClassification[];
export declare function detectLatencyBilled(event: CanonicalEventV1, options?: LatencyDetectorOptions): LossSignal | null;
export declare function defaultLatencySloPolicyForEvent(event: CanonicalEventV1): LatencySloPolicy;
//# sourceMappingURL=latency.d.ts.map