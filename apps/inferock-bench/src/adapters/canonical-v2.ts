// Copied from apps/proxy/src/adapters/canonical-v2.ts for inferock-bench Track C.
// Reuse approved by .claude/plans/oss-wave-2026-07.md "Track C Reuse Boundary".

import { createHash } from "node:crypto";
import type {
  CanonicalAttemptRecord,
  CanonicalEventV2,
  ProviderName,
} from "@inferock/measure/canonical-event";
import { OPENROUTER_PLANE } from "@inferock/measure/pricing";
import type { AdapterCanonicalInput, AdapterStreamInput } from "./types.js";
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
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: elapsedMs(startedAt, endedAt),
    ...providerTimingFields(startedAt, endedAt, providerTiming),
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

export function recordStreamChunk(capture: StreamTimingCapture, observedAt: Date): void {
  if (!capture.firstEventAt) capture.firstEventAt = observedAt;
  if (!capture.firstByteAt) capture.firstByteAt = observedAt;
  if (capture.previousChunkAt) {
    const gapMs = elapsedMs(capture.previousChunkAt, observedAt);
    capture.maxInterChunkGapMs = Math.max(capture.maxInterChunkGapMs ?? 0, gapMs);
    capture.maxStreamGapMs = Math.max(capture.maxStreamGapMs ?? 0, gapMs);
  }
  capture.previousChunkAt = observedAt;
  capture.lastChunkAt = observedAt;
  capture.chunkCount += 1;
}

export function recordStreamToken(capture: StreamTimingCapture, observedAt: Date): void {
  if (!capture.firstContentDeltaAt) capture.firstContentDeltaAt = observedAt;
  if (!capture.firstTokenAt) capture.firstTokenAt = observedAt;
}

export function streamTiming(
  startedAt: Date,
  endedAt: Date,
  capture: StreamTimingCapture,
  providerTiming?: ProviderTimingBoundary,
): CanonicalEventV2["timing"] {
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: elapsedMs(startedAt, endedAt),
    ...providerTimingFields(startedAt, endedAt, providerTiming),
    ...(capture.firstEventAt ? { firstEventAt: capture.firstEventAt.toISOString() } : {}),
    ...(capture.firstContentDeltaAt ? { firstContentDeltaAt: capture.firstContentDeltaAt.toISOString() } : {}),
    ...(capture.firstByteAt ? { firstByteAt: capture.firstByteAt.toISOString() } : {}),
    ...(capture.firstTokenAt ? { firstTokenAt: capture.firstTokenAt.toISOString() } : {}),
    ...(capture.lastChunkAt ? { lastChunkAt: capture.lastChunkAt.toISOString() } : {}),
    ...(capture.firstEventAt ? { timeToFirstEventMs: elapsedMs(startedAt, capture.firstEventAt) } : {}),
    ...(capture.firstContentDeltaAt ? { timeToFirstContentDeltaMs: elapsedMs(startedAt, capture.firstContentDeltaAt) } : {}),
    ...(capture.firstByteAt ? { timeToFirstByteMs: elapsedMs(startedAt, capture.firstByteAt) } : {}),
    ...(capture.firstTokenAt ? { timeToFirstTokenMs: elapsedMs(startedAt, capture.firstTokenAt) } : {}),
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
  readonly providerRequestStartedAt?: Date;
  readonly providerResponseEndedAt?: Date;
  readonly status: CanonicalAttemptRecord["status"];
  readonly errorClass?: string;
}): CanonicalAttemptRecord {
  return {
    attemptNumber: input.attemptIndex,
    provider: input.provider,
    model: input.model,
    status: input.status,
    timing: canonicalAttemptTiming(input.startedAt, input.endedAt, {
      ...(input.providerRequestStartedAt ? { providerRequestStartedAt: input.providerRequestStartedAt } : {}),
      ...(input.providerResponseEndedAt ? { providerResponseEndedAt: input.providerResponseEndedAt } : {}),
    }),
    ...(input.errorClass ? { errorClass: input.errorClass } : {}),
    finalSelected: true,
  };
}

export function canonicalAttempts(
  input: CanonicalInput,
  provider: ProviderName,
  model: string,
  endedAt: Date,
  status: CanonicalAttemptRecord["status"],
  errorClass?: string,
): CanonicalAttemptRecord[] {
  return [
    ...(input.previousAttempts ?? []),
    finalAttemptRecord({
      provider,
      model,
      attemptIndex: input.attemptIndex,
      startedAt: input.startedAt,
      endedAt,
      ...(input.providerRequestStartedAt ? { providerRequestStartedAt: input.providerRequestStartedAt } : {}),
      ...(input.providerResponseEndedAt ? { providerResponseEndedAt: input.providerResponseEndedAt } : {}),
      status,
      ...(errorClass ? { errorClass } : {}),
    }),
  ];
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
  const stainlessRetryCount = headers.get("x-stainless-retry-count");
  return stainlessRetryCount === null
    ? undefined
    : { "x-stainless-retry-count": stainlessRetryCount };
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
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    latencyMs: elapsedMs(startedAt, endedAt),
    ...providerTimingFields(startedAt, endedAt, providerTiming),
  };
}

function providerTimingFields(
  startedAt: Date,
  endedAt: Date,
  providerTiming: ProviderTimingBoundary | undefined,
): Pick<
  CanonicalEventV2["timing"],
  "providerRequestStartedAt" | "providerResponseEndedAt" | "providerElapsedMs" | "gatewayOverheadMs"
> {
  const providerRequestStartedAt = providerTiming?.providerRequestStartedAt;
  const providerResponseEndedAt = providerTiming?.providerResponseEndedAt;
  return {
    ...(providerRequestStartedAt ? { providerRequestStartedAt: providerRequestStartedAt.toISOString() } : {}),
    ...(providerResponseEndedAt ? { providerResponseEndedAt: providerResponseEndedAt.toISOString() } : {}),
    ...(providerRequestStartedAt && providerResponseEndedAt
      ? {
        providerElapsedMs: elapsedMs(providerRequestStartedAt, providerResponseEndedAt),
        gatewayOverheadMs: Math.max(
          0,
          elapsedMs(startedAt, endedAt) - elapsedMs(providerRequestStartedAt, providerResponseEndedAt),
        ),
      }
      : {}),
  };
}

function elapsedMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
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
