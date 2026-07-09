import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
import { CLAUDE_TOKENIZER_ESTIMATOR, CLAUDE_TOKENIZER_LICENSE, CLAUDE_TOKENIZER_REVISION, CLAUDE_TOKENIZER_SOURCE_URL } from "./anthropic-local-tokenizer.js";
export { estimateAnthropicOfflineOutputTokens } from "./anthropic-local-tokenizer.js";
export declare const ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID = "anthropic_count_tokens_recount_v1";
export declare const ANTHROPIC_COUNT_TOKENS_DOCS_URL = "https://platform.claude.com/docs/en/build-with-claude/token-counting";
export declare const ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT = "Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.";
export declare const ANTHROPIC_TOKEN_CROSSCHECK_NOTE = "Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release. Evidence is capped at provider-assisted grade B; unverified calibration remains gross-bound triage only.";
export declare const ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER = 6;
export declare const ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS = 16;
export declare const ANTHROPIC_TOKEN_CALIBRATION_DEFAULT_MIN_SAMPLES = 8;
type CalibrationStatus = "verified" | "unverified";
export interface AnthropicCountTokensRecount {
    readonly outputTokens: number;
    readonly source?: string;
}
export interface AnthropicTokenCalibrationProvenance {
    readonly source: "runtime_count_tokens";
    readonly countTokensSource: string;
    readonly localEstimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
    readonly localEstimatorRevision: typeof CLAUDE_TOKENIZER_REVISION;
    readonly localEstimatorSourceUrl?: typeof CLAUDE_TOKENIZER_SOURCE_URL;
    readonly localEstimatorLicense?: typeof CLAUDE_TOKENIZER_LICENSE;
    readonly countTokensDocsUrl?: typeof ANTHROPIC_COUNT_TOKENS_DOCS_URL;
    readonly updatedAt: string;
}
export interface AnthropicTokenCalibration {
    readonly model: string;
    readonly status: CalibrationStatus;
    readonly sampleCount: number;
    readonly minSampleCount: number;
    readonly ratio?: number;
    readonly overheadTokens?: number;
    readonly toleranceTokens?: number;
    readonly provenance: AnthropicTokenCalibrationProvenance;
}
export interface AddAnthropicTokenCalibrationSampleInput {
    readonly model: string;
    readonly deliveredOutputContent: string;
    readonly billedVisibleOutputTokens: number;
    readonly countedOutputTokens: number;
    readonly countTokensSource: string;
    readonly observedAt?: string;
}
export interface AnthropicTokenCalibrationCache {
    addCountTokensSample(input: AddAnthropicTokenCalibrationSampleInput): AnthropicTokenCalibration;
    calibrationForModel(model: string): AnthropicTokenCalibration;
    reset(): void;
}
export interface AnthropicTokenCalibrationCacheOptions {
    readonly minSampleCount?: number;
}
export interface AnthropicTokenCrossCheckOptions {
    readonly countTokens?: AnthropicCountTokensRecount | null;
    readonly calibration?: AnthropicTokenCalibration | null;
    readonly fallbackReason?: string;
}
interface AnthropicTokenMethodMetadata {
    readonly methodId: typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID;
    readonly evidenceGradeCap: "B";
    readonly evidenceGradeCapReason: "provider_assisted_recount";
    readonly recountOracle: "anthropic.messages.count_tokens";
    readonly recountOracleDocsUrl: typeof ANTHROPIC_COUNT_TOKENS_DOCS_URL;
    readonly localEstimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
    readonly localEstimatorUrl: typeof CLAUDE_TOKENIZER_SOURCE_URL;
    readonly localEstimatorRevision: typeof CLAUDE_TOKENIZER_REVISION;
    readonly localEstimatorLicense: typeof CLAUDE_TOKENIZER_LICENSE;
    readonly caveat: typeof ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT;
}
export interface AnthropicTokenCrossCheck {
    readonly provider: "anthropic";
    readonly mode: "count_tokens_recount" | "fallback_safe_bound";
    readonly methodId?: typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID;
    readonly methodMetadata?: AnthropicTokenMethodMetadata;
    readonly billedOutputTokens: number;
    readonly thinkingTokens: number;
    readonly billedVisibleOutputTokens: number;
    readonly responseChars: number;
    readonly outputTokenUpperBound: number;
    readonly countedOutputTokens?: number;
    readonly countTokensSource?: string;
    readonly calibrationStatus?: CalibrationStatus;
    readonly calibration?: AnthropicTokenCalibration;
    readonly overheadTokens?: number;
    readonly toleranceTokens?: number;
    readonly recountedVisibleOutputTokens?: number;
    readonly billedVsRecountDeltaTokens?: number;
    readonly overBilledOutputTokens: number;
    readonly outputRateUsdPerMillion?: number;
    readonly overchargeUsd?: number;
    readonly expectedChargeUsd?: number | null;
    readonly observedChargeUsd?: number | null;
    readonly pricingVersion?: string | null;
    readonly pricingStatus: "priced" | "pricing_unknown" | "partial" | "not_priced";
    readonly boundMultiplier: number;
    readonly fallbackOverheadTokens?: typeof ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;
    readonly fallbackReason?: string;
    readonly overBoundTokens: number;
    readonly withinBound: boolean;
    readonly disputeEligible: false;
    readonly evidenceGradeCap?: "B";
    readonly caveat: typeof ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT;
    readonly note: typeof ANTHROPIC_TOKEN_CROSSCHECK_NOTE;
}
export declare function createAnthropicTokenCalibrationCache(options?: AnthropicTokenCalibrationCacheOptions): AnthropicTokenCalibrationCache;
/**
 * @contract-id loss-detectors-v1
 */
export declare function crossCheckAnthropicOutputTokens(event: CanonicalEventV1, options?: AnthropicTokenCrossCheckOptions): AnthropicTokenCrossCheck;
export declare function billedVisibleAnthropicOutputTokens(event: CanonicalEventV1): number;
/**
 * @contract-id loss-detectors-v1
 */
export declare function buildAnthropicTokenCrossCheckSignal(event: CanonicalEventV1, crossCheck: AnthropicTokenCrossCheck): LossSignal | null;
//# sourceMappingURL=anthropic-token-crosscheck.d.ts.map