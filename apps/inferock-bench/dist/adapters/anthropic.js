// Copied from apps/proxy/src/adapters/anthropic.ts for inferock-bench Track C.
// Reuse approved by .claude/plans/oss-wave-2026-07.md "Track C Reuse Boundary".
import { canonicalAttempts, canonicalRequest, canonicalTiming, createStreamTimingCapture, providerRequestIdFromHeaders, recordStreamChunk, recordStreamToken, sanitizedProviderHeaders, streamTiming, } from "./canonical-v2.js";
import { asRecord, collectRateLimitHeaders, compactRecord, isRecord, joinUrl, numberValue, parseJsonRecord, stringValue, textFromContent, } from "../record.js";
import { SseAccumulator } from "../sse.js";
const DEFAULT_MAX_TOKENS = 1024;
export const ANTHROPIC_VERSION = "2023-06-01";
/**
 * @contract-id anthropic-adapter
 */
export const anthropicAdapter = {
    provider: "anthropic",
    buildRequest(input) {
        return {
            url: joinUrl(input.baseUrl, "/messages"),
            init: {
                method: "POST",
                headers: {
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                    "x-api-key": input.apiKey,
                },
                body: JSON.stringify(openAiToAnthropicRequest(input.body)),
            },
        };
    },
    toCanonicalEvent(input) {
        return mapAnthropicResponseToCanonical(input);
    },
    observeStream(input) {
        return observeAnthropicStream(input);
    },
};
export function mapAnthropicResponseToCanonical(input) {
    const parsed = parseJsonRecord(input.responseBody);
    const rateLimitHeaders = collectRateLimitHeaders(input.headers);
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    if (!parsed || input.statusCode >= 400 || isRecord(parsed.error)) {
        const error = asRecord(parsed?.error);
        const errorType = stringValue(error?.type) ?? stringValue(parsed?.type) ?? "provider_error";
        const errorCode = stringValue(error?.code);
        const errorMessage = stringValue(error?.message) ?? "";
        const providerModel = stringValue(parsed?.model);
        const servedModel = providerModel ?? input.requestModel;
        const servedModelSource = providerModel ? "provider_response" : "adapter_fallback";
        const errorClass = `http_${input.statusCode}:${errorType}`;
        return {
            rateLimitHeaders,
            event: {
                schemaVersion: "v2",
                request: canonicalRequest(input, "anthropic", "anthropic_messages"),
                response: {
                    statusCode: input.statusCode,
                    finishReason: "error",
                    content: errorMessage,
                    servedModel,
                    servedModelSource,
                    ...(providerRequestId ? { providerRequestId } : {}),
                    ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                    rawErrorType: errorType,
                    ...(errorCode ? { rawErrorCode: errorCode } : {}),
                    providerSafety: anthropicErrorSafety(errorType, errorCode),
                    errorClass,
                },
                usage: anthropicUsageToCanonical({ input: 0, output: 0 }),
                timing: canonicalTiming(input.startedAt, input.endedAt, "error", input),
                attempts: canonicalAttempts(input, "anthropic", servedModel, input.endedAt, "error", errorClass),
            },
        };
    }
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const toolCalls = content.filter((item) => {
        return isRecord(item) && item.type === "tool_use";
    });
    const usage = readAnthropicUsage(asRecord(parsed.usage));
    const providerModel = stringValue(parsed.model);
    const servedModel = providerModel ?? input.requestModel;
    const servedModelSource = providerModel ? "provider_response" : "adapter_fallback";
    const providerResponseId = stringValue(parsed.id);
    const stopDetails = asRecord(parsed.stop_details);
    return {
        rateLimitHeaders,
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, "anthropic", "anthropic_messages"),
            response: {
                statusCode: input.statusCode,
                finishReason: stringValue(parsed.stop_reason) ?? "",
                content: textFromContent(content),
                servedModel,
                servedModelSource,
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                ...(toolCalls.length > 0 ? { rawToolCalls: toolCalls } : {}),
                ...(providerRequestId ? { providerRequestId } : {}),
                ...(providerResponseId ? { providerResponseId, rawObjectId: providerResponseId } : {}),
                ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                ...(stopDetails ? { stopDetails } : {}),
                ...optionalAnthropicSafety(parsed),
            },
            usage: anthropicUsageToCanonical(usage),
            timing: canonicalTiming(input.startedAt, input.endedAt, "complete", input),
            attempts: canonicalAttempts(input, "anthropic", servedModel, input.endedAt, "success"),
        },
    };
}
function observeAnthropicStream(input) {
    const decoder = new TextDecoder();
    const parser = new SseAccumulator();
    const state = {
        content: "",
        finishReason: "",
        usage: { input: 0, output: 0 },
        toolCalls: new Map(),
        observedTerminalMarker: false,
        providerSafety: [],
        timing: createStreamTimingCapture(),
    };
    return input.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            const observedAt = new Date();
            let observedContentDelta = false;
            for (const message of parser.push(decoder.decode(chunk, { stream: true }))) {
                observedContentDelta = applyAnthropicStreamMessage(state, message.data, input.statusCode, observedAt) || observedContentDelta;
            }
            if (observedContentDelta)
                recordStreamToken(state.timing, observedAt);
            controller.enqueue(chunk);
        },
        flush() {
            const observedAt = new Date();
            const tail = decoder.decode();
            for (const message of [...parser.push(tail), ...parser.end()]) {
                if (applyAnthropicStreamMessage(state, message.data, input.statusCode, observedAt)) {
                    recordStreamToken(state.timing, observedAt);
                }
            }
            if (state.timing.terminalStatus === "unknown") {
                if (state.errorClass || input.statusCode >= 400) {
                    state.timing.terminalStatus = "error";
                }
                else {
                    state.timing.terminalStatus = state.observedTerminalMarker ? "complete" : "aborted";
                }
            }
            input.onTerminal(finalizeAnthropicStream(input, state));
        },
    }));
}
function applyAnthropicStreamMessage(state, data, statusCode, observedAt) {
    const parsed = parseJsonRecord(data);
    if (!parsed)
        return false;
    if (parsed.type === "ping")
        return false;
    recordStreamChunk(state.timing, observedAt);
    if (isRecord(parsed.error)) {
        const errorType = stringValue(parsed.error.type) ?? "provider_error";
        const errorCode = stringValue(parsed.error.code);
        state.errorClass = `http_${statusCode}:${errorType}`;
        state.rawErrorType = errorType;
        state.rawErrorCode = errorCode;
        state.finishReason = "error";
        state.providerSafety.push(...(anthropicErrorSafety(errorType, errorCode) ?? []));
        state.timing.terminalStatus = "error";
        return false;
    }
    if (parsed.type === "message_stop") {
        state.observedTerminalMarker = true;
        state.timing.terminalStatus = state.errorClass ? "error" : "complete";
        return false;
    }
    const message = asRecord(parsed.message);
    const messageId = stringValue(message?.id);
    if (messageId)
        state.providerResponseId = messageId;
    const model = stringValue(message?.model);
    if (model)
        state.model = model;
    const messageUsage = readAnthropicUsage(asRecord(message?.usage));
    if (messageUsage.raw)
        state.usage = mergeAnthropicUsage(state.usage, messageUsage);
    applyAnthropicToolCallStreamMessage(state.toolCalls, parsed);
    const delta = asRecord(parsed.delta);
    const text = stringValue(delta?.text);
    const observedTextDelta = delta?.type === "text_delta" && Boolean(text);
    if (observedTextDelta && text)
        state.content += text;
    const stopReason = stringValue(delta?.stop_reason);
    const stopDetails = asRecord(delta?.stop_details) ?? asRecord(parsed.stop_details);
    if (stopDetails)
        state.stopDetails = stopDetails;
    if (stopReason) {
        state.finishReason = stopReason;
        state.providerSafety.push(...(anthropicSafety(stopReason, stopDetails) ?? []));
    }
    const usage = readAnthropicUsage(asRecord(parsed.usage));
    if (usage.raw)
        state.usage = mergeAnthropicUsage(state.usage, usage);
    return observedTextDelta;
}
function finalizeAnthropicStream(input, state) {
    const endedAt = new Date();
    const servedModel = state.model ?? input.requestModel;
    const servedModelSource = state.model ? "provider_response" : "adapter_fallback";
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    const terminalStatus = state.errorClass || input.statusCode >= 400 ? "error" : "success";
    const toolCalls = anthropicToolCallsFromAccumulators(state.toolCalls);
    const response = {
        statusCode: input.statusCode,
        finishReason: state.finishReason,
        content: state.content,
        servedModel,
        servedModelSource,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(toolCalls.length > 0 ? { rawToolCalls: toolCalls } : {}),
        ...(providerRequestId ? { providerRequestId } : {}),
        ...(state.providerResponseId ? { providerResponseId: state.providerResponseId, rawObjectId: state.providerResponseId } : {}),
        ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
        ...(state.stopDetails ? { stopDetails: state.stopDetails } : {}),
        ...(state.rawErrorType ? { rawErrorType: state.rawErrorType } : {}),
        ...(state.rawErrorCode ? { rawErrorCode: state.rawErrorCode } : {}),
        ...(state.providerSafety.length > 0 ? { providerSafety: state.providerSafety } : {}),
        ...(state.errorClass ? { errorClass: state.errorClass } : {}),
    };
    return {
        rateLimitHeaders: collectRateLimitHeaders(input.headers),
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, "anthropic", "anthropic_messages"),
            response,
            usage: anthropicUsageToCanonical(state.usage),
            timing: streamTiming(input.startedAt, endedAt, state.timing, { ...input, providerResponseEndedAt: endedAt }),
            attempts: canonicalAttempts({ ...input, providerResponseEndedAt: endedAt }, "anthropic", servedModel, endedAt, terminalStatus, state.errorClass),
        },
    };
}
function applyAnthropicToolCallStreamMessage(accumulators, parsed) {
    const messageType = stringValue(parsed.type);
    const index = numberValue(parsed.index);
    if (index === undefined)
        return false;
    if (messageType === "content_block_start") {
        const contentBlock = asRecord(parsed.content_block);
        if (contentBlock?.type !== "tool_use")
            return false;
        const accumulator = accumulators.get(index) ?? {
            index,
            inputJsonPartials: [],
        };
        const id = stringValue(contentBlock.id);
        if (id)
            accumulator.id = id;
        const name = stringValue(contentBlock.name);
        if (name)
            accumulator.name = name;
        if (Object.prototype.hasOwnProperty.call(contentBlock, "input")) {
            accumulator.input = contentBlock.input;
        }
        accumulators.set(index, accumulator);
        return true;
    }
    if (messageType === "content_block_stop") {
        const accumulator = accumulators.get(index);
        if (!accumulator)
            return false;
        accumulator.stopped = true;
        return true;
    }
    if (messageType !== "content_block_delta")
        return false;
    const delta = asRecord(parsed.delta);
    if (delta?.type !== "input_json_delta")
        return false;
    const partialJson = stringValue(delta.partial_json);
    if (partialJson === undefined)
        return false;
    const accumulator = accumulators.get(index) ?? {
        index,
        inputJsonPartials: [],
    };
    accumulator.inputJsonPartials.push(partialJson);
    accumulators.set(index, accumulator);
    return true;
}
function anthropicToolCallsFromAccumulators(accumulators) {
    return [...accumulators.values()]
        .sort((left, right) => left.index - right.index)
        .map(anthropicToolCallFromAccumulator);
}
function anthropicToolCallFromAccumulator(accumulator) {
    const base = {
        type: "tool_use",
        index: accumulator.index,
        ...(accumulator.id ? { id: accumulator.id } : {}),
        ...(accumulator.name ? { name: accumulator.name } : {}),
        ...(accumulator.stopped ? { contentBlockStopped: true } : {}),
    };
    if (accumulator.inputJsonPartials.length === 0) {
        if (accumulator.input !== undefined)
            base.input = accumulator.input;
        return base;
    }
    const inputJson = accumulator.inputJsonPartials.join("");
    const inputParseResult = parseResult(inputJson);
    return {
        ...base,
        ...(inputParseResult.ok === true ? { input: JSON.parse(inputJson) } : {}),
        inputJson,
        inputJsonPartials: accumulator.inputJsonPartials,
        inputParseResult,
    };
}
function parseResult(text) {
    try {
        JSON.parse(text);
        return { ok: true };
    }
    catch {
        return { ok: false, reason: "invalid_json" };
    }
}
function openAiToAnthropicRequest(body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemMessages = [];
    const anthropicMessages = [];
    for (const message of messages) {
        if (!isRecord(message))
            continue;
        const role = stringValue(message.role);
        const content = normalizeAnthropicContent(message.content);
        if (role === "system") {
            const systemText = textFromContent(content);
            if (systemText)
                systemMessages.push(systemText);
            continue;
        }
        if (role === "user" || role === "assistant") {
            anthropicMessages.push({ role, content });
        }
    }
    const maxTokens = numberValue(body.max_tokens)
        ?? numberValue(body.max_completion_tokens)
        ?? DEFAULT_MAX_TOKENS;
    const model = stringValue(body.model);
    return compactRecord({
        model: body.model,
        messages: anthropicMessages,
        system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
        max_tokens: maxTokens,
        stream: body.stream,
        // Anthropic documents unsupported temperature on Claude 4.7+/5-compatible Messages models.
        // https://docs.anthropic.com/en/api/prompt-validation
        temperature: isAnthropicTemperatureUnsupportedModel(model) ? undefined : body.temperature,
        top_p: body.top_p,
        stop_sequences: body.stop,
        tools: body.tools,
        tool_choice: body.tool_choice,
    });
}
function isAnthropicTemperatureUnsupportedModel(model) {
    if (!model)
        return false;
    return /^claude-[a-z]+-5(?:-|$)/.test(model) ||
        /^claude-[a-z]+-4-(?:[7-9]|\d{2,})(?:-|$)/.test(model);
}
function normalizeAnthropicContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content.map((item) => {
        if (!isRecord(item))
            return item;
        if (item.type === "text") {
            return { type: "text", text: stringValue(item.text) ?? "" };
        }
        return item;
    });
}
function readAnthropicUsage(usage) {
    const outputDetails = asRecord(usage?.output_tokens_details);
    const cacheCreation = asRecord(usage?.cache_creation);
    return {
        input: numberValue(usage?.input_tokens) ?? 0,
        output: numberValue(usage?.output_tokens) ?? 0,
        cacheRead: numberValue(usage?.cache_read_input_tokens),
        cacheCreation: numberValue(usage?.cache_creation_input_tokens),
        cacheCreationEphemeral5m: numberValue(cacheCreation?.ephemeral_5m_input_tokens),
        cacheCreationEphemeral1h: numberValue(cacheCreation?.ephemeral_1h_input_tokens),
        thinkingTokens: numberValue(outputDetails?.thinking_tokens),
        serviceTier: stringValue(usage?.service_tier),
        inferenceGeo: stringValue(usage?.inference_geo),
        iterations: numberValue(usage?.iterations),
        ...(usage ? { raw: usage } : {}),
    };
}
function mergeAnthropicUsage(current, next) {
    return {
        input: next.input > 0 ? next.input : current.input,
        output: next.output > 0 ? next.output : current.output,
        cacheRead: next.cacheRead ?? current.cacheRead,
        cacheCreation: next.cacheCreation ?? current.cacheCreation,
        cacheCreationEphemeral5m: next.cacheCreationEphemeral5m ?? current.cacheCreationEphemeral5m,
        cacheCreationEphemeral1h: next.cacheCreationEphemeral1h ?? current.cacheCreationEphemeral1h,
        thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
        serviceTier: next.serviceTier ?? current.serviceTier,
        inferenceGeo: next.inferenceGeo ?? current.inferenceGeo,
        iterations: next.iterations ?? current.iterations,
        ...mergeAnthropicRawUsage(current.raw, next.raw),
    };
}
function mergeAnthropicRawUsage(current, next) {
    if (!current && !next)
        return {};
    return { raw: { ...(current ?? {}), ...(next ?? {}) } };
}
function anthropicUsageToCanonical(usage) {
    const cache = compactRecord({
        read: usage.cacheRead,
        creation: usage.cacheCreation,
    });
    return {
        input: usage.input,
        output: usage.output,
        ...(Object.keys(cache).length > 0 ? { cache } : {}),
        ...(usage.raw ? { raw: usage.raw } : {}),
        categories: anthropicUsageCategories(usage),
        usageSource: usage.raw ? "provider" : "missing",
        ...(usage.serviceTier ? { serviceTier: usage.serviceTier } : {}),
        ...(usage.inferenceGeo ? { inferenceGeo: usage.inferenceGeo } : {}),
        ...(usage.iterations !== undefined ? { iterations: usage.iterations } : {}),
    };
}
function anthropicUsageCategories(usage) {
    return [
        { category: "input", tokens: usage.input, sourceField: "input_tokens" },
        { category: "output", tokens: usage.output, sourceField: "output_tokens" },
        ...optionalCategory("cached", usage.cacheRead, "cache_read_input_tokens"),
        ...optionalCategory("anthropic_cache_creation", usage.cacheCreation, "cache_creation_input_tokens"),
        ...optionalCategory("reasoning", usage.thinkingTokens, "output_tokens_details.thinking_tokens"),
        ...providerSpecificCategories("anthropic", usage.raw),
    ];
}
function optionalAnthropicSafety(parsed) {
    const stopReason = stringValue(parsed.stop_reason);
    const providerSafety = stopReason
        ? anthropicSafety(stopReason, asRecord(parsed.stop_details))
        : undefined;
    return providerSafety ? { providerSafety } : {};
}
function anthropicSafety(stopReason, stopDetails) {
    if (stopReason !== "refusal")
        return undefined;
    return [{
            kind: "refusal",
            source: "provider",
            reason: stopReason,
            ...(stopDetails
                ? {
                    raw: {
                        fieldPath: "stop_details",
                        stopDetails,
                    },
                }
                : {}),
        }];
}
function anthropicErrorSafety(errorType, errorCode) {
    const evidence = `${errorType}:${errorCode ?? ""}`;
    if (!/policy|safety|moderation|content_filter|refusal/.test(evidence))
        return undefined;
    return [{ kind: "safety", source: "provider", reason: errorCode ?? errorType }];
}
function optionalCategory(category, value, sourceField) {
    return value === undefined ? [] : [{ category, tokens: value, sourceField }];
}
function providerSpecificCategories(provider, raw, prefix = "") {
    if (!raw)
        return [];
    const categories = [];
    for (const [key, value] of Object.entries(raw)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (path === "iterations")
            continue;
        const numeric = numberValue(value);
        if (numeric !== undefined) {
            categories.push({ category: `provider:${provider}:${path}`, tokens: numeric, sourceField: path });
            continue;
        }
        const nested = asRecord(value);
        if (nested)
            categories.push(...providerSpecificCategories(provider, nested, path));
    }
    return categories;
}
//# sourceMappingURL=anthropic.js.map