import type { CanonicalEventV1 } from "./canonical-event.js";
export declare const FACTUALITY_SIGNAL_CODES: readonly ["FACTUALITY_KNOWN_ANSWER_FAIL", "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT"];
export type FactualitySignalCode = (typeof FACTUALITY_SIGNAL_CODES)[number];
export type FactualityMatchType = "exact" | "numeric" | "date" | "entity";
type FactualityDetectorName = typeof KNOWN_ANSWER_DETECTOR_NAME | typeof CITATION_DETECTOR_NAME;
type FactualityDetectorVersion = typeof KNOWN_ANSWER_DETECTOR_VERSION | typeof CITATION_DETECTOR_VERSION;
export interface FactualitySignal {
    readonly code: FactualitySignalCode;
    readonly detectorName: FactualityDetectorName;
    readonly detectorVersion: FactualityDetectorVersion;
    readonly tenantId: string;
    readonly requestId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly fieldPath: "response.content";
    readonly matchType: FactualityMatchType;
    readonly authoritative: boolean;
    readonly expectedHash: string;
    readonly servedHash: string;
    readonly evidence: Record<string, unknown>;
    readonly valueJson: Record<string, unknown>;
}
declare const KNOWN_ANSWER_DETECTOR_NAME = "factuality-known-answer";
declare const KNOWN_ANSWER_DETECTOR_VERSION = "v0";
declare const CITATION_DETECTOR_NAME = "factuality-citation-support";
declare const CITATION_DETECTOR_VERSION = "anthropic-citation-v0";
/**
 * Runs evidence-gated factuality detectors over customer-supplied known-answer
 * contracts and hosted Anthropic citation-support evidence.
 *
 * @contract-id hosted-factuality-detectors
 */
export declare function runFactualityDetectors(event: CanonicalEventV1): FactualitySignal[];
export declare function detectKnownAnswerContradiction(event: CanonicalEventV1): FactualitySignal | null;
export declare function detectAnthropicCitationSupport(event: CanonicalEventV1): FactualitySignal[];
export declare function hashFactualityAnswer(value: string): string;
export {};
//# sourceMappingURL=factuality.d.ts.map