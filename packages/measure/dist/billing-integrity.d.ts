import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export declare const GEMINI_COUNT_TOKENS_RECOUNT_METHOD_ID = "gemini_count_tokens_input_recount_v1";
export declare const GEMINI_COUNT_TOKENS_ORACLE = "gemini.models.countTokens";
export declare const GEMINI_COUNT_TOKENS_BILLING_STATUS = "UNVERIFIED";
export interface RegisterObservedChargeInput {
    readonly tenantId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly requestId: string;
    readonly chargedUsd: number;
}
export interface DuplicateRequestIdEvidence {
    readonly originalEventId?: string;
    readonly originalEventTime?: string;
    readonly duplicateEventId?: string;
    readonly duplicateEventTime?: string;
    readonly duplicateRank?: number;
    readonly duplicateCount?: number;
}
export interface CacheObservedCharge {
    readonly chargedUsd: number;
    readonly currency?: string;
    readonly source?: string;
    readonly observedAt?: string;
    readonly dashboardEligible?: boolean;
}
export interface GeminiCountTokensRecount {
    readonly totalTokens: number;
    readonly source?: typeof GEMINI_COUNT_TOKENS_ORACLE;
}
export interface GeminiCountTokensRecountEvidence {
    readonly provider: "gemini";
    readonly mode: "count_tokens_input_recount";
    readonly methodId: typeof GEMINI_COUNT_TOKENS_RECOUNT_METHOD_ID;
    readonly oracle: typeof GEMINI_COUNT_TOKENS_ORACLE;
    readonly evidenceGrade: "B";
    readonly billingStatus: typeof GEMINI_COUNT_TOKENS_BILLING_STATUS;
    readonly countedInputTokens: number;
    readonly usagePromptTokenCount: number;
    readonly cachedContentTokenCount: number;
    readonly toolUsePromptTokenCount: number;
    readonly promptDeltaTokens: number;
    readonly comparedFields: readonly string[];
    readonly note: string;
}
export declare function resetBillingIntegrityState(): void;
/**
 * @deprecated Process-local observed charge state is for legacy unit tests only.
 * Production cache reconciliation must use durable billing_charge_observations.
 */
export declare function registerObservedCharge(input: RegisterObservedChargeInput): void;
export declare function observedChargeUsdForEvent(event: CanonicalEventV1): number | null;
export declare function buildGeminiCountTokensRecountEvidence(event: CanonicalEventV1, recount: GeminiCountTokensRecount): GeminiCountTokensRecountEvidence | null;
export declare function countOpenAiOutputTokens(model: string, content: string): number;
export declare function buildDuplicateRequestIdSignal(event: CanonicalEventV1, duplicateEvidence?: DuplicateRequestIdEvidence): LossSignal;
export declare function buildCacheDiscountAtRiskSignal(event: CanonicalEventV1): LossSignal | null;
export declare function buildCacheRateAnomalySignal(event: CanonicalEventV1, observedCharge: number | CacheObservedCharge): LossSignal | null;
export declare function hasCacheBilledUsage(event: CanonicalEventV1): boolean;
export declare function detectOpenAiTokenRecount(event: CanonicalEventV1): LossSignal | null;
export declare function detectBillingIntegrity(event: CanonicalEventV1): LossSignal | null;
//# sourceMappingURL=billing-integrity.d.ts.map