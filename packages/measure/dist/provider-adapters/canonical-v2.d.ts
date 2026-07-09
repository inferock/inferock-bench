import type { CanonicalAttemptRecord, CanonicalEventV2, ProviderName } from "../canonical-event.js";
import type { AdapterCanonicalInput, AdapterStreamInput } from "./types.js";
import { type JsonRecord } from "./record.js";
export type ProviderSurface = "chat_completions" | "anthropic_messages" | "openai_responses";
export interface StreamTimingCapture {
    firstEventAt?: Date;
    firstContentDeltaAt?: Date;
    firstByteAt?: Date;
    firstTokenAt?: Date;
    lastChunkAt?: Date;
    previousChunkAt?: Date;
    chunkCount: number;
    maxInterChunkGapMs?: number;
    maxStreamGapMs?: number;
    terminalStatus: CanonicalEventV2["timing"]["terminalStatus"];
}
interface ProviderTimingBoundary {
    readonly providerRequestStartedAt?: Date;
    readonly providerResponseEndedAt?: Date;
}
type CanonicalInput = AdapterCanonicalInput | AdapterStreamInput;
type ToolDeclaration = NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number];
export interface NormalizedRequestFields {
    readonly generation?: JsonRecord;
    readonly factualityContract?: JsonRecord;
    readonly toolDeclarations?: ToolDeclaration[];
}
export declare function canonicalRequest(input: CanonicalInput, provider: ProviderName, providerSurface: ProviderSurface): CanonicalEventV2["request"];
export declare function extractFromOpenAiChat(body: JsonRecord): NormalizedRequestFields;
export declare function extractFromOpenAiResponses(body: JsonRecord): NormalizedRequestFields;
export declare function extractFromAnthropicMessages(body: JsonRecord): NormalizedRequestFields;
export declare function anthropicCitationRequestEvidence(body: JsonRecord): JsonRecord;
export declare function canonicalTiming(startedAt: Date, endedAt: Date, terminalStatus: CanonicalEventV2["timing"]["terminalStatus"], providerTiming?: ProviderTimingBoundary): CanonicalEventV2["timing"];
export declare function createStreamTimingCapture(): StreamTimingCapture;
export declare function recordStreamChunk(capture: StreamTimingCapture, observedAt: Date): void;
export declare function recordStreamToken(capture: StreamTimingCapture, observedAt: Date): void;
export declare function streamTiming(startedAt: Date, endedAt: Date, capture: StreamTimingCapture, providerTiming?: ProviderTimingBoundary): CanonicalEventV2["timing"];
export declare function finalAttemptRecord(input: {
    readonly provider: ProviderName;
    readonly model: string;
    readonly attemptIndex: number;
    readonly startedAt: Date;
    readonly endedAt: Date;
    readonly providerRequestStartedAt?: Date;
    readonly providerResponseEndedAt?: Date;
    readonly status: CanonicalAttemptRecord["status"];
    readonly errorClass?: string;
    readonly statusCode?: number;
    readonly providerRequestId?: string;
    readonly sanitizedHeaders?: Record<string, string>;
}): CanonicalAttemptRecord;
export declare function canonicalAttempts(input: CanonicalInput, provider: ProviderName, model: string, endedAt: Date, status: CanonicalAttemptRecord["status"], errorClass?: string): CanonicalAttemptRecord[];
export declare function retryAttemptRecord(input: {
    readonly provider: ProviderName;
    readonly model: string;
    readonly attemptIndex: number;
    readonly startedAt: Date;
    readonly endedAt: Date;
    readonly providerRequestStartedAt?: Date;
    readonly providerResponseEndedAt?: Date;
    readonly statusCode?: number;
    readonly headers?: Headers;
    readonly errorClass?: string;
    readonly retryReason: string;
}): CanonicalAttemptRecord;
export declare function providerRequestIdFromHeaders(headers: Headers): string | undefined;
export declare function sanitizedProviderHeaders(headers: Headers): Record<string, string> | undefined;
export {};
//# sourceMappingURL=canonical-v2.d.ts.map