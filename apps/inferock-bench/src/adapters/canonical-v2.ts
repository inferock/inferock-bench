// Copied from apps/proxy/src/adapters/canonical-v2.ts for inferock-bench Track C.

import { createHash } from "node:crypto";
import type {
  CanonicalAttemptRecord,
  CanonicalEventV2,
  ProviderName,
} from "@inferock/measure/canonical-event";
import { OPENROUTER_PLANE } from "@inferock/measure/pricing";
import type { AdapterCanonicalInput, AdapterStreamInput, ClientConsumptionTiming, ErrorOrigin } from "./types.js";
import {
  asRecord,
  booleanValue,
  isRecord,
  stringValue,
  type JsonRecord,
} from "../record.js";
import {
  geminiSchemaSanitizationEvidence,
  sanitizeGeminiGenerateContentPayload,
} from "./gemini-schema.js";
import { openRouterPinnedGenerationEvidence } from "../openrouter-pins.js";

export type ProviderSurface =
  | "chat_completions"
  | "openai_compatible_chat"
  | "anthropic_messages"
  | "gemini_generate_content";

export interface MonotonicTimestamp {
  readonly wallTime: Date;
  readonly monotonicNs?: bigint;
  readonly monotonicClockSource?: string;
}

export interface StreamTimingCapture {
  firstEventAt?: MonotonicTimestamp;
  firstContentDeltaAt?: MonotonicTimestamp;
  firstByteAt?: MonotonicTimestamp;
  firstTokenAt?: MonotonicTimestamp;
  lastChunkAt?: MonotonicTimestamp;
  previousChunkAt?: MonotonicTimestamp;
  chunkCount: number;
  maxInterChunkGapMs?: number;
  maxStreamGapMs?: number;
  terminalStatus: CanonicalEventV2["timing"]["terminalStatus"];
}

interface ProviderTimingBoundary {
  readonly providerRequestStartedAt?: Date;
  readonly providerResponseEndedAt?: Date;
  readonly providerRequestStartedAtMonotonicNs?: bigint;
  readonly providerResponseEndedAtMonotonicNs?: bigint;
  readonly startedAtMonotonicNs?: bigint;
  readonly endedAtMonotonicNs?: bigint;
  readonly monotonicClockSource?: string;
  readonly clientConsumptionTiming?: ClientConsumptionTiming;
}

type CanonicalInput = AdapterCanonicalInput | AdapterStreamInput;
type ToolDeclaration = NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number];
export interface NormalizedRequestFields {
  readonly generation?: JsonRecord;
  readonly factualityContract?: JsonRecord;
  readonly toolDeclarations?: ToolDeclaration[];
}

const OPENAI_GENERATION_FIELD_NAMES = [
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "response_format",
  "seed",
  "n",
  "service_tier",
] as const;
const ANTHROPIC_GENERATION_FIELD_NAMES = [
  "temperature",
  "top_p",
  "top_k",
  "max_tokens",
  "max_completion_tokens",
  "stop_sequences",
  "stop",
  "response_format",
  "seed",
  "n",
  "service_tier",
  "eager_input_streaming",
] as const;
const GEMINI_GENERATION_FIELD_NAMES = [
  "tools",
  "toolConfig",
  "generationConfig",
  "cachedContent",
  "serviceTier",
] as const;
const SCHEMA_ABSENT_HASH = "schema_absent";
const REQUEST_BODY_HASH_ALGORITHM = "sha256";
const REQUEST_BODY_HASH_CANONICALIZATION = "normalized_json_v1";
const GEMINI_DEVELOPER_API_HOST = "generativelanguage.googleapis.com";
const GEMINI_DEVELOPER_API_PLANE = "gemini_developer_api";
const OPENROUTER_API_HOST = "openrouter.ai";
const MONOTONIC_CLOCK_SOURCE = "process.hrtime.bigint";
const WALL_CLOCK_DRIFT_IMPLAUSIBLE_MS = 1_000;

interface WallClockDriftEvidence {
  readonly kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
  readonly wallClockElapsedMs: number;
  readonly monotonicElapsedMs: number;
  readonly driftMs: number;
}

interface MonotonicDurationFields {
  readonly monotonicElapsedMs?: number;
  readonly monotonicClockSource?: string;
  readonly wallClockDrift?: WallClockDriftEvidence;
}

interface ProviderTimingFields {
  readonly providerRequestStartedAt?: string;
  readonly providerResponseEndedAt?: string;
  readonly providerElapsedMs?: number;
  readonly providerMonotonicElapsedMs?: number;
  readonly providerWallClockDrift?: WallClockDriftEvidence;
  readonly gatewayOverheadMs?: number;
  readonly clientConsumptionEndedAt?: string;
}

export function captureMonotonicTimestamp(): Required<MonotonicTimestamp> {
  return {
    wallTime: new Date(),
    monotonicNs: process.hrtime.bigint(),
    monotonicClockSource: MONOTONIC_CLOCK_SOURCE,
  };
}

export function canonicalRequest(
  input: CanonicalInput,
  provider: ProviderName,
  providerSurface: ProviderSurface,
): CanonicalEventV2["request"] {
  const providerRequestId = providerRequestIdFromHeaders(input.headers);
  const requestHeaders = sanitizedRequestHeaders(input.requestHeaders);
  return {
    tenantId: input.tenantId,
    provider,
    requestId: input.requestId,
    requestedModel: input.requestModel,
    model: input.requestModel,
    attemptIndex: input.attemptIndex,
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(input.apiKeyHash ? { apiKeyHash: input.apiKeyHash } : {}),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    bodyHash: requestBodyHash(canonicalRequestBodyForHash(input.requestBody, providerSurface)),
    bodyHashAlgorithm: REQUEST_BODY_HASH_ALGORITHM,
    bodyHashCanonicalization: REQUEST_BODY_HASH_CANONICALIZATION,
    ...(input.retryCorrelationId ? { retryCorrelationId: input.retryCorrelationId } : {}),
    ...(input.expectCompletion !== undefined ? { expectCompletion: input.expectCompletion } : {}),
    ...(input.route ? { route: input.route } : {}),
    ...(input.workloadClass ? { workloadClass: input.workloadClass } : {}),
    ...(input.outputSchemaVersion ? { outputSchemaVersion: input.outputSchemaVersion } : {}),
    ...(input.factualityContract ? { factualityContract: input.factualityContract } : {}),
    ...measuredEntityFields(input, provider),
    ...extractRequestFields(input.requestBody, providerSurface),
    ...(requestHeaders ? { sanitizedHeaders: requestHeaders } : {}),
  };
}

function measuredEntityFields(
  input: CanonicalInput,
  provider: ProviderName,
): Pick<
  CanonicalEventV2["request"],
  "providerPlane" | "baseUrlHost" | "authClass" | "endpointSupportStatus" | "endpointSupportReason"
> {
  const host = baseUrlHost(input.baseUrl);
  if (provider === "openrouter") {
    if (host === OPENROUTER_API_HOST) {
      return {
        providerPlane: OPENROUTER_PLANE,
        baseUrlHost: host,
        authClass: "api_key",
        endpointSupportStatus: "supported",
      };
    }
    return {
      providerPlane: "unsupported_openrouter_endpoint",
      ...(host ? { baseUrlHost: host } : {}),
      authClass: "api_key",
      endpointSupportStatus: "unsupported",
      endpointSupportReason: "openrouter_non_api_host_not_modeled",
    };
  }
  if (provider !== "gemini") return {};
  if (host === GEMINI_DEVELOPER_API_HOST) {
    return {
      providerPlane: GEMINI_DEVELOPER_API_PLANE,
      baseUrlHost: host,
      authClass: "api_key",
      endpointSupportStatus: "supported",
    };
  }
  return {
    providerPlane: "unsupported_gemini_endpoint",
    ...(host ? { baseUrlHost: host } : {}),
    authClass: "api_key",
    endpointSupportStatus: "unsupported",
    endpointSupportReason: "gemini_non_developer_api_endpoint_not_modeled",
  };
}

function baseUrlHost(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

export function extractFromOpenAiChat(body: JsonRecord): NormalizedRequestFields {
  return {
    ...optionalGeneration(body, OPENAI_GENERATION_FIELD_NAMES),
    ...optionalToolDeclarations(body, "chat_completions", openAiToolDeclaration),
  };
}

export function extractFromOpenRouterChat(body: JsonRecord): NormalizedRequestFields {
  return {
    ...mergeGeneration(
      optionalGeneration(body, OPENAI_GENERATION_FIELD_NAMES).generation,
      openRouterPinnedGenerationEvidence(body),
    ),
    ...optionalToolDeclarations(body, "openai_compatible_chat", openAiToolDeclaration),
  };
}

export function extractFromAnthropicMessages(body: JsonRecord): NormalizedRequestFields {
  return {
    ...optionalGeneration(body, ANTHROPIC_GENERATION_FIELD_NAMES),
    ...optionalToolDeclarations(body, "anthropic_messages", anthropicToolDeclaration),
  };
}

export function extractFromGeminiGenerateContent(body: JsonRecord): NormalizedRequestFields {
  const sanitized = sanitizeGeminiGenerateContentPayload(body);
  const sanitizationEvidence = geminiSchemaSanitizationEvidence(sanitized.changes);
  const generation = {
    ...(optionalGeneration(sanitized.payload, GEMINI_GENERATION_FIELD_NAMES).generation ?? {}),
    ...geminiStructuredOutputRequestEvidence(sanitized.payload),
    ...(sanitizationEvidence ? { geminiSchemaSanitization: sanitizationEvidence } : {}),
  };
  return {
    ...(Object.keys(generation).length > 0 ? { generation } : {}),
    ...geminiToolDeclarations(sanitized.payload),
  };
}

function geminiStructuredOutputRequestEvidence(body: JsonRecord): JsonRecord {
  const generationConfig = asRecord(body.generationConfig);
  if (!generationConfig) return {};
  return {
    ...(generationConfig.responseMimeType !== undefined ? { responseMimeType: generationConfig.responseMimeType } : {}),
    ...(generationConfig.responseSchema !== undefined ? { responseSchema: generationConfig.responseSchema } : {}),
    ...(generationConfig.responseJsonSchema !== undefined
      ? { responseJsonSchema: generationConfig.responseJsonSchema }
      : {}),
    ...(generationConfig.thinkingConfig !== undefined ? { thinkingConfig: generationConfig.thinkingConfig } : {}),
  };
}

export function canonicalTiming(
  startedAt: Date,
  endedAt: Date,
  terminalStatus: CanonicalEventV2["timing"]["terminalStatus"],
  providerTiming?: ProviderTimingBoundary,
): CanonicalEventV2["timing"] {
  const totalDuration = durationEvidence(
    timestampFromDate(startedAt, providerTiming?.startedAtMonotonicNs, providerTiming?.monotonicClockSource),
    timestampFromDate(endedAt, providerTiming?.endedAtMonotonicNs, providerTiming?.monotonicClockSource),
  );
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: totalDuration.elapsedMs,
    ...monotonicDurationFields(totalDuration),
    ...providerTimingFields(totalDuration.elapsedMs, providerTiming),
    ...clientConsumptionTimingFields(providerTiming?.clientConsumptionTiming),
    chunkCount: 0,
    terminalStatus,
  };
}

export function createStreamTimingCapture(): StreamTimingCapture {
  return {
    chunkCount: 0,
    terminalStatus: "unknown",
  };
}

export function recordStreamByte(capture: StreamTimingCapture, observedAt: Date | MonotonicTimestamp): void {
  const observed = timestampFromInput(observedAt);
  if (!capture.firstByteAt) capture.firstByteAt = observed;
}

export function recordParsedSseEvent(capture: StreamTimingCapture, observedAt: Date | MonotonicTimestamp): void {
  const observed = timestampFromInput(observedAt);
  if (!capture.firstEventAt) capture.firstEventAt = observed;
  if (capture.previousChunkAt) {
    const gapMs = durationEvidence(capture.previousChunkAt, observed).elapsedMs;
    capture.maxInterChunkGapMs = Math.max(capture.maxInterChunkGapMs ?? 0, gapMs);
    capture.maxStreamGapMs = Math.max(capture.maxStreamGapMs ?? 0, gapMs);
  }
  capture.previousChunkAt = observed;
  capture.lastChunkAt = observed;
  capture.chunkCount += 1;
}

export function recordStreamContentDelta(capture: StreamTimingCapture, observedAt: Date | MonotonicTimestamp): void {
  const observed = timestampFromInput(observedAt);
  if (!capture.firstContentDeltaAt) capture.firstContentDeltaAt = observed;
  if (!capture.firstTokenAt) capture.firstTokenAt = observed;
}

export function streamTiming(
  startedAt: Date,
  endedAt: Date,
  capture: StreamTimingCapture,
  providerTiming?: ProviderTimingBoundary,
): CanonicalEventV2["timing"] {
  const started = timestampFromDate(startedAt, providerTiming?.startedAtMonotonicNs, providerTiming?.monotonicClockSource);
  const ended = timestampFromDate(endedAt, providerTiming?.endedAtMonotonicNs, providerTiming?.monotonicClockSource);
  const totalDuration = durationEvidence(started, ended);
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: totalDuration.elapsedMs,
    ...monotonicDurationFields(totalDuration),
    ...providerTimingFields(totalDuration.elapsedMs, providerTiming),
    ...clientConsumptionTimingFields(providerTiming?.clientConsumptionTiming),
    ...(capture.firstEventAt ? { firstEventAt: capture.firstEventAt.wallTime.toISOString() } : {}),
    ...(capture.firstContentDeltaAt ? { firstContentDeltaAt: capture.firstContentDeltaAt.wallTime.toISOString() } : {}),
    ...(capture.firstByteAt ? { firstByteAt: capture.firstByteAt.wallTime.toISOString() } : {}),
    ...(capture.firstTokenAt ? { firstTokenAt: capture.firstTokenAt.wallTime.toISOString() } : {}),
    ...(capture.lastChunkAt ? { lastChunkAt: capture.lastChunkAt.wallTime.toISOString() } : {}),
    ...(capture.firstEventAt ? { timeToFirstEventMs: durationEvidence(started, capture.firstEventAt).elapsedMs } : {}),
    ...(capture.firstContentDeltaAt
      ? { timeToFirstContentDeltaMs: durationEvidence(started, capture.firstContentDeltaAt).elapsedMs }
      : {}),
    ...(capture.firstByteAt ? { timeToFirstByteMs: durationEvidence(started, capture.firstByteAt).elapsedMs } : {}),
    ...(capture.firstTokenAt ? { timeToFirstTokenMs: durationEvidence(started, capture.firstTokenAt).elapsedMs } : {}),
    chunkCount: capture.chunkCount,
    ...(capture.maxInterChunkGapMs !== undefined ? { maxInterChunkGapMs: capture.maxInterChunkGapMs } : {}),
    ...(capture.maxStreamGapMs !== undefined ? { maxStreamGapMs: capture.maxStreamGapMs } : {}),
    terminalStatus: capture.terminalStatus,
  };
}

export function finalAttemptRecord(input: {
  readonly provider: ProviderName;
  readonly model: string;
  readonly attemptIndex: number;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly startedAtMonotonicNs?: bigint;
  readonly endedAtMonotonicNs?: bigint;
  readonly monotonicClockSource?: string;
  readonly providerRequestStartedAt?: Date;
  readonly providerResponseEndedAt?: Date;
  readonly providerRequestStartedAtMonotonicNs?: bigint;
  readonly providerResponseEndedAtMonotonicNs?: bigint;
  readonly clientConsumptionTiming?: ClientConsumptionTiming;
  readonly status: CanonicalAttemptRecord["status"];
  readonly errorClass?: string;
  readonly errorOrigin?: ErrorOrigin;
}): CanonicalAttemptRecord {
  return {
    attemptNumber: input.attemptIndex,
    provider: input.provider,
    model: input.model,
    status: input.status,
    timing: canonicalAttemptTiming(input.startedAt, input.endedAt, {
      ...(input.startedAtMonotonicNs !== undefined ? { startedAtMonotonicNs: input.startedAtMonotonicNs } : {}),
      ...(input.endedAtMonotonicNs !== undefined ? { endedAtMonotonicNs: input.endedAtMonotonicNs } : {}),
      ...(input.monotonicClockSource ? { monotonicClockSource: input.monotonicClockSource } : {}),
      ...(input.providerRequestStartedAt ? { providerRequestStartedAt: input.providerRequestStartedAt } : {}),
      ...(input.providerResponseEndedAt ? { providerResponseEndedAt: input.providerResponseEndedAt } : {}),
      ...(input.providerRequestStartedAtMonotonicNs !== undefined
        ? { providerRequestStartedAtMonotonicNs: input.providerRequestStartedAtMonotonicNs }
        : {}),
      ...(input.providerResponseEndedAtMonotonicNs !== undefined
        ? { providerResponseEndedAtMonotonicNs: input.providerResponseEndedAtMonotonicNs }
        : {}),
      ...(input.clientConsumptionTiming ? { clientConsumptionTiming: input.clientConsumptionTiming } : {}),
    }),
    ...(input.errorClass ? { errorClass: input.errorClass } : {}),
    ...(input.errorOrigin ? { errorOrigin: input.errorOrigin } : {}),
    finalSelected: true,
  } as unknown as CanonicalAttemptRecord;
}

export function canonicalAttempts(
  input: CanonicalInput,
  provider: ProviderName,
  model: string,
  endedAt: Date,
  status: CanonicalAttemptRecord["status"],
  errorClass?: string,
): CanonicalAttemptRecord[] {
  const clientConsumptionTiming = clientConsumptionTimingFromInput(input);
  return [
    ...(input.previousAttempts ?? []),
    finalAttemptRecord({
      provider,
      model,
      attemptIndex: input.attemptIndex,
      startedAt: input.startedAt,
      endedAt,
      ...(input.startedAtMonotonicNs !== undefined ? { startedAtMonotonicNs: input.startedAtMonotonicNs } : {}),
      ...(input.endedAtMonotonicNs !== undefined ? { endedAtMonotonicNs: input.endedAtMonotonicNs } : {}),
      ...(input.monotonicClockSource ? { monotonicClockSource: input.monotonicClockSource } : {}),
      ...(input.providerRequestStartedAt ? { providerRequestStartedAt: input.providerRequestStartedAt } : {}),
      ...(input.providerResponseEndedAt ? { providerResponseEndedAt: input.providerResponseEndedAt } : {}),
      ...(input.providerRequestStartedAtMonotonicNs !== undefined
        ? { providerRequestStartedAtMonotonicNs: input.providerRequestStartedAtMonotonicNs }
        : {}),
      ...(input.providerResponseEndedAtMonotonicNs !== undefined
        ? { providerResponseEndedAtMonotonicNs: input.providerResponseEndedAtMonotonicNs }
        : {}),
      ...(clientConsumptionTiming ? { clientConsumptionTiming } : {}),
      status,
      ...(errorClass ? { errorClass } : {}),
      ...(input.errorOrigin ? { errorOrigin: input.errorOrigin } : {}),
    }),
  ];
}

function clientConsumptionTimingFromInput(input: CanonicalInput): ClientConsumptionTiming | undefined {
  return "clientConsumptionTiming" in input ? input.clientConsumptionTiming : undefined;
}

export function providerRequestIdFromHeaders(headers: Headers): string | undefined {
  return headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("openai-request-id") ??
    headers.get("anthropic-request-id") ??
    headers.get("x-goog-request-id") ??
    undefined;
}

export function sanitizedProviderHeaders(headers: Headers): Record<string, string> | undefined {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const normalized = name.toLowerCase();
    if (isEvidenceHeader(normalized)) sanitized[normalized] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizedRequestHeaders(headers: Headers | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const sanitized: Record<string, string> = {};
  for (const name of [
    "x-stainless-retry-count",
    "x-inferock-request-origin",
    "x-inferock-abort-origin",
  ]) {
    const value = headers.get(name);
    if (value !== null) sanitized[name] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function extractRequestFields(
  body: JsonRecord,
  providerSurface: ProviderSurface,
): NormalizedRequestFields {
  if (providerSurface === "chat_completions") return extractFromOpenAiChat(body);
  if (providerSurface === "openai_compatible_chat") return extractFromOpenRouterChat(body);
  if (providerSurface === "gemini_generate_content") return extractFromGeminiGenerateContent(body);
  return extractFromAnthropicMessages(body);
}

function mergeGeneration(
  left: JsonRecord | undefined,
  right: JsonRecord | undefined,
): NormalizedRequestFields {
  const generation = {
    ...(left ?? {}),
    ...(right ?? {}),
  };
  return Object.keys(generation).length > 0 ? { generation } : {};
}

function optionalGeneration(
  body: JsonRecord,
  fieldNames: readonly string[],
): NormalizedRequestFields {
  const generation: JsonRecord = {};
  for (const fieldName of fieldNames) {
    if (body[fieldName] !== undefined) generation[camelFieldName(fieldName)] = body[fieldName];
  }
  return Object.keys(generation).length > 0 ? { generation } : {};
}

function optionalToolDeclarations(
  body: JsonRecord,
  providerSurface: ProviderSurface,
  mapTool: (tool: JsonRecord, body: JsonRecord, providerSurface: ProviderSurface) => ToolDeclaration | null,
): NormalizedRequestFields {
  const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : [];
  const declarations = tools
    .map((tool) => mapTool(tool, body, providerSurface))
    .filter((tool): tool is ToolDeclaration => tool !== null);
  return { toolDeclarations: declarations };
}

function openAiToolDeclaration(
  tool: JsonRecord,
  body: JsonRecord,
  providerSurface: ProviderSurface,
): ToolDeclaration | null {
  const functionTool = asRecord(tool.function);
  const name = stringValue(functionTool?.name) ?? stringValue(tool.name);
  if (!name) return null;

  const schema = capturedOpenAiToolSchema(tool, functionTool);
  const strict = booleanValue(functionTool?.strict) ?? booleanValue(tool.strict);
  return {
    providerSurface,
    name,
    schemaHash: schema === undefined
      ? SCHEMA_ABSENT_HASH
      : `sha256:${sha256Hex(stableJson(schema))}`,
    ...(schema !== undefined ? { schema } : {}),
    ...(strict !== undefined ? { strict } : {}),
    ...(body.tool_choice !== undefined ? { toolChoice: body.tool_choice } : {}),
    parallelToolCalls: openAiParallelToolCalls(body),
  };
}

function anthropicToolDeclaration(
  tool: JsonRecord,
  body: JsonRecord,
  providerSurface: ProviderSurface,
): ToolDeclaration | null {
  const functionTool = asRecord(tool.function);
  const name = stringValue(tool.name) ?? stringValue(functionTool?.name);
  if (!name) return null;

  const schema = capturedAnthropicToolSchema(tool, functionTool);
  const strict = booleanValue(tool.strict) ?? booleanValue(functionTool?.strict);
  return {
    providerSurface,
    name,
    schemaHash: schema === undefined
      ? SCHEMA_ABSENT_HASH
      : `sha256:${sha256Hex(stableJson(schema))}`,
    ...(schema !== undefined ? { schema } : {}),
    ...(strict !== undefined ? { strict } : {}),
    ...(body.tool_choice !== undefined ? { toolChoice: body.tool_choice } : {}),
    parallelToolCalls: anthropicParallelToolCalls(body),
  };
}

function geminiToolDeclarations(body: JsonRecord): NormalizedRequestFields {
  const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : [];
  const declarations = tools.flatMap((tool) => {
    const functionDeclarations = Array.isArray(tool.functionDeclarations)
      ? tool.functionDeclarations.filter(isRecord)
      : [];
    return functionDeclarations
      .map((declaration) => geminiToolDeclaration(declaration, body))
      .filter((toolDeclaration): toolDeclaration is ToolDeclaration => toolDeclaration !== null);
  });
  return { toolDeclarations: declarations };
}

function geminiToolDeclaration(
  declaration: JsonRecord,
  body: JsonRecord,
): ToolDeclaration | null {
  const name = stringValue(declaration.name);
  if (!name) return null;

  const schema = capturedGeminiToolSchema(declaration);
  return {
    providerSurface: "gemini_generate_content",
    name,
    schemaHash: schema === undefined
      ? SCHEMA_ABSENT_HASH
      : `sha256:${sha256Hex(stableJson(schema))}`,
    ...(schema !== undefined ? { schema } : {}),
    ...(body.toolConfig !== undefined ? { toolChoice: body.toolConfig } : {}),
  };
}

function capturedOpenAiToolSchema(
  tool: JsonRecord,
  functionTool: JsonRecord | undefined,
): unknown {
  if (functionTool && Object.prototype.hasOwnProperty.call(functionTool, "parameters")) {
    return functionTool.parameters;
  }
  if (Object.prototype.hasOwnProperty.call(tool, "input_schema")) return tool.input_schema;
  if (Object.prototype.hasOwnProperty.call(tool, "schema")) return tool.schema;
  return undefined;
}

function capturedAnthropicToolSchema(
  tool: JsonRecord,
  functionTool: JsonRecord | undefined,
): unknown {
  if (Object.prototype.hasOwnProperty.call(tool, "input_schema")) return tool.input_schema;
  if (Object.prototype.hasOwnProperty.call(tool, "schema")) return tool.schema;
  if (functionTool && Object.prototype.hasOwnProperty.call(functionTool, "parameters")) {
    return functionTool.parameters;
  }
  return undefined;
}

function capturedGeminiToolSchema(declaration: JsonRecord): unknown {
  if (Object.prototype.hasOwnProperty.call(declaration, "parameters")) return declaration.parameters;
  if (Object.prototype.hasOwnProperty.call(declaration, "parametersJsonSchema")) {
    return declaration.parametersJsonSchema;
  }
  return undefined;
}

function anthropicParallelToolCalls(body: JsonRecord): boolean {
  const openAiCompatibleValue = booleanValue(body.parallel_tool_calls);
  if (openAiCompatibleValue !== undefined) return openAiCompatibleValue;

  const toolChoice = asRecord(body.tool_choice);
  const disabled = booleanValue(toolChoice?.disable_parallel_tool_use);
  return disabled === undefined ? true : !disabled;
}

function openAiParallelToolCalls(body: JsonRecord): boolean {
  return booleanValue(body.parallel_tool_calls) ?? true;
}

function canonicalAttemptTiming(
  startedAt: Date,
  endedAt: Date,
  providerTiming?: ProviderTimingBoundary,
): CanonicalAttemptRecord["timing"] {
  const totalDuration = durationEvidence(
    timestampFromDate(startedAt, providerTiming?.startedAtMonotonicNs, providerTiming?.monotonicClockSource),
    timestampFromDate(endedAt, providerTiming?.endedAtMonotonicNs, providerTiming?.monotonicClockSource),
  );
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: totalDuration.elapsedMs,
    ...monotonicDurationFields(totalDuration),
    ...providerTimingFields(totalDuration.elapsedMs, providerTiming),
    ...clientConsumptionTimingFields(providerTiming?.clientConsumptionTiming),
  };
}

function providerTimingFields(
  totalElapsedMs: number,
  providerTiming: ProviderTimingBoundary | undefined,
): ProviderTimingFields {
  const providerRequestStartedAt = providerTiming?.providerRequestStartedAt;
  const providerResponseEndedAt = providerTiming?.providerResponseEndedAt;
  const providerDuration = providerRequestStartedAt && providerResponseEndedAt
    ? durationEvidence(
      timestampFromDate(
        providerRequestStartedAt,
        providerTiming?.providerRequestStartedAtMonotonicNs,
        providerTiming?.monotonicClockSource,
      ),
      timestampFromDate(
        providerResponseEndedAt,
        providerTiming?.providerResponseEndedAtMonotonicNs,
        providerTiming?.monotonicClockSource,
      ),
    )
    : undefined;
  return {
    ...(providerRequestStartedAt ? { providerRequestStartedAt: providerRequestStartedAt.toISOString() } : {}),
    ...(providerResponseEndedAt ? { providerResponseEndedAt: providerResponseEndedAt.toISOString() } : {}),
    ...(providerDuration
      ? {
        providerElapsedMs: providerDuration.elapsedMs,
        ...(providerDuration.monotonicElapsedMs !== undefined
          ? { providerMonotonicElapsedMs: providerDuration.monotonicElapsedMs }
          : {}),
        ...(providerDuration.wallClockDrift ? { providerWallClockDrift: providerDuration.wallClockDrift } : {}),
        gatewayOverheadMs: Math.max(0, totalElapsedMs - providerDuration.elapsedMs),
      }
      : {}),
  };
}

interface DurationEvidence {
  readonly elapsedMs: number;
  readonly monotonicElapsedMs?: number;
  readonly monotonicClockSource?: string;
  readonly wallClockDrift?: WallClockDriftEvidence;
}

function timestampFromInput(value: Date | MonotonicTimestamp): MonotonicTimestamp {
  return value instanceof Date ? { wallTime: value } : value;
}

function timestampFromDate(
  wallTime: Date,
  monotonicNs: bigint | undefined,
  monotonicClockSource: string | undefined,
): MonotonicTimestamp {
  return {
    wallTime,
    ...(monotonicNs !== undefined ? { monotonicNs } : {}),
    ...(monotonicClockSource ? { monotonicClockSource } : {}),
  };
}

function durationEvidence(startedAt: MonotonicTimestamp, endedAt: MonotonicTimestamp): DurationEvidence {
  const wallClockElapsedMs = endedAt.wallTime.getTime() - startedAt.wallTime.getTime();
  if (startedAt.monotonicNs === undefined || endedAt.monotonicNs === undefined) {
    return { elapsedMs: Math.max(0, wallClockElapsedMs) };
  }

  const rawMonotonicElapsedMs = Number(endedAt.monotonicNs - startedAt.monotonicNs) / 1_000_000;
  const monotonicElapsedMs = Math.max(0, rawMonotonicElapsedMs);
  const driftMs = wallClockElapsedMs - monotonicElapsedMs;
  const driftKind = wallClockElapsedMs < 0
    ? "negative_wall_clock_elapsed"
    : Math.abs(driftMs) > WALL_CLOCK_DRIFT_IMPLAUSIBLE_MS
      ? "implausible_wall_clock_drift"
      : undefined;

  return {
    elapsedMs: monotonicElapsedMs,
    monotonicElapsedMs,
    monotonicClockSource: endedAt.monotonicClockSource ?? startedAt.monotonicClockSource ?? MONOTONIC_CLOCK_SOURCE,
    ...(driftKind
      ? {
        wallClockDrift: {
          kind: driftKind,
          wallClockElapsedMs,
          monotonicElapsedMs,
          driftMs,
        },
      }
      : {}),
  };
}

function monotonicDurationFields(duration: DurationEvidence): MonotonicDurationFields {
  return {
    ...(duration.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: duration.monotonicElapsedMs } : {}),
    ...(duration.monotonicClockSource ? { monotonicClockSource: duration.monotonicClockSource } : {}),
    ...(duration.wallClockDrift ? { wallClockDrift: duration.wallClockDrift } : {}),
  };
}

function clientConsumptionTimingFields(
  clientConsumptionTiming: ClientConsumptionTiming | undefined,
): { readonly clientConsumptionEndedAt?: string } {
  return {
    ...(clientConsumptionTiming?.endedAt
      ? { clientConsumptionEndedAt: clientConsumptionTiming.endedAt.toISOString() }
      : {}),
  };
}

function isEvidenceHeader(name: string): boolean {
  return name === "retry-after" ||
    name === "retry-after-ms" ||
    name === "openai-processing-ms" ||
    name === "x-should-retry" ||
    name === "x-request-id" ||
    name === "x-goog-request-id" ||
    name === "request-id" ||
    name === "openai-request-id" ||
    name === "anthropic-request-id" ||
    name.startsWith("x-ratelimit-") ||
    name.startsWith("anthropic-ratelimit-");
}

function camelFieldName(fieldName: string): string {
  return fieldName.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requestBodyHash(body: JsonRecord): string {
  return `${REQUEST_BODY_HASH_ALGORITHM}:${sha256Hex(stableJson(body))}`;
}

function canonicalRequestBodyForHash(
  body: JsonRecord,
  providerSurface: ProviderSurface,
): JsonRecord {
  if (providerSurface === "gemini_generate_content") {
    return sanitizeGeminiGenerateContentPayload(body).payload;
  }
  return body;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
