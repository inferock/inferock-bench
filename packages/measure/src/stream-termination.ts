import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";

export const STREAM_TERMINATION_SIGNAL_CODES = [
  "STREAM_UNCONFIRMED_TERMINATION",
  "STREAM_CLIENT_ABORTED",
  "OPENAI_STREAM_MISSING_DONE_MARKER",
  "ANTHROPIC_STREAM_ERROR_EVENT",
  "GEMINI_STREAM_ERROR_EVENT",
  "STREAM_TERMINAL_STATUS_GAP",
] as const;

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

type StreamTerminalStatus = CanonicalEventV2["timing"]["terminalStatus"];
type StreamTerminationCategory =
  | "unconfirmed_stream_termination"
  | "provider_terminal_marker_missing"
  | "stream_aborted_before_terminal_state"
  | "provider_stream_error_event"
  | "terminal_status_gap";

interface StreamTimingEvidence {
  readonly terminalStatus?: StreamTerminalStatus;
  readonly chunkCount?: number;
  readonly firstEventAt?: string;
  readonly firstContentDeltaAt?: string;
  readonly lastChunkAt?: string;
  readonly maxInterChunkGapMs?: number;
  readonly maxStreamGapMs?: number;
}

interface ResponseErrorEvidence {
  readonly rawErrorType?: string;
  readonly rawErrorCode?: string;
}

interface StreamSignalDecision {
  readonly code: StreamTerminationSignalCode;
  readonly category: StreamTerminationCategory;
  readonly reason: string;
  readonly terminationAttribution: "client" | "provider" | "unknown";
}

const DETECTOR_NAME = "stream-termination-evidence";
const DETECTOR_VERSION = "v0";
const RESPONSE_FIELD_PATH = "timing.terminalStatus";
const PROVIDER_BILLING_BASIS = "undocumented";
const REFUNDABLE_CLASSIFICATION = "evidence_only_not_refundable";

/**
 * Runs passive, evidence-only stream termination checks over canonical stream timing.
 *
 * @contract-id loss-detectors-v1
 */
export function runStreamTerminationDetectors(
  event: CanonicalEventV1,
): StreamTerminationSignal[] {
  const timing = streamTimingEvidenceForEvent(event);
  if (!hasStreamEvidence(event, timing)) return [];

  const decision = streamSignalDecision(event, timing);
  return decision ? [streamTerminationSignal(event, timing, decision)] : [];
}

function streamSignalDecision(
  event: CanonicalEventV1,
  timing: StreamTimingEvidence,
): StreamSignalDecision | null {
  if (isProviderPost200StreamError(event, timing)) {
    const provider = event.request.provider;
    return {
      code: provider === "gemini" ? "GEMINI_STREAM_ERROR_EVENT" : "ANTHROPIC_STREAM_ERROR_EVENT",
      category: "provider_stream_error_event",
      reason: `${provider}_post_200_stream_error_event`,
      terminationAttribution: "provider",
    };
  }

  if (timing.terminalStatus === "unknown" || timing.terminalStatus === undefined) {
    return {
      code: "STREAM_TERMINAL_STATUS_GAP",
      category: "terminal_status_gap",
      reason: "stream_terminal_status_gap",
      terminationAttribution: "unknown",
    };
  }

  if (timing.terminalStatus === "aborted") {
    const causalityEvidence = streamTerminationCausalityEvidenceForEvent(event);
    if (causalityEvidence === "client_disconnect") {
      return {
        code: "STREAM_CLIENT_ABORTED",
        category: "stream_aborted_before_terminal_state",
        reason: "stream_client_disconnect_confirmed",
        terminationAttribution: "client",
      };
    }

    if (event.request.provider === "openai" && causalityEvidence === "provider_missing_terminal_marker") {
      return {
        code: "OPENAI_STREAM_MISSING_DONE_MARKER",
        category: "provider_terminal_marker_missing",
        reason: "openai_stream_missing_done_marker_provider_eof_confirmed",
        terminationAttribution: "provider",
      };
    }

    return {
      code: "STREAM_UNCONFIRMED_TERMINATION",
      category: "unconfirmed_stream_termination",
      reason: "stream_termination_causality_unconfirmed",
      terminationAttribution: "unknown",
    };
  }

  return null;
}

function streamTerminationSignal(
  event: CanonicalEventV1,
  timing: StreamTimingEvidence,
  decision: StreamSignalDecision,
): StreamTerminationSignal {
  const responseErrorEvidence = responseErrorEvidenceForEvent(event);
  const evidence = {
    reason: decision.reason,
    provider: event.request.provider,
    requestId: event.request.requestId,
    model: event.request.model,
    statusCode: event.response.statusCode,
    finishReason: event.response.finishReason,
    terminalStatus: timing.terminalStatus ?? "missing",
    terminationAttribution: decision.terminationAttribution,
    ...(typeof timing.chunkCount === "number" ? { chunkCount: timing.chunkCount } : {}),
    ...(timing.firstEventAt ? { firstEventAt: timing.firstEventAt } : {}),
    ...(timing.firstContentDeltaAt ? { firstContentDeltaAt: timing.firstContentDeltaAt } : {}),
    ...(timing.lastChunkAt ? { lastChunkAt: timing.lastChunkAt } : {}),
    ...(timing.maxInterChunkGapMs !== undefined
      ? { maxInterChunkGapMs: timing.maxInterChunkGapMs }
      : {}),
    ...(timing.maxStreamGapMs !== undefined ? { maxStreamGapMs: timing.maxStreamGapMs } : {}),
    ...(event.response.errorClass ? { errorClass: event.response.errorClass } : {}),
    ...(responseErrorEvidence.rawErrorType ? { rawErrorType: responseErrorEvidence.rawErrorType } : {}),
    ...(responseErrorEvidence.rawErrorCode ? { rawErrorCode: responseErrorEvidence.rawErrorCode } : {}),
    providerBillingBasis: PROVIDER_BILLING_BASIS,
    refundableClassification: REFUNDABLE_CLASSIFICATION,
    creditCandidate: false,
  };

  return {
    code: decision.code,
    detectorName: DETECTOR_NAME,
    detectorVersion: DETECTOR_VERSION,
    tenantId: event.request.tenantId,
    requestId: event.request.requestId,
    provider: event.request.provider,
    model: event.request.model,
    status: "triage_only",
    evidenceGrade: "triage_only",
    dispute: false,
    liabilityParty: "unknown",
    creditCandidate: false,
    fieldPath: RESPONSE_FIELD_PATH,
    category: decision.category,
    evidence,
    valueJson: {
      category: decision.category,
      terminalStatus: timing.terminalStatus ?? "missing",
      terminationAttribution: decision.terminationAttribution,
      ...(typeof timing.chunkCount === "number" ? { chunkCount: timing.chunkCount } : {}),
      evidenceOnly: true,
      providerBillingBasis: PROVIDER_BILLING_BASIS,
      refundableClassification: REFUNDABLE_CLASSIFICATION,
      creditCandidate: false,
    },
  };
}

function isProviderPost200StreamError(
  event: CanonicalEventV1,
  timing: StreamTimingEvidence,
): boolean {
  return (event.request.provider === "anthropic" || event.request.provider === "gemini") &&
    event.response.statusCode === 200 &&
    timing.terminalStatus === "error" &&
    Boolean(event.response.errorClass);
}

function hasStreamEvidence(event: CanonicalEventV1, timing: StreamTimingEvidence): boolean {
  if (eventSchemaVersion(event) !== "v2") return false;
  return hasPositiveStreamTimingEvidence(timing);
}

function eventSchemaVersion(event: CanonicalEventV1): string | undefined {
  const record = event as CanonicalEventV1 & { readonly schemaVersion?: string };
  return record.schemaVersion;
}

function hasPositiveStreamTimingEvidence(timing: StreamTimingEvidence): boolean {
  return Boolean(
    (typeof timing.chunkCount === "number" && timing.chunkCount > 0) ||
      timing.firstEventAt ||
      timing.firstContentDeltaAt ||
      timing.lastChunkAt,
  );
}

function streamTerminationCausalityEvidenceForEvent(
  event: CanonicalEventV1,
): "client_disconnect" | "provider_missing_terminal_marker" | null {
  const responseErrorEvidence = responseErrorEvidenceForEvent(event);
  const values = [
    event.response.finishReason,
    event.response.errorClass,
    responseErrorEvidence.rawErrorType,
    responseErrorEvidence.rawErrorCode,
  ].map(normalizedEvidenceToken);

  if (values.some((value) => CLIENT_DISCONNECT_EVIDENCE_TOKENS.has(value))) {
    return "client_disconnect";
  }
  if (values.some((value) => PROVIDER_MISSING_TERMINAL_MARKER_EVIDENCE_TOKENS.has(value))) {
    return "provider_missing_terminal_marker";
  }
  return null;
}

function normalizedEvidenceToken(value: string | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

function streamTimingEvidenceForEvent(event: CanonicalEventV1): StreamTimingEvidence {
  const timing = event.timing as CanonicalEventV1["timing"] & Partial<CanonicalEventV2["timing"]>;
  return {
    terminalStatus: timing.terminalStatus,
    chunkCount: timing.chunkCount,
    firstEventAt: timing.firstEventAt,
    firstContentDeltaAt: timing.firstContentDeltaAt,
    lastChunkAt: timing.lastChunkAt,
    maxInterChunkGapMs: timing.maxInterChunkGapMs,
    maxStreamGapMs: timing.maxStreamGapMs,
  };
}

const CLIENT_DISCONNECT_EVIDENCE_TOKENS = new Set([
  "client_abort",
  "client_aborted",
  "client_cancelled",
  "client_canceled",
  "client_disconnect",
  "client_disconnected",
  "downstream_client_abort",
  "downstream_client_aborted",
  "downstream_client_disconnect",
  "downstream_client_disconnected",
]);

const PROVIDER_MISSING_TERMINAL_MARKER_EVIDENCE_TOKENS = new Set([
  "missing_terminal_marker_provider_eof",
  "openai_missing_done_marker_provider_eof",
  "openai_stream_missing_done_marker_provider_eof",
  "provider_eof_missing_terminal_marker",
  "provider_missing_terminal_marker",
  "upstream_eof_missing_terminal_marker",
]);

function responseErrorEvidenceForEvent(event: CanonicalEventV1): ResponseErrorEvidence {
  const response = event.response as CanonicalEventV1["response"] & ResponseErrorEvidence;
  return {
    rawErrorType: response.rawErrorType,
    rawErrorCode: response.rawErrorCode,
  };
}
