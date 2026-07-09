import type { CanonicalEventV1 } from "./canonical-event.js";
export declare const STREAM_TERMINATION_SIGNAL_CODES: readonly ["STREAM_UNCONFIRMED_TERMINATION", "STREAM_CLIENT_ABORTED", "OPENAI_STREAM_MISSING_DONE_MARKER", "ANTHROPIC_STREAM_ERROR_EVENT", "GEMINI_STREAM_ERROR_EVENT", "STREAM_TERMINAL_STATUS_GAP"];
export type StreamTerminationSignalCode = (typeof STREAM_TERMINATION_SIGNAL_CODES)[number];
export type StreamTerminationEvidenceGrade = "triage_only";
export type StreamTerminationSignalStatus = "triage_only";
export interface StreamTerminationSignal {
    readonly code: StreamTerminationSignalCode;
    readonly detectorName: typeof DETECTOR_NAME;
    readonly detectorVersion: typeof DETECTOR_VERSION;
    readonly tenantId: string;
    readonly requestId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly status: StreamTerminationSignalStatus;
    readonly evidenceGrade: StreamTerminationEvidenceGrade;
    readonly dispute: false;
    readonly liabilityParty: "unknown";
    readonly creditCandidate: false;
    readonly fieldPath: "timing.terminalStatus";
    readonly category: StreamTerminationCategory;
    readonly evidence: Record<string, unknown>;
    readonly valueJson: Record<string, unknown>;
}
type StreamTerminationCategory = "unconfirmed_stream_termination" | "provider_terminal_marker_missing" | "stream_aborted_before_terminal_state" | "provider_stream_error_event" | "terminal_status_gap";
declare const DETECTOR_NAME = "stream-termination-evidence";
declare const DETECTOR_VERSION = "v0";
/**
 * Runs passive, evidence-only stream termination checks over canonical stream timing.
 *
 * @contract-id loss-detectors-v1
 */
export declare function runStreamTerminationDetectors(event: CanonicalEventV1): StreamTerminationSignal[];
export {};
//# sourceMappingURL=stream-termination.d.ts.map