import type { CanonicalEventV1 } from "./canonical-event.js";
export type LatencyInteractionClass = "interactive_streaming" | "batch";
export type LatencyReasoningClass = "reasoning" | "non_reasoning";
export type LatencyDefaultTimingAttribution = "provider_elapsed" | "gateway_total_elapsed";
export type LatencySegmentId = "interactive_streaming_non_reasoning" | "interactive_streaming_reasoning" | "batch_non_reasoning" | "batch_reasoning";
export type LatencyMetricGrade = "good" | "degraded" | "loss" | "not_exercised";
export interface LatencySegmentSelection {
    readonly segmentId: LatencySegmentId;
    readonly interactionClass: LatencyInteractionClass;
    readonly reasoningClass: LatencyReasoningClass;
    readonly label: string;
    readonly selectionReason: string;
}
export interface LatencyDefaultThresholds {
    readonly goodStartMs: number;
    readonly acceptableStartMs: number;
    readonly goodOutputTokensPerSecond: number;
    readonly acceptableOutputTokensPerSecond: number;
    readonly goodMsPerOutputToken: number;
    readonly acceptableMsPerOutputToken: number;
}
export interface LatencyDefaultEvaluation {
    readonly exercised: boolean;
    readonly segment: LatencySegmentSelection;
    readonly thresholds: LatencyDefaultThresholds;
    readonly observed: {
        readonly totalMs: number;
        readonly timingAttribution: LatencyDefaultTimingAttribution;
        readonly clockLabel: "provider-clock" | "gateway-clock";
        readonly gatewayTotalMs: number;
        readonly providerElapsedMs: number | null;
        readonly gatewayOverheadMs: number | null;
        readonly openRouterEvidenceFetchMs: number | null;
        readonly nonProviderDiagnosticSegments: readonly LatencyDiagnosticSegment[];
        readonly firstResultMs: number | null;
        readonly outputTokens: number;
        readonly outputTokensPerSecond: number | null;
    };
    readonly acceptableTotalMs: number;
    readonly goodTotalMs: number;
    readonly excessMs: number;
    readonly standardLossUsd: number;
    readonly metricGrades: {
        readonly firstResult: LatencyMetricGrade;
        readonly outputThroughput: LatencyMetricGrade;
        readonly total: LatencyMetricGrade;
    };
    readonly notExercisedLabel?: string;
}
export interface LatencyDiagnosticSegment {
    readonly segmentId: "gateway_overhead" | "openrouter_endpoint_evidence_fetch";
    readonly elapsedMs: number;
    readonly providerAttributed: false;
}
export declare const SLA_DEFAULTS: {
    readonly standardVersion: "sla-defaults-2026-07-20-maintainer-signed";
    readonly signoff: {
        readonly signedOffBy: "Inferock maintainers";
        readonly signedOffAt: "2026-07-20";
        readonly numbersShipAs: "maintainer-signed provisional default";
    };
    readonly evidenceGrades: {
        readonly unrecognizedStandardLoss: "standard-defined loss, not provider-confirmed (owed by Inferock Standard; not yet credited by a provider)";
    };
    readonly timeValueRate: {
        readonly usdPerHour: 92;
        readonly currency: "USD";
        readonly unit: "hour";
        readonly label: "Inferock DEFAULT ASSUMPTION - not customer-confirmed, not provider-confirmed loss (default — override)";
        readonly oneLineWhy: "BLS median software developer wage, loaded by BLS private-industry benefit share.";
        readonly sourceIds: readonly ["BLS-OOH", "BLS-OEWS-2080", "BLS-ECEC"];
        readonly sourceNote: "This default is the Inferock proposed time-value assumption, computed from BLS software-developer wage data and BLS private-industry benefit share (`BLS-OOH`, `BLS-OEWS-2080`, `BLS-ECEC`). It is not customer-confirmed and not provider-confirmed. Receipts must preserve the override key `time_value_usd_per_hour` so customers can replace it with their own loaded rate or set it to zero.";
        readonly signoffRequired: false;
        readonly overrideKey: "time_value_usd_per_hour";
        readonly excessOnly: true;
    };
    readonly latencySegments: {
        readonly interactive_streaming_non_reasoning: {
            readonly label: "interactive streaming / non-reasoning (default — override)";
            readonly interactionClass: "interactive_streaming";
            readonly reasoningClass: "non_reasoning";
            readonly thresholds: {
                readonly goodStartMs: 1000;
                readonly acceptableStartMs: 10000;
                readonly goodOutputTokensPerSecond: 50;
                readonly acceptableOutputTokensPerSecond: 44;
                readonly goodMsPerOutputToken: 20;
                readonly acceptableMsPerOutputToken: 23;
            };
            readonly oneLineWhy: "Nielsen 1s/10s response-time limits plus OpenAI/Azure/Bedrock published TPS anchors.";
            readonly sourceIds: readonly ["UX-NIELSEN", "OPENAI-SCALE", "AZURE-PRIORITY", "BEDROCK-OTPS"];
            readonly overrideKey: "latency.interactive_streaming.non_reasoning";
        };
        readonly interactive_streaming_reasoning: {
            readonly label: "interactive streaming / reasoning (default — override)";
            readonly interactionClass: "interactive_streaming";
            readonly reasoningClass: "reasoning";
            readonly thresholds: {
                readonly goodStartMs: 10000;
                readonly acceptableStartMs: 500000;
                readonly goodOutputTokensPerSecond: 50;
                readonly acceptableOutputTokensPerSecond: 44;
                readonly goodMsPerOutputToken: 20;
                readonly acceptableMsPerOutputToken: 23;
            };
            readonly oneLineWhy: "Reasoning allowance from OpenAI 25,000-token experimentation reserve divided by the 50 TPS anchor.";
            readonly sourceIds: readonly ["UX-NIELSEN", "OPENAI-REASONING", "OPENAI-REASONING-BEST", "ANTHROPIC-THINKING", "ANTHROPIC-CONTEXT", "OPENAI-SCALE", "AZURE-PRIORITY"];
            readonly overrideKey: "latency.interactive_streaming.reasoning";
        };
        readonly batch_non_reasoning: {
            readonly label: "batch / non-reasoning (default — override)";
            readonly interactionClass: "batch";
            readonly reasoningClass: "non_reasoning";
            readonly thresholds: {
                readonly goodStartMs: 30000;
                readonly acceptableStartMs: 3600000;
                readonly goodOutputTokensPerSecond: 50;
                readonly acceptableOutputTokensPerSecond: 44;
                readonly goodMsPerOutputToken: 20;
                readonly acceptableMsPerOutputToken: 23;
            };
            readonly oneLineWhy: "Current local 30s non-interactive good boundary plus Anthropic batch typical-completion boundary.";
            readonly sourceIds: readonly ["LOCAL-LATENCY", "ANTHROPIC-BATCH", "OPENAI-SCALE", "AZURE-PRIORITY"];
            readonly overrideKey: "latency.batch.non_reasoning";
        };
        readonly batch_reasoning: {
            readonly label: "batch / reasoning (default — override)";
            readonly interactionClass: "batch";
            readonly reasoningClass: "reasoning";
            readonly thresholds: {
                readonly goodStartMs: 500000;
                readonly acceptableStartMs: 3600000;
                readonly goodOutputTokensPerSecond: 50;
                readonly acceptableOutputTokensPerSecond: 44;
                readonly goodMsPerOutputToken: 20;
                readonly acceptableMsPerOutputToken: 23;
            };
            readonly oneLineWhy: "Reasoning reserve good boundary plus Anthropic batch typical-completion acceptable boundary.";
            readonly sourceIds: readonly ["OPENAI-REASONING", "ANTHROPIC-BATCH", "OPENAI-SCALE", "AZURE-PRIORITY"];
            readonly overrideKey: "latency.batch.reasoning";
        };
    };
    readonly renderCopy: {
        readonly latencyTimingMissing: "not exercised by this traffic: no latency timing captured";
        readonly noJsonSchemaContract: "not exercised by this traffic: no JSON/schema output contract";
        readonly openAiRecountNotEligible: "not exercised by this traffic: not eligible for OpenAI visible-output recount";
        readonly anthropicCrosscheckNotEligible: "not exercised by this traffic: no Anthropic output-token traffic for recount cross-check";
        readonly duplicateEvidenceAbsent: "not exercised by this traffic: no duplicate request-ID evidence";
        readonly cacheChargeObservationMissing: "not exercised by this traffic: no provider charge observation for cache reconciliation";
        readonly driftBaselineMissing: "not exercised by this traffic: no approved drift baseline or replay contract";
        readonly toolTrafficMissing: "not exercised by this traffic: no tool-call traffic";
        readonly securityEvidenceMissing: "not exercised by this traffic: no security evidence source captured";
        readonly factualityContractMissing: "not exercised by this traffic: no factuality contract captured";
        readonly contentFilterMissing: "not exercised by this traffic: no provider content-filter event";
        readonly notStreaming: "not exercised by this traffic: not a streaming request";
        readonly streamTerminalEvidenceMissing: "not exercised by this traffic: stream request without terminal evidence";
        readonly retryEvidenceMissing: "not exercised by this traffic: no retry evidence captured";
        readonly servedModelEvidenceMissing: "not exercised by this traffic: no provider-response served-model evidence";
    };
    readonly measureDefaultPolicies: {
        readonly brokenOutputJsonMode: "JSON mode defaults to must be parseable JSON.";
        readonly anthropicTokenCrosscheck: "Anthropic output token cross-check uses the calibrated count_tokens recount when verified, otherwise the conservative gross-bound fallback. Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.";
        readonly duplicateRequestId: "Bench groups events by tenant/provider/request ID for duplicate evidence.";
        readonly latency: "Bench applies the segmented Inferock default latency standard to every timed call.";
        readonly securityGovernance: "Bench surfaces provider safety and exact secret evidence as evidence-only overlays.";
        readonly contentFilter: "Bench surfaces provider content-filter evidence as an evidence-only overlay.";
        readonly streamTermination: "Bench surfaces stream terminal-state anomalies as evidence-only overlays.";
        readonly retryAmplification: "Bench surfaces captured retry evidence as an evidence-only overlay.";
        readonly servedModelMismatch: "Bench surfaces provider-response served-model mismatches as identity triage unless billing evidence proves an overcharge delta.";
    };
    readonly sourceRegister: {
        readonly "UX-NIELSEN": "Nielsen Norman Group response-time limits: 0.1s, 1s, 10s.";
        readonly "OPENAI-SCALE": "OpenAI Scale Tier published TPS latency anchors.";
        readonly "OPENAI-PRIORITY": "OpenAI Priority Processing enterprise SLA guidance.";
        readonly "OPENAI-REASONING": "OpenAI reasoning-token guidance and 25,000 generated-token reserve.";
        readonly "OPENAI-REASONING-BEST": "OpenAI reasoning best-practice speed/cost positioning.";
        readonly "AZURE-PRIORITY": "Azure OpenAI priority processing TPS targets.";
        readonly "AZURE-LATENCY": "Azure OpenAI latency metric formula.";
        readonly "AZURE-METRICS": "Azure OpenAI TTFT/TBT/TTLB/TPS metrics.";
        readonly "BEDROCK-METRICS": "Amazon Bedrock runtime latency and token metrics.";
        readonly "BEDROCK-OTPS": "Amazon Bedrock OTPS p50 and 80% alarm-threshold example.";
        readonly "ANTHROPIC-THINKING": "Anthropic extended-thinking behavior.";
        readonly "ANTHROPIC-CONTEXT": "Anthropic thinking tokens and context accounting.";
        readonly "ANTHROPIC-BATCH": "Anthropic batch completion and expiry windows.";
        readonly "LOCAL-LATENCY": "Inferock provisional default (pending external calibration).";
        readonly "BLS-OOH": "BLS May 2024 software developer median annual wage.";
        readonly "BLS-OEWS-2080": "BLS 2,080-hour annual wage conversion.";
        readonly "BLS-ECEC": "BLS private-industry wage and benefit share.";
    };
};
export declare const SLA_STANDARD_VERSION: "sla-defaults-2026-07-20-maintainer-signed";
export declare const DEFAULT_TIME_VALUE_USD_PER_HOUR: 92;
export declare const UNRECOGNIZED_STANDARD_LOSS_EVIDENCE_GRADE = "unrecognized_standard_loss";
export declare function selectDefaultLatencySegment(event: CanonicalEventV1): LatencySegmentSelection;
export declare function evaluateDefaultLatency(event: CanonicalEventV1): LatencyDefaultEvaluation;
//# sourceMappingURL=sla-defaults.d.ts.map