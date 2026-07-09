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
    return {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        latencyMs: elapsedMs(startedAt, endedAt),
        ...providerTimingFields(startedAt, endedAt, providerTiming),
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
export function recordStreamChunk(capture, observedAt) {
    if (!capture.firstEventAt)
        capture.firstEventAt = observedAt;
    if (!capture.firstByteAt)
        capture.firstByteAt = observedAt;
    if (capture.previousChunkAt) {
        const gapMs = elapsedMs(capture.previousChunkAt, observedAt);
        capture.maxInterChunkGapMs = Math.max(capture.maxInterChunkGapMs ?? 0, gapMs);
        capture.maxStreamGapMs = Math.max(capture.maxStreamGapMs ?? 0, gapMs);
    }
    capture.previousChunkAt = observedAt;
    capture.lastChunkAt = observedAt;
    capture.chunkCount += 1;
}
export function recordStreamToken(capture, observedAt) {
    if (!capture.firstContentDeltaAt)
        capture.firstContentDeltaAt = observedAt;
    if (!capture.firstTokenAt)
        capture.firstTokenAt = observedAt;
}
export function streamTiming(startedAt, endedAt, capture, providerTiming) {
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
export function finalAttemptRecord(input) {
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
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
        ...(input.sanitizedHeaders ? { sanitizedHeaders: input.sanitizedHeaders } : {}),
        finalSelected: true,
    };
}
export function canonicalAttempts(input, provider, model, endedAt, status, errorClass) {
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
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
            statusCode: input.statusCode,
            ...(providerRequestId ? { providerRequestId } : {}),
            ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
        }),
    ];
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
            ...(input.providerRequestStartedAt ? { providerRequestStartedAt: input.providerRequestStartedAt } : {}),
            ...(input.providerResponseEndedAt ? { providerResponseEndedAt: input.providerResponseEndedAt } : {}),
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
    const stainlessRetryCount = headers.get("x-stainless-retry-count");
    return stainlessRetryCount === null
        ? undefined
        : { "x-stainless-retry-count": stainlessRetryCount };
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
    return {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        latencyMs: elapsedMs(startedAt, endedAt),
        ...providerTimingFields(startedAt, endedAt, providerTiming),
    };
}
function providerTimingFields(startedAt, endedAt, providerTiming) {
    const providerRequestStartedAt = providerTiming?.providerRequestStartedAt;
    const providerResponseEndedAt = providerTiming?.providerResponseEndedAt;
    return {
        ...(providerRequestStartedAt ? { providerRequestStartedAt: providerRequestStartedAt.toISOString() } : {}),
        ...(providerResponseEndedAt ? { providerResponseEndedAt: providerResponseEndedAt.toISOString() } : {}),
        ...(providerRequestStartedAt && providerResponseEndedAt
            ? {
                providerElapsedMs: elapsedMs(providerRequestStartedAt, providerResponseEndedAt),
                gatewayOverheadMs: Math.max(0, elapsedMs(startedAt, endedAt) - elapsedMs(providerRequestStartedAt, providerResponseEndedAt)),
            }
            : {}),
    };
}
function elapsedMs(startedAt, endedAt) {
    return Math.max(0, endedAt.getTime() - startedAt.getTime());
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