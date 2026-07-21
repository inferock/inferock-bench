// Copied from apps/proxy/src/adapters/openai.ts for inferock-bench Track C.
import { canonicalAttempts, canonicalRequest, canonicalTiming, captureMonotonicTimestamp, createStreamTimingCapture, providerRequestIdFromHeaders, recordParsedSseEvent, recordStreamByte, recordStreamContentDelta, sanitizedProviderHeaders, streamTiming, } from "./canonical-v2.js";
import { asRecord, booleanValue, collectRateLimitHeaders, isRecord, joinUrl, numberValue, parseJsonRecord, recordArray, stringValue, textFromContent, } from "../record.js";
import { SseAccumulator } from "../sse.js";
const OPENAI_COMPATIBLE_OPTIONS = {
    provider: "openai",
    providerSurface: "chat_completions",
    usageProvider: "openai",
};
/**
 * @contract-id openai-adapter
 */
export const openAiAdapter = {
    provider: "openai",
    buildRequest(input) {
        const payload = withOpenAiStreamUsage(withOpenAiChatProviderCompatibility(input.body));
        return {
            url: joinUrl(input.baseUrl, "/chat/completions"),
            init: {
                method: "POST",
                headers: {
                    authorization: `Bearer ${input.apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            },
            canonicalRequestBody: payload,
        };
    },
    toCanonicalEvent(input) {
        return mapOpenAiResponseToCanonical(input);
    },
    observeStream(input) {
        return observeOpenAiCompatibleStream(input);
    },
};
export function mapOpenAiResponseToCanonical(input, options = OPENAI_COMPATIBLE_OPTIONS) {
    const parsed = parseJsonRecord(input.responseBody);
    const rateLimitHeaders = collectRateLimitHeaders(input.headers);
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    if (!parsed || input.statusCode >= 400 || isRecord(parsed.error)) {
        const error = asRecord(parsed?.error);
        const errorType = stringValue(error?.type) ?? "provider_error";
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
                request: canonicalRequest(input, options.provider, options.providerSurface),
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
                    providerSafety: openAiErrorSafety(errorType, errorCode),
                    errorClass,
                    ...openAiCompatibleResponseEvidence(options, input, parsed),
                },
                usage: openAiUsageToCanonical({ input: 0, output: 0 }, options),
                timing: canonicalTiming(input.startedAt, input.endedAt, "error", input),
                attempts: canonicalAttempts(input, options.provider, servedModel, input.endedAt, "error", errorClass),
            },
        };
    }
    const choice = firstChoice(parsed);
    const message = asRecord(choice?.message);
    const usage = readOpenAiUsage(asRecord(parsed.usage));
    const toolCalls = recordArray(message?.tool_calls);
    const providerModel = stringValue(parsed.model);
    const servedModel = providerModel ?? input.requestModel;
    const servedModelSource = providerModel ? "provider_response" : "adapter_fallback";
    const providerResponseId = stringValue(parsed.id);
    return {
        rateLimitHeaders,
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, options.provider, options.providerSurface),
            response: {
                statusCode: input.statusCode,
                finishReason: stringValue(choice?.finish_reason) ?? "",
                content: textFromContent(message?.content),
                servedModel,
                servedModelSource,
                ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
                ...(toolCalls && toolCalls.length > 0 ? { rawToolCalls: toolCalls } : {}),
                ...(providerRequestId ? { providerRequestId } : {}),
                ...(providerResponseId ? { providerResponseId, rawObjectId: providerResponseId } : {}),
                ...(stringValue(parsed.system_fingerprint)
                    ? { systemFingerprint: stringValue(parsed.system_fingerprint) }
                    : {}),
                ...(stringValue(parsed.service_tier) ? { serviceTier: stringValue(parsed.service_tier) } : {}),
                ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                ...optionalOpenAiSafety(choice, message),
                ...openAiCompatibleResponseEvidence(options, input, parsed),
            },
            usage: openAiUsageToCanonical(usage, options),
            timing: canonicalTiming(input.startedAt, input.endedAt, "complete", input),
            attempts: canonicalAttempts(input, options.provider, servedModel, input.endedAt, "success"),
        },
    };
}
export function observeOpenAiCompatibleStream(input, options = OPENAI_COMPATIBLE_OPTIONS) {
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
            const observedAt = captureMonotonicTimestamp();
            recordStreamByte(state.timing, observedAt);
            let observedContentDelta = false;
            for (const message of parser.push(decoder.decode(chunk, { stream: true }))) {
                recordParsedSseEvent(state.timing, observedAt);
                observedContentDelta = applyOpenAiStreamMessage(state, message.data, input.statusCode) || observedContentDelta;
            }
            if (observedContentDelta)
                recordStreamContentDelta(state.timing, observedAt);
            controller.enqueue(chunk);
        },
        flush() {
            const observedAt = captureMonotonicTimestamp();
            const tail = decoder.decode();
            for (const message of [...parser.push(tail), ...parser.end()]) {
                recordParsedSseEvent(state.timing, observedAt);
                if (applyOpenAiStreamMessage(state, message.data, input.statusCode)) {
                    recordStreamContentDelta(state.timing, observedAt);
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
            input.onTerminal(finalizeOpenAiStream(input, state, options));
        },
    }));
}
function applyOpenAiStreamMessage(state, data, statusCode) {
    if (data === "[DONE]") {
        state.observedTerminalMarker = true;
        state.timing.terminalStatus = state.errorClass ? "error" : "complete";
        return false;
    }
    const parsed = parseJsonRecord(data);
    if (!parsed)
        return false;
    const openRouterMetadata = asRecord(parsed.openrouter_metadata);
    if (openRouterMetadata)
        state.openRouterMetadata = openRouterMetadata;
    if (isRecord(parsed.error)) {
        const errorType = stringValue(parsed.error.type) ?? "provider_error";
        const errorCode = stringValue(parsed.error.code);
        state.errorClass = `http_${statusCode}:${errorType}`;
        state.rawErrorType = errorType;
        state.rawErrorCode = errorCode;
        state.finishReason = "error";
        const errorSafety = openAiErrorSafety(errorType, errorCode);
        if (errorSafety)
            state.providerSafety.push(...errorSafety);
        state.timing.terminalStatus = "error";
        return false;
    }
    const id = stringValue(parsed.id);
    if (id)
        state.providerResponseId = id;
    const fingerprint = stringValue(parsed.system_fingerprint);
    if (fingerprint)
        state.systemFingerprint = fingerprint;
    const serviceTier = stringValue(parsed.service_tier);
    if (serviceTier)
        state.serviceTier = serviceTier;
    const model = stringValue(parsed.model);
    if (model)
        state.model = model;
    const usage = readOpenAiUsage(asRecord(parsed.usage));
    if (usage.input > 0 || usage.output > 0 || usage.cacheRead !== undefined) {
        state.usage = usage;
    }
    const choice = firstChoice(parsed);
    const finishReason = stringValue(choice?.finish_reason);
    if (finishReason)
        state.finishReason = finishReason;
    if (finishReason === "content_filter") {
        state.providerSafety.push(openAiContentFilterSafety());
    }
    const delta = asRecord(choice?.delta);
    const refusal = stringValue(delta?.refusal);
    if (refusal) {
        state.providerSafety.push(openAiRefusalSafety("choices[0].delta.refusal", refusal));
    }
    const contentPartRefusals = openAiContentPartRefusals(delta?.content, "choices[0].delta.content");
    state.providerSafety.push(...contentPartRefusals);
    const content = textFromContent(delta?.content);
    if (content)
        state.content += content;
    const toolCalls = recordArray(delta?.tool_calls);
    if (toolCalls)
        appendOpenAiToolCallDeltas(state.toolCalls, toolCalls);
    return Boolean(content) || Boolean(refusal) || contentPartRefusals.length > 0;
}
function finalizeOpenAiStream(input, state, options) {
    const endedAt = captureMonotonicTimestamp();
    const terminalInput = {
        ...input,
        endedAtMonotonicNs: endedAt.monotonicNs,
        providerResponseEndedAt: endedAt.wallTime,
        providerResponseEndedAtMonotonicNs: endedAt.monotonicNs,
    };
    const servedModel = state.model ?? input.requestModel;
    const servedModelSource = state.model ? "provider_response" : "adapter_fallback";
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    const terminalStatus = state.errorClass || input.statusCode >= 400 ? "error" : "success";
    const toolCalls = openAiToolCallsFromAccumulators(state.toolCalls);
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
        ...(state.systemFingerprint ? { systemFingerprint: state.systemFingerprint } : {}),
        ...(state.serviceTier ? { serviceTier: state.serviceTier } : {}),
        ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
        ...(state.rawErrorType ? { rawErrorType: state.rawErrorType } : {}),
        ...(state.rawErrorCode ? { rawErrorCode: state.rawErrorCode } : {}),
        ...(state.providerSafety.length > 0 ? { providerSafety: state.providerSafety } : {}),
        ...(state.errorClass ? { errorClass: state.errorClass } : {}),
        ...openAiCompatibleResponseEvidence(options, input, undefined, state.openRouterMetadata),
    };
    return {
        rateLimitHeaders: collectRateLimitHeaders(input.headers),
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, options.provider, options.providerSurface),
            response,
            usage: openAiUsageToCanonical(state.usage, options),
            timing: streamTiming(input.startedAt, endedAt.wallTime, state.timing, terminalInput),
            attempts: canonicalAttempts(terminalInput, options.provider, servedModel, endedAt.wallTime, terminalStatus, state.errorClass),
        },
    };
}
function appendOpenAiToolCallDeltas(accumulators, deltas) {
    for (const delta of deltas) {
        const index = numberValue(delta.index);
        if (index === undefined)
            continue;
        const accumulator = accumulators.get(index) ?? {
            index,
            argumentFragments: [],
        };
        const functionDelta = asRecord(delta.function);
        const id = stringValue(delta.id);
        if (id)
            accumulator.id = id;
        const type = stringValue(delta.type);
        if (type)
            accumulator.type = type;
        const functionName = stringValue(functionDelta?.name);
        if (functionName)
            accumulator.functionName = functionName;
        const argumentFragment = stringValue(functionDelta?.arguments);
        if (argumentFragment !== undefined)
            accumulator.argumentFragments.push(argumentFragment);
        accumulators.set(index, accumulator);
    }
}
function openAiToolCallsFromAccumulators(accumulators) {
    return [...accumulators.values()]
        .sort((left, right) => left.index - right.index)
        .map(openAiToolCallFromAccumulator);
}
function openAiToolCallFromAccumulator(accumulator) {
    const argumentsText = accumulator.argumentFragments.join("");
    const functionRecord = {
        arguments: argumentsText,
    };
    if (accumulator.functionName)
        functionRecord.name = accumulator.functionName;
    return {
        index: accumulator.index,
        ...(accumulator.id ? { id: accumulator.id } : {}),
        ...(accumulator.type ? { type: accumulator.type } : {}),
        function: functionRecord,
        argumentFragments: accumulator.argumentFragments,
        argumentsParseResult: parseResult(argumentsText),
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
function withOpenAiChatProviderCompatibility(body) {
    const model = stringValue(body.model);
    const reasoningCompatible = isOpenAiReasoningChatModel(model);
    const output = { ...body };
    // Provider compatibility:
    // - Chat Completions documents max_completion_tokens and deprecates max_tokens as incompatible with o-series:
    //   https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
    // - GPT-5 is documented as a reasoning model; provider compatibility runs reject temperature on GPT-5/o chat calls:
    //   https://developers.openai.com/api/docs/models/gpt-5
    if (reasoningCompatible) {
        if (!hasOwn(output, "max_completion_tokens") && hasOwn(output, "max_tokens")) {
            output.max_completion_tokens = output.max_tokens;
        }
        delete output.max_tokens;
        delete output.temperature;
    }
    // OpenAI request metadata is only useful on stored requests; omit it when store is not explicitly enabled.
    // https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
    if (booleanValue(output.store) !== true)
        delete output.metadata;
    return output;
}
function isOpenAiReasoningChatModel(model) {
    return model?.startsWith("gpt-5") === true || model?.startsWith("o") === true;
}
function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
export function withOpenAiStreamUsage(body) {
    if (booleanValue(body.stream) !== true)
        return body;
    const streamOptions = isRecord(body.stream_options)
        ? { ...body.stream_options, include_usage: true }
        : { include_usage: true };
    return {
        ...body,
        stream_options: streamOptions,
    };
}
function firstChoice(parsed) {
    const choices = parsed.choices;
    if (!Array.isArray(choices))
        return undefined;
    return asRecord(choices[0]);
}
function readOpenAiUsage(usage) {
    const promptDetails = asRecord(usage?.prompt_tokens_details);
    const promptTokens = numberValue(usage?.prompt_tokens) ?? 0;
    const cacheRead = numberValue(promptDetails?.cached_tokens);
    return {
        input: Math.max(0, promptTokens - (cacheRead ?? 0)),
        output: numberValue(usage?.completion_tokens) ?? 0,
        cacheRead,
        ...(usage ? { raw: usage } : {}),
    };
}
function openAiUsageToCanonical(usage, options) {
    return {
        input: usage.input,
        output: usage.output,
        ...(usage.cacheRead !== undefined
            ? { cache: { read: usage.cacheRead } }
            : {}),
        ...(usage.raw ? { raw: usage.raw } : {}),
        categories: openAiUsageCategories(usage, options),
        usageSource: usage.raw ? "provider" : "missing",
    };
}
function openAiUsageCategories(usage, options) {
    const raw = usage.raw;
    const promptDetails = asRecord(raw?.prompt_tokens_details);
    const completionDetails = asRecord(raw?.completion_tokens_details);
    const genericDetailCategories = options.provider !== "openrouter";
    return [
        { category: "prompt", tokens: numberValue(raw?.prompt_tokens) ?? usage.input, sourceField: "prompt_tokens" },
        { category: "completion", tokens: usage.output, sourceField: "completion_tokens" },
        ...(usage.cacheRead !== undefined
            ? [{ category: "cached", tokens: usage.cacheRead, sourceField: "prompt_tokens_details.cached_tokens" }]
            : []),
        ...(genericDetailCategories
            ? optionalCategory("reasoning", completionDetails?.reasoning_tokens, "completion_tokens_details.reasoning_tokens")
            : []),
        ...(genericDetailCategories
            ? optionalCategory("audio", promptDetails?.audio_tokens, "prompt_tokens_details.audio_tokens")
            : []),
        ...(genericDetailCategories
            ? optionalCategory("audio", completionDetails?.audio_tokens, "completion_tokens_details.audio_tokens")
            : []),
        ...providerSpecificCategories(options.usageProvider, raw),
    ];
}
function openAiCompatibleResponseEvidence(options, request, parsed, streamMetadata) {
    return options.responseEvidence?.({ request, parsed, streamMetadata }) ?? {};
}
function optionalOpenAiSafety(choice, message) {
    const safety = [];
    if (stringValue(choice?.finish_reason) === "content_filter") {
        safety.push(openAiContentFilterSafety());
    }
    const refusal = stringValue(message?.refusal);
    if (refusal) {
        safety.push(openAiRefusalSafety("choices[0].message.refusal", refusal));
    }
    safety.push(...openAiContentPartRefusals(message?.content, "choices[0].message.content"));
    return safety.length > 0 ? { providerSafety: safety } : {};
}
function openAiRefusalSafety(fieldPath, refusal) {
    return {
        kind: "refusal",
        source: "provider",
        reason: "refusal",
        raw: {
            fieldPath,
            refusal,
        },
    };
}
function openAiContentFilterSafety() {
    return {
        kind: "content_filter",
        source: "provider",
        reason: "content_filter",
        raw: {
            fieldPath: "choices[0].finish_reason",
            value: "content_filter",
        },
    };
}
function openAiContentPartRefusals(content, fieldPathPrefix) {
    if (!Array.isArray(content))
        return [];
    return content.flatMap((item, index) => {
        if (!isRecord(item) || item.type !== "refusal")
            return [];
        const refusal = stringValue(item.refusal);
        if (!refusal)
            return [];
        return [openAiRefusalSafety(`${fieldPathPrefix}[${index}].refusal`, refusal)];
    });
}
function openAiErrorSafety(errorType, errorCode) {
    const evidence = `${errorType}:${errorCode ?? ""}`;
    if (!/policy|safety|moderation|content_filter/.test(evidence))
        return undefined;
    return [{ kind: "moderation", source: "provider", reason: errorCode ?? errorType }];
}
function optionalCategory(category, value, sourceField) {
    const tokens = numberValue(value);
    return tokens === undefined ? [] : [{ category, tokens, sourceField }];
}
function providerSpecificCategories(provider, raw, prefix = "") {
    if (!raw)
        return [];
    const categories = [];
    for (const [key, value] of Object.entries(raw)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (provider === "openrouter" && !openRouterProviderUsageCategoryPath(path))
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
function openRouterProviderUsageCategoryPath(path) {
    return path === "total_tokens" ||
        path === "cost" ||
        path.startsWith("cost_details.");
}
//# sourceMappingURL=openai.js.map