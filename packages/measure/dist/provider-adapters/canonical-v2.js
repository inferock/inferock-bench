import { createHash, createHmac } from "node:crypto";
import { REQUEST_SECRET_DIGEST_ALGORITHM, REQUEST_SECRET_DIGEST_CAPTURE_VERSION, REQUEST_SECRET_DIGEST_MAX_PER_EVENT, REQUEST_SECRET_DIGEST_SCOPE, findSecuritySecretMatchesInValue, requestSecretDigestPayload, } from "../security-secrets.js";
import { asRecord, booleanValue, isRecord, stringValue, } from "./record.js";
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
];
const OPENAI_RESPONSES_GENERATION_FIELD_NAMES = [
    "temperature",
    "top_p",
    "max_tokens",
    "max_output_tokens",
    "max_tool_calls",
    "truncation",
    "reasoning",
    "text",
    "response_format",
    "service_tier",
    "parallel_tool_calls",
    "tool_choice",
    "store",
    "background",
    "stream",
    "stream_options",
];
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
];
const SCHEMA_ABSENT_HASH = "schema_absent";
const REQUEST_BODY_HASH_ALGORITHM = "sha256";
const REQUEST_BODY_HASH_CANONICALIZATION = "normalized_json_v1";
const MONOTONIC_CLOCK_SOURCE = "process.hrtime.bigint";
const WALL_CLOCK_DRIFT_IMPLAUSIBLE_MS = 1_000;
export function captureMonotonicTimestamp() {
    return {
        wallTime: new Date(),
        monotonicNs: process.hrtime.bigint(),
        monotonicClockSource: MONOTONIC_CLOCK_SOURCE,
    };
}
export function canonicalRequest(input, provider, providerSurface) {
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
        bodyHash: requestBodyHash(input.requestBody),
        bodyHashAlgorithm: REQUEST_BODY_HASH_ALGORITHM,
        bodyHashCanonicalization: REQUEST_BODY_HASH_CANONICALIZATION,
        ...(input.retryCorrelationId ? { retryCorrelationId: input.retryCorrelationId } : {}),
        ...(input.expectCompletion !== undefined ? { expectCompletion: input.expectCompletion } : {}),
        ...(input.route ? { route: input.route } : {}),
        ...(input.workloadClass ? { workloadClass: input.workloadClass } : {}),
        ...(input.outputSchemaVersion ? { outputSchemaVersion: input.outputSchemaVersion } : {}),
        ...(input.factualityContract ? { factualityContract: input.factualityContract } : {}),
        ...extractRequestFields(input.requestBody, providerSurface),
        ...(input.requestSecretDigestConfig
            ? {
                securityContext: requestSecurityContext(input, input.requestSecretDigestConfig),
            }
            : {}),
        ...(requestHeaders ? { sanitizedHeaders: requestHeaders } : {}),
    };
}
export function extractFromOpenAiChat(body) {
    const generation = {
        ...(optionalGeneration(body, OPENAI_GENERATION_FIELD_NAMES).generation ?? {}),
        ...openAiModerationRequestEvidence(body),
    };
    return {
        ...(Object.keys(generation).length > 0 ? { generation } : {}),
        ...optionalToolDeclarations(body, "chat_completions", openAiToolDeclaration),
    };
}
export function extractFromOpenAiResponses(body) {
    const generation = {
        ...(optionalGeneration(body, OPENAI_RESPONSES_GENERATION_FIELD_NAMES).generation ?? {}),
        ...openAiModerationRequestEvidence(body),
    };
    return {
        ...(Object.keys(generation).length > 0 ? { generation } : {}),
        ...optionalToolDeclarations(body, "openai_responses", openAiResponsesToolDeclaration),
    };
}
export function extractFromAnthropicMessages(body) {
    const generation = {
        ...(optionalGeneration(body, ANTHROPIC_GENERATION_FIELD_NAMES).generation ?? {}),
        ...anthropicCitationRequestEvidence(body),
    };
    return {
        ...(Object.keys(generation).length > 0 ? { generation } : {}),
        ...optionalToolDeclarations(body, "anthropic_messages", anthropicToolDeclaration),
    };
}
export function anthropicCitationRequestEvidence(body) {
    const citationsEnabled = anthropicCitationsRequested(body);
    const structuredOutputRequested = anthropicStructuredOutputRequested(body);
    return {
        ...(citationsEnabled ? { citationsEnabled } : {}),
        ...(structuredOutputRequested ? { structuredOutputRequested } : {}),
        ...(citationsEnabled && structuredOutputRequested
            ? { citationsStructuredOutputIncompatible: true }
            : {}),
    };
}
export function canonicalTiming(startedAt, endedAt, terminalStatus, providerTiming) {
    const totalDuration = durationEvidence(timestampFromDate(startedAt, providerTiming?.startedAtMonotonicNs, providerTiming?.monotonicClockSource), timestampFromDate(endedAt, providerTiming?.endedAtMonotonicNs, providerTiming?.monotonicClockSource));
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
export function createStreamTimingCapture() {
    return {
        chunkCount: 0,
        terminalStatus: "unknown",
    };
}
export function recordStreamByte(capture, observedAt) {
    const observed = timestampFromInput(observedAt);
    if (!capture.firstByteAt)
        capture.firstByteAt = observed;
}
export function recordParsedSseEvent(capture, observedAt) {
    const observed = timestampFromInput(observedAt);
    if (!capture.firstEventAt)
        capture.firstEventAt = observed;
    if (capture.previousChunkAt) {
        const gapMs = durationEvidence(capture.previousChunkAt, observed).elapsedMs;
        capture.maxInterChunkGapMs = Math.max(capture.maxInterChunkGapMs ?? 0, gapMs);
        capture.maxStreamGapMs = Math.max(capture.maxStreamGapMs ?? 0, gapMs);
    }
    capture.previousChunkAt = observed;
    capture.lastChunkAt = observed;
    capture.chunkCount += 1;
}
export function recordStreamContentDelta(capture, observedAt) {
    const observed = timestampFromInput(observedAt);
    if (!capture.firstContentDeltaAt)
        capture.firstContentDeltaAt = observed;
    if (!capture.firstTokenAt)
        capture.firstTokenAt = observed;
}
export function streamTiming(startedAt, endedAt, capture, providerTiming) {
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
export function finalAttemptRecord(input) {
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
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
        ...(input.sanitizedHeaders ? { sanitizedHeaders: input.sanitizedHeaders } : {}),
        finalSelected: true,
    };
}
export function canonicalAttempts(input, provider, model, endedAt, status, errorClass) {
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
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
            statusCode: input.statusCode,
            ...(providerRequestId ? { providerRequestId } : {}),
            ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
        }),
    ];
}
function clientConsumptionTimingFromInput(input) {
    return "clientConsumptionTiming" in input ? input.clientConsumptionTiming : undefined;
}
export function retryAttemptRecord(input) {
    const providerRequestId = input.headers ? providerRequestIdFromHeaders(input.headers) : undefined;
    const sanitizedHeaders = input.headers ? sanitizedProviderHeaders(input.headers) : undefined;
    return {
        attemptNumber: input.attemptIndex,
        provider: input.provider,
        model: input.model,
        status: "retry",
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
        }),
        ...(input.errorClass ? { errorClass: input.errorClass } : {}),
        retryReason: input.retryReason,
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(providerRequestId ? { providerRequestId } : {}),
        ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
        finalSelected: false,
    };
}
export function providerRequestIdFromHeaders(headers) {
    return headers.get("x-request-id") ??
        headers.get("request-id") ??
        headers.get("openai-request-id") ??
        headers.get("anthropic-request-id") ??
        undefined;
}
export function sanitizedProviderHeaders(headers) {
    const sanitized = {};
    for (const [name, value] of headers.entries()) {
        const normalized = name.toLowerCase();
        if (isEvidenceHeader(normalized))
            sanitized[normalized] = value;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
function sanitizedRequestHeaders(headers) {
    if (!headers)
        return undefined;
    const sanitized = {};
    for (const name of [
        "x-stainless-retry-count",
        "x-inferock-request-origin",
        "x-inferock-abort-origin",
    ]) {
        const value = headers.get(name);
        if (value !== null)
            sanitized[name] = value;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
function extractRequestFields(body, providerSurface) {
    if (providerSurface === "chat_completions")
        return extractFromOpenAiChat(body);
    if (providerSurface === "openai_responses")
        return extractFromOpenAiResponses(body);
    return extractFromAnthropicMessages(body);
}
function optionalGeneration(body, fieldNames) {
    const generation = {};
    for (const fieldName of fieldNames) {
        if (body[fieldName] !== undefined)
            generation[camelFieldName(fieldName)] = body[fieldName];
    }
    return Object.keys(generation).length > 0 ? { generation } : {};
}
function anthropicCitationsRequested(body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return messages.some((message) => {
        if (!isRecord(message))
            return false;
        return contentContainsEnabledCitations(message.content);
    });
}
function contentContainsEnabledCitations(content) {
    if (Array.isArray(content))
        return content.some(contentContainsEnabledCitations);
    if (!isRecord(content))
        return false;
    const citations = asRecord(content.citations);
    if (booleanValue(citations?.enabled) === true)
        return true;
    const source = asRecord(content.source);
    return contentContainsEnabledCitations(source?.content);
}
function anthropicStructuredOutputRequested(body) {
    const outputConfig = asRecord(body.output_config);
    return Object.prototype.hasOwnProperty.call(body, "output_format") ||
        Object.prototype.hasOwnProperty.call(body, "response_format") ||
        (outputConfig !== undefined && Object.prototype.hasOwnProperty.call(outputConfig, "format"));
}
function optionalToolDeclarations(body, providerSurface, mapTool) {
    const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : [];
    const declarations = tools
        .map((tool) => mapTool(tool, body, providerSurface))
        .filter((tool) => tool !== null);
    return { toolDeclarations: declarations };
}
function openAiToolDeclaration(tool, body, providerSurface) {
    const functionTool = asRecord(tool.function);
    const name = stringValue(functionTool?.name) ?? stringValue(tool.name);
    if (!name)
        return null;
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
function openAiResponsesToolDeclaration(tool, body, providerSurface) {
    if (tool.type !== "function")
        return null;
    const name = stringValue(tool.name);
    if (!name)
        return null;
    const schema = Object.prototype.hasOwnProperty.call(tool, "parameters")
        ? tool.parameters
        : undefined;
    const strict = booleanValue(tool.strict);
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
function anthropicToolDeclaration(tool, body, providerSurface) {
    const functionTool = asRecord(tool.function);
    const name = stringValue(tool.name) ?? stringValue(functionTool?.name);
    if (!name)
        return null;
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
function capturedOpenAiToolSchema(tool, functionTool) {
    if (functionTool && Object.prototype.hasOwnProperty.call(functionTool, "parameters")) {
        return functionTool.parameters;
    }
    if (Object.prototype.hasOwnProperty.call(tool, "parameters"))
        return tool.parameters;
    if (Object.prototype.hasOwnProperty.call(tool, "input_schema"))
        return tool.input_schema;
    if (Object.prototype.hasOwnProperty.call(tool, "schema"))
        return tool.schema;
    return undefined;
}
function capturedAnthropicToolSchema(tool, functionTool) {
    if (Object.prototype.hasOwnProperty.call(tool, "input_schema"))
        return tool.input_schema;
    if (Object.prototype.hasOwnProperty.call(tool, "schema"))
        return tool.schema;
    if (functionTool && Object.prototype.hasOwnProperty.call(functionTool, "parameters")) {
        return functionTool.parameters;
    }
    return undefined;
}
function anthropicParallelToolCalls(body) {
    const openAiCompatibleValue = booleanValue(body.parallel_tool_calls);
    if (openAiCompatibleValue !== undefined)
        return openAiCompatibleValue;
    const toolChoice = asRecord(body.tool_choice);
    const disabled = booleanValue(toolChoice?.disable_parallel_tool_use);
    return disabled === undefined ? true : !disabled;
}
function openAiParallelToolCalls(body) {
    return booleanValue(body.parallel_tool_calls) ?? true;
}
function openAiModerationRequestEvidence(body) {
    const moderation = asRecord(body.moderation);
    const model = stringValue(moderation?.model);
    return model ? { moderation: { model } } : {};
}
function canonicalAttemptTiming(startedAt, endedAt, providerTiming) {
    const totalDuration = durationEvidence(timestampFromDate(startedAt, providerTiming?.startedAtMonotonicNs, providerTiming?.monotonicClockSource), timestampFromDate(endedAt, providerTiming?.endedAtMonotonicNs, providerTiming?.monotonicClockSource));
    return {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        latencyMs: totalDuration.elapsedMs,
        ...monotonicDurationFields(totalDuration),
        ...providerTimingFields(totalDuration.elapsedMs, providerTiming),
        ...clientConsumptionTimingFields(providerTiming?.clientConsumptionTiming),
    };
}
function providerTimingFields(totalElapsedMs, providerTiming) {
    const providerRequestStartedAt = providerTiming?.providerRequestStartedAt;
    const providerResponseEndedAt = providerTiming?.providerResponseEndedAt;
    const providerDuration = providerRequestStartedAt && providerResponseEndedAt
        ? durationEvidence(timestampFromDate(providerRequestStartedAt, providerTiming?.providerRequestStartedAtMonotonicNs, providerTiming?.monotonicClockSource), timestampFromDate(providerResponseEndedAt, providerTiming?.providerResponseEndedAtMonotonicNs, providerTiming?.monotonicClockSource))
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
function timestampFromInput(value) {
    return value instanceof Date ? { wallTime: value } : value;
}
function timestampFromDate(wallTime, monotonicNs, monotonicClockSource) {
    return {
        wallTime,
        ...(monotonicNs !== undefined ? { monotonicNs } : {}),
        ...(monotonicClockSource ? { monotonicClockSource } : {}),
    };
}
function durationEvidence(startedAt, endedAt) {
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
function monotonicDurationFields(duration) {
    return {
        ...(duration.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: duration.monotonicElapsedMs } : {}),
        ...(duration.monotonicClockSource ? { monotonicClockSource: duration.monotonicClockSource } : {}),
        ...(duration.wallClockDrift ? { wallClockDrift: duration.wallClockDrift } : {}),
    };
}
function clientConsumptionTimingFields(clientConsumptionTiming) {
    return {
        ...(clientConsumptionTiming?.endedAt
            ? { clientConsumptionEndedAt: clientConsumptionTiming.endedAt.toISOString() }
            : {}),
    };
}
function isEvidenceHeader(name) {
    return name === "retry-after" ||
        name === "retry-after-ms" ||
        name === "openai-processing-ms" ||
        name === "x-should-retry" ||
        name === "x-request-id" ||
        name === "request-id" ||
        name === "openai-request-id" ||
        name === "anthropic-request-id" ||
        name.startsWith("x-ratelimit-") ||
        name.startsWith("anthropic-ratelimit-");
}
function camelFieldName(fieldName) {
    return fieldName.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        const entries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function compareCodeUnits(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
function requestBodyHash(body) {
    return `${REQUEST_BODY_HASH_ALGORITHM}:${sha256Hex(stableJson(body))}`;
}
function sha256Hex(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
function requestSecurityContext(input, config) {
    const matches = findSecuritySecretMatchesInValue(input.requestBody, "request.body");
    const retained = matches.slice(0, REQUEST_SECRET_DIGEST_MAX_PER_EVENT);
    const truncated = matches.length > retained.length;
    return {
        captureVersion: REQUEST_SECRET_DIGEST_CAPTURE_VERSION,
        digestKeyId: config.digestKeyId,
        requestSecretDigests: retained.map((match) => ({
            kind: "secret",
            category: match.category,
            fieldPath: match.fieldPath,
            matchLength: match.matchLength,
            digest: requestSecretDigest(input, config, match.category, match.span, match.patternVersion),
            digestAlgorithm: REQUEST_SECRET_DIGEST_ALGORITHM,
            digestKeyId: config.digestKeyId,
            digestScope: REQUEST_SECRET_DIGEST_SCOPE,
            patternVersion: match.patternVersion,
        })),
        captureComplete: !truncated,
        truncated,
    };
}
function requestSecretDigest(input, config, category, span, patternVersion) {
    const digest = createHmac("sha256", config.digestKey)
        .update(requestSecretDigestPayload({
        tenantId: input.tenantId,
        requestId: input.requestId,
        attemptIndex: input.attemptIndex,
        patternVersion,
        category,
        span,
    }), "utf8")
        .digest("hex");
    return `${REQUEST_SECRET_DIGEST_ALGORITHM}:${config.digestKeyId}:${digest}`;
}
//# sourceMappingURL=canonical-v2.js.map