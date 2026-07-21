import { canonicalAttempts, canonicalRequest, canonicalTiming, captureMonotonicTimestamp, createStreamTimingCapture, providerRequestIdFromHeaders, recordParsedSseEvent, recordStreamByte, recordStreamContentDelta, sanitizedProviderHeaders, streamTiming, } from "./canonical-v2.js";
import { asRecord, collectRateLimitHeaders, booleanValue, isRecord, joinUrl, numberValue, parseJsonRecord, recordArray, stringValue, } from "./record.js";
import { SseAccumulator } from "./sse.js";
/**
 * @contract-id openai-responses-adapter
 */
export const openAiResponsesAdapter = {
    provider: "openai",
    buildRequest(input) {
        // v0 observes the provider response returned on this HTTP exchange only; polling
        // background jobs here would create lifecycle evidence the caller did not receive.
        const payload = withOpenAiResponsesProviderCompatibility(input.body);
        return {
            url: joinUrl(input.baseUrl, "/responses"),
            init: {
                method: "POST",
                headers: {
                    authorization: `Bearer ${input.apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        };
    },
    toCanonicalEvent(input) {
        return mapOpenAiResponsesResponseToCanonical(input);
    },
    observeStream(input) {
        return observeOpenAiResponsesStream(input);
    },
};
function withOpenAiResponsesProviderCompatibility(body) {
    const output = { ...body };
    // Responses API compatibility:
    // - Responses uses max_output_tokens and text.format for structured outputs:
    //   https://developers.openai.com/api/reference/resources/responses/methods/create
    // - The reasoning guide documents max_output_tokens as the generated-token bound for reasoning models:
    //   https://developers.openai.com/api/docs/guides/reasoning
    if (!hasOwn(output, "max_output_tokens") && hasOwn(output, "max_tokens")) {
        output.max_output_tokens = output.max_tokens;
    }
    delete output.max_tokens;
    const textFormat = responsesTextFormatFromLegacyResponseFormat(output.response_format);
    if (textFormat) {
        const text = isRecord(output.text) ? output.text : {};
        output.text = { ...text, format: textFormat };
    }
    delete output.response_format;
    if (isOpenAiReasoningModel(stringValue(output.model))) {
        delete output.temperature;
    }
    // OpenAI request metadata is only useful on stored requests; omit it when store is not explicitly enabled.
    // https://developers.openai.com/api/reference/resources/responses/methods/create
    if (booleanValue(output.store) !== true)
        delete output.metadata;
    return output;
}
function responsesTextFormatFromLegacyResponseFormat(value) {
    if (!isRecord(value))
        return undefined;
    const type = stringValue(value.type);
    if (type === "json_schema") {
        const jsonSchema = isRecord(value.json_schema) ? value.json_schema : {};
        return {
            type: "json_schema",
            ...jsonSchema,
        };
    }
    if (type === "json_object") {
        return { type: "json_object" };
    }
    if (type === "text") {
        return { type: "text" };
    }
    return undefined;
}
function isOpenAiReasoningModel(model) {
    return model?.startsWith("gpt-5") === true || model?.startsWith("o") === true;
}
function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
export function mapOpenAiResponsesResponseToCanonical(input) {
    const parsed = parseJsonRecord(input.responseBody);
    const rateLimitHeaders = collectRateLimitHeaders(input.headers);
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    if (!parsed || input.statusCode >= 400) {
        const error = asRecord(parsed?.error);
        const errorType = responseErrorType(error) ?? (parsed ? "provider_error" : "invalid_json");
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
                request: canonicalRequest(input, "openai", "openai_responses"),
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
                    ...(responsesErrorSafety(errorType, errorCode)
                        ? { providerSafety: responsesErrorSafety(errorType, errorCode) }
                        : {}),
                    errorClass,
                },
                usage: responsesUsageToCanonical(missingUsage()),
                timing: canonicalTiming(input.startedAt, input.endedAt, "error", input),
                attempts: canonicalAttempts(input, "openai", servedModel, input.endedAt, "error", errorClass),
            },
        };
    }
    const responseEvidence = responsesObjectEvidence(parsed, input);
    const errorClass = responseEvidence.errorClass;
    const terminalStatus = nonStreamTerminalStatus(responseEvidence.status, errorClass);
    const attemptStatus = errorClass ? "error" : "success";
    return {
        rateLimitHeaders,
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, "openai", "openai_responses"),
            response: responsesCanonicalResponse({
                input,
                evidence: responseEvidence,
                providerRequestId,
                sanitizedHeaders,
            }),
            usage: responsesUsageToCanonical(responseEvidence.usage),
            timing: canonicalTiming(input.startedAt, input.endedAt, terminalStatus, input),
            attempts: canonicalAttempts(input, "openai", responseEvidence.servedModel, input.endedAt, attemptStatus, errorClass),
        },
    };
}
function observeOpenAiResponsesStream(input) {
    const decoder = new TextDecoder();
    const parser = new SseAccumulator();
    const state = {
        content: "",
        finishReason: "",
        usage: missingUsage(),
        toolCalls: new Map(),
        providerSafety: [],
        timing: createStreamTimingCapture(),
    };
    return input.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            const observedAt = captureMonotonicTimestamp();
            recordStreamByte(state.timing, observedAt);
            let observedVisibleDelta = false;
            for (const message of parser.push(decoder.decode(chunk, { stream: true }))) {
                recordParsedSseEvent(state.timing, observedAt);
                observedVisibleDelta = applyResponsesStreamMessage(state, message, input.statusCode) || observedVisibleDelta;
            }
            if (observedVisibleDelta)
                recordStreamContentDelta(state.timing, observedAt);
            controller.enqueue(chunk);
        },
        flush() {
            const observedAt = captureMonotonicTimestamp();
            const tail = decoder.decode();
            for (const message of [...parser.push(tail), ...parser.end()]) {
                recordParsedSseEvent(state.timing, observedAt);
                if (applyResponsesStreamMessage(state, message, input.statusCode)) {
                    recordStreamContentDelta(state.timing, observedAt);
                }
            }
            if (state.timing.terminalStatus === "unknown") {
                state.timing.terminalStatus = state.errorClass || input.statusCode >= 400 ? "error" : "aborted";
            }
            input.onTerminal(finalizeResponsesStream(input, state));
        },
    }));
}
function applyResponsesStreamMessage(state, message, statusCode) {
    const parsed = parseJsonRecord(message.data);
    if (!parsed)
        return false;
    const eventType = stringValue(parsed.type) ?? message.event;
    const response = asRecord(parsed.response);
    if (response)
        applyStreamResponseObject(state, response, statusCode);
    if (eventType === "error" || (isRecord(parsed.error) && !response)) {
        const error = asRecord(parsed.error);
        const errorType = responseErrorType(error) ?? "provider_stream_error";
        const errorCode = stringValue(error?.code);
        const errorMessage = stringValue(error?.message) ?? "";
        state.errorClass = `stream:${errorType}`;
        state.rawErrorType = errorType;
        state.rawErrorCode = errorCode;
        state.errorMessage = errorMessage;
        state.finishReason = "error";
        state.timing.terminalStatus = "error";
        const safety = responsesErrorSafety(errorType, errorCode);
        if (safety)
            state.providerSafety.push(...safety);
        return false;
    }
    switch (eventType) {
        case "response.completed":
        case "response.incomplete":
            state.timing.terminalStatus = "complete";
            return false;
        case "response.failed":
            state.timing.terminalStatus = "error";
            state.errorClass = state.errorClass ?? "provider_status:failed";
            state.finishReason = state.finishReason || "failed";
            return false;
        case "response.output_text.delta": {
            const delta = stringValue(parsed.delta);
            if (delta) {
                state.content += delta;
                return true;
            }
            return false;
        }
        case "response.output_text.done": {
            const text = stringValue(parsed.text);
            if (text !== undefined)
                state.content = text;
            return false;
        }
        case "response.refusal.delta": {
            const delta = stringValue(parsed.delta);
            if (delta) {
                state.providerSafety.push(responsesRefusalSafety(streamRefusalFieldPath(parsed), delta));
                return true;
            }
            return false;
        }
        case "response.refusal.done": {
            const refusal = stringValue(parsed.refusal);
            if (refusal)
                state.providerSafety.push(responsesRefusalSafety(streamRefusalFieldPath(parsed), refusal));
            return false;
        }
        case "response.content_part.done": {
            const part = asRecord(parsed.part);
            if (part?.type === "refusal") {
                const refusal = stringValue(part.refusal);
                if (refusal)
                    state.providerSafety.push(responsesRefusalSafety(streamRefusalFieldPath(parsed), refusal));
            }
            return false;
        }
        case "response.output_item.added":
        case "response.output_item.done": {
            const item = asRecord(parsed.item);
            if (item?.type === "function_call")
                applyFunctionCallItem(state.toolCalls, item, parsed);
            return false;
        }
        case "response.function_call_arguments.delta":
            appendFunctionCallArgumentsDelta(state.toolCalls, parsed);
            return false;
        case "response.function_call_arguments.done":
            finishFunctionCallArguments(state.toolCalls, parsed);
            return false;
        default:
            return false;
    }
}
function applyStreamResponseObject(state, response, statusCode) {
    state.response = response;
    const status = stringValue(response.status);
    if (status)
        state.finishReason = status;
    const id = stringValue(response.id);
    if (id)
        state.providerResponseId = id;
    const model = stringValue(response.model);
    if (model)
        state.model = model;
    const fingerprint = stringValue(response.system_fingerprint);
    if (fingerprint)
        state.systemFingerprint = fingerprint;
    const serviceTier = stringValue(response.service_tier);
    if (serviceTier)
        state.serviceTier = serviceTier;
    const usage = readResponsesUsage(asRecord(response.usage));
    if (usage.usageSource !== "missing")
        state.usage = usage;
    if (status === "failed" || status === "cancelled") {
        state.errorClass = `provider_status:${status}`;
        state.timing.terminalStatus = "error";
    }
    else if (status === "completed" || status === "incomplete") {
        state.timing.terminalStatus = "complete";
    }
    const error = asRecord(response.error);
    if (error && (status === "failed" || status === "cancelled" || statusCode >= 400)) {
        state.rawErrorType = responseErrorType(error) ?? status ?? "response_error";
        state.rawErrorCode = stringValue(error.code);
        state.errorMessage = stringValue(error.message);
    }
}
function finalizeResponsesStream(input, state) {
    const endedAt = captureMonotonicTimestamp();
    const terminalInput = {
        ...input,
        endedAtMonotonicNs: endedAt.monotonicNs,
        providerResponseEndedAt: endedAt.wallTime,
        providerResponseEndedAtMonotonicNs: endedAt.monotonicNs,
    };
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    const responseEvidence = state.response
        ? responsesObjectEvidence(state.response, input)
        : streamStateEvidence(state, input);
    const mergedEvidence = mergeStreamEvidence(responseEvidence, state, input);
    const errorClass = state.errorClass ?? mergedEvidence.errorClass;
    const attemptStatus = errorClass || input.statusCode >= 400 ? "error" : "success";
    return {
        rateLimitHeaders: collectRateLimitHeaders(input.headers),
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, "openai", "openai_responses"),
            response: responsesCanonicalResponse({
                input,
                evidence: { ...mergedEvidence, ...(errorClass ? { errorClass } : {}) },
                providerRequestId,
                sanitizedHeaders,
            }),
            usage: responsesUsageToCanonical(mergedEvidence.usage),
            timing: streamTiming(input.startedAt, endedAt.wallTime, state.timing, terminalInput),
            attempts: canonicalAttempts(terminalInput, "openai", mergedEvidence.servedModel, endedAt.wallTime, attemptStatus, errorClass),
        },
    };
}
function responsesCanonicalResponse(input) {
    const evidence = input.evidence;
    return {
        statusCode: input.input.statusCode,
        finishReason: evidence.status,
        content: evidence.content,
        servedModel: evidence.servedModel,
        servedModelSource: evidence.servedModelSource,
        ...(evidence.toolCalls.length > 0 ? { toolCalls: evidence.toolCalls, rawToolCalls: evidence.toolCalls } : {}),
        ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
        ...(evidence.providerResponseId
            ? { providerResponseId: evidence.providerResponseId, rawObjectId: evidence.providerResponseId }
            : {}),
        ...(evidence.systemFingerprint ? { systemFingerprint: evidence.systemFingerprint } : {}),
        ...(evidence.serviceTier ? { serviceTier: evidence.serviceTier } : {}),
        ...(input.sanitizedHeaders ? { sanitizedHeaders: input.sanitizedHeaders } : {}),
        ...(evidence.rawErrorType ? { rawErrorType: evidence.rawErrorType } : {}),
        ...(evidence.rawErrorCode ? { rawErrorCode: evidence.rawErrorCode } : {}),
        ...(evidence.stopDetails ? { stopDetails: evidence.stopDetails } : {}),
        ...(evidence.providerSafety.length > 0 ? { providerSafety: evidence.providerSafety } : {}),
        ...(evidence.errorClass ? { errorClass: evidence.errorClass } : {}),
    };
}
function responsesObjectEvidence(response, input) {
    const status = stringValue(response.status) ?? "";
    const error = asRecord(response.error);
    const rawErrorType = error ? responseErrorType(error) ?? status : undefined;
    const rawErrorCode = stringValue(error?.code);
    const errorMessage = stringValue(error?.message);
    const lifecycleErrorClass = status === "failed" || status === "cancelled"
        ? `provider_status:${status}`
        : undefined;
    return {
        status,
        content: visibleResponsesContent(response),
        servedModel: stringValue(response.model) ?? input.requestModel,
        servedModelSource: stringValue(response.model) ? "provider_response" : "adapter_fallback",
        ...(stringValue(response.id) ? { providerResponseId: stringValue(response.id) } : {}),
        ...(stringValue(response.system_fingerprint) ? { systemFingerprint: stringValue(response.system_fingerprint) } : {}),
        ...(stringValue(response.service_tier) ? { serviceTier: stringValue(response.service_tier) } : {}),
        usage: readResponsesUsage(asRecord(response.usage)),
        toolCalls: responsesFunctionCallsFromOutput(response.output),
        providerSafety: responsesProviderSafety(response),
        ...(responsesStopDetails(response) ? { stopDetails: responsesStopDetails(response) } : {}),
        ...(rawErrorType ? { rawErrorType } : {}),
        ...(rawErrorCode ? { rawErrorCode } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        ...(lifecycleErrorClass ? { errorClass: lifecycleErrorClass } : {}),
    };
}
function streamStateEvidence(state, input) {
    return {
        status: state.finishReason || (state.errorClass ? "error" : ""),
        content: state.content,
        servedModel: state.model ?? input.requestModel,
        servedModelSource: state.model ? "provider_response" : "adapter_fallback",
        ...(state.providerResponseId ? { providerResponseId: state.providerResponseId } : {}),
        ...(state.systemFingerprint ? { systemFingerprint: state.systemFingerprint } : {}),
        ...(state.serviceTier ? { serviceTier: state.serviceTier } : {}),
        usage: state.usage,
        toolCalls: responsesToolCallsFromAccumulators(state.toolCalls),
        providerSafety: state.providerSafety,
        ...(state.rawErrorType ? { rawErrorType: state.rawErrorType } : {}),
        ...(state.rawErrorCode ? { rawErrorCode: state.rawErrorCode } : {}),
        ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
        ...(state.errorClass ? { errorClass: state.errorClass } : {}),
    };
}
function mergeStreamEvidence(responseEvidence, state, input) {
    const streamToolCalls = responsesToolCallsFromAccumulators(state.toolCalls);
    const providerSafety = [
        ...responseEvidence.providerSafety,
        ...state.providerSafety,
    ];
    const servedModel = responseEvidence.servedModelSource === "provider_response"
        ? responseEvidence.servedModel
        : state.model ?? responseEvidence.servedModel ?? input.requestModel;
    const servedModelSource = responseEvidence.servedModelSource === "provider_response" || state.model
        ? "provider_response"
        : "adapter_fallback";
    return {
        ...responseEvidence,
        content: responseEvidence.content || state.content,
        servedModel,
        servedModelSource,
        ...(state.providerResponseId && !responseEvidence.providerResponseId
            ? { providerResponseId: state.providerResponseId }
            : {}),
        usage: responseEvidence.usage.usageSource === "missing" ? state.usage : responseEvidence.usage,
        toolCalls: responseEvidence.toolCalls.length > 0 ? responseEvidence.toolCalls : streamToolCalls,
        providerSafety: uniqueProviderSafety(providerSafety),
        ...(state.rawErrorType && !responseEvidence.rawErrorType ? { rawErrorType: state.rawErrorType } : {}),
        ...(state.rawErrorCode && !responseEvidence.rawErrorCode ? { rawErrorCode: state.rawErrorCode } : {}),
        ...(state.errorClass && !responseEvidence.errorClass ? { errorClass: state.errorClass } : {}),
    };
}
function nonStreamTerminalStatus(status, errorClass) {
    if (errorClass)
        return "error";
    if (status === "failed" || status === "cancelled")
        return "error";
    if (status === "queued" || status === "in_progress")
        return "unknown";
    return "complete";
}
function visibleResponsesContent(response) {
    if (typeof response.output_text === "string")
        return response.output_text;
    const chunks = [];
    for (const item of recordArray(response.output) ?? []) {
        if (item.type !== "message")
            continue;
        for (const part of recordArray(item.content) ?? []) {
            if (part.type !== "output_text")
                continue;
            const text = stringValue(part.text);
            if (text)
                chunks.push(text);
        }
    }
    return chunks.join("");
}
function responsesFunctionCallsFromOutput(output) {
    return (recordArray(output) ?? [])
        .flatMap((item, index) => item.type === "function_call"
        ? [responsesFunctionCall(item, index)]
        : []);
}
function responsesFunctionCall(item, index) {
    const argumentsText = stringValue(item.arguments);
    return {
        ...item,
        index,
        ...(argumentsText !== undefined ? { argumentsParseResult: parseResult(argumentsText) } : {}),
    };
}
function responsesProviderSafety(response) {
    const safety = [];
    for (const [outputIndex, item] of (recordArray(response.output) ?? []).entries()) {
        if (item.type !== "message")
            continue;
        for (const [contentIndex, part] of (recordArray(item.content) ?? []).entries()) {
            if (part.type !== "refusal")
                continue;
            const refusal = stringValue(part.refusal);
            if (refusal) {
                safety.push(responsesRefusalSafety(`output[${outputIndex}].content[${contentIndex}].refusal`, refusal));
            }
        }
    }
    const incompleteDetails = asRecord(response.incomplete_details);
    if (stringValue(incompleteDetails?.reason) === "content_filter") {
        safety.push({
            kind: "content_filter",
            source: "provider",
            reason: "content_filter",
            raw: {
                fieldPath: "incomplete_details.reason",
                incomplete_details: incompleteDetails,
            },
        });
    }
    safety.push(...responsesModerationSafety(response.moderation));
    const error = asRecord(response.error);
    const errorSafety = responsesErrorSafety(responseErrorType(error) ?? "", stringValue(error?.code));
    if (errorSafety)
        safety.push(...errorSafety);
    return uniqueProviderSafety(safety);
}
function responsesModerationSafety(moderation) {
    const moderationRecord = asRecord(moderation);
    if (!moderationRecord)
        return [];
    return [
        ...responsesModerationScopeSafety(moderationRecord.input, "input"),
        ...responsesModerationScopeSafety(moderationRecord.output, "output"),
    ];
}
function responsesModerationScopeSafety(value, scope) {
    const record = asRecord(value);
    if (!record)
        return [];
    if (stringValue(record.type) === "error") {
        return [responsesModerationErrorSafety(record, scope)];
    }
    const model = stringValue(record.model);
    const results = recordArray(record.results) ?? [];
    return results.flatMap((result, index) => {
        if (booleanValue(result.flagged) !== true)
            return [];
        const resultModel = stringValue(result.model) ?? model;
        const categories = trueCategories(asRecord(result.categories));
        const categoryScores = numericCategoryMap(asRecord(result.category_scores), categories);
        const appliedInputTypes = appliedInputTypeMap(asRecord(result.category_applied_input_types), categories);
        return [{
                kind: "moderation",
                source: "provider",
                reason: "inline_moderation_flagged",
                raw: {
                    fieldPath: `moderation.${scope}.results[${index}]`,
                    provider: "openai",
                    scope,
                    resultIndex: index,
                    ...(scope === "output" ? { choiceIndex: index } : {}),
                    ...(resultModel ? { model: resultModel } : {}),
                    flagged: true,
                    categories,
                    ...(Object.keys(categoryScores).length > 0 ? { categoryScores } : {}),
                    ...(Object.keys(appliedInputTypes).length > 0 ? { categoryAppliedInputTypes: appliedInputTypes } : {}),
                },
            }];
    });
}
function responsesModerationErrorSafety(error, scope) {
    const code = stringValue(error.code);
    return {
        kind: "moderation",
        source: "provider",
        reason: "inline_moderation_error",
        raw: {
            fieldPath: `moderation.${scope}`,
            provider: "openai",
            scope,
            type: "error",
            ...(code ? { code } : {}),
        },
    };
}
function responsesRefusalSafety(fieldPath, refusal) {
    return {
        kind: "refusal",
        source: "provider",
        reason: "refusal",
        raw: { fieldPath, refusal },
    };
}
function responsesErrorSafety(errorType, errorCode) {
    const evidence = `${errorType}:${errorCode ?? ""}`;
    if (!/policy|safety|moderation|content_filter/.test(evidence))
        return undefined;
    return [{
            kind: "moderation",
            source: "provider",
            reason: errorCode ?? errorType,
            raw: {
                ...(errorType ? { errorType } : {}),
                ...(errorCode ? { errorCode } : {}),
            },
        }];
}
function trueCategories(categories) {
    if (!categories)
        return [];
    return Object.entries(categories)
        .filter(([, value]) => value === true)
        .map(([category]) => category)
        .sort();
}
function numericCategoryMap(scores, categories) {
    if (!scores)
        return {};
    const categorySet = new Set(categories);
    const mapped = {};
    for (const [category, score] of Object.entries(scores)) {
        if (categorySet.size > 0 && !categorySet.has(category))
            continue;
        const numeric = numberValue(score);
        if (numeric !== undefined)
            mapped[category] = numeric;
    }
    return mapped;
}
function appliedInputTypeMap(applied, categories) {
    if (!applied)
        return {};
    const categorySet = new Set(categories);
    const mapped = {};
    for (const [category, value] of Object.entries(applied)) {
        if (categorySet.size > 0 && !categorySet.has(category))
            continue;
        if (!Array.isArray(value))
            continue;
        const inputTypes = value.filter((item) => item === "text" || item === "image");
        if (inputTypes.length > 0)
            mapped[category] = inputTypes;
    }
    return mapped;
}
function responsesStopDetails(response) {
    const status = stringValue(response.status);
    const incompleteDetails = asRecord(response.incomplete_details);
    const error = asRecord(response.error);
    const outputItemStatuses = responsesOutputItemStatuses(response.output);
    const details = {
        ...(status ? { status } : {}),
        ...(incompleteDetails ? { incompleteDetails } : {}),
        ...(error ? { error } : {}),
        ...(outputItemStatuses.length > 0 ? { outputItemStatuses } : {}),
    };
    return Object.keys(details).length > 0 ? details : undefined;
}
function responsesOutputItemStatuses(output) {
    return (recordArray(output) ?? []).flatMap((item, index) => {
        const status = stringValue(item.status);
        if (!status || status === "completed")
            return [];
        return [{
                index,
                ...(stringValue(item.id) ? { id: stringValue(item.id) } : {}),
                ...(stringValue(item.type) ? { type: stringValue(item.type) } : {}),
                status,
            }];
    });
}
function readResponsesUsage(usage) {
    if (!usage)
        return missingUsage();
    const inputDetails = asRecord(usage.input_tokens_details);
    const inputTokens = numberValue(usage.input_tokens);
    const outputTokens = numberValue(usage.output_tokens);
    const cacheRead = numberValue(inputDetails?.cached_tokens);
    return {
        input: inputTokens === undefined ? 0 : Math.max(0, inputTokens - (cacheRead ?? 0)),
        output: outputTokens ?? 0,
        ...(cacheRead !== undefined ? { cacheRead } : {}),
        raw: usage,
        usageSource: inputTokens !== undefined && outputTokens !== undefined ? "provider" : "partial",
    };
}
function missingUsage() {
    return {
        input: 0,
        output: 0,
        usageSource: "missing",
    };
}
function responsesUsageToCanonical(usage) {
    return {
        input: usage.input,
        output: usage.output,
        ...(usage.cacheRead !== undefined ? { cache: { read: usage.cacheRead } } : {}),
        ...(usage.raw ? { raw: usage.raw } : {}),
        categories: responsesUsageCategories(usage),
        usageSource: usage.usageSource,
    };
}
function responsesUsageCategories(usage) {
    const raw = usage.raw;
    const inputDetails = asRecord(raw?.input_tokens_details);
    const outputDetails = asRecord(raw?.output_tokens_details);
    return [
        ...optionalCategory("input", raw?.input_tokens, "input_tokens"),
        ...optionalCategory("output", raw?.output_tokens, "output_tokens"),
        ...optionalCategory("cached", inputDetails?.cached_tokens, "input_tokens_details.cached_tokens"),
        ...optionalCategory("reasoning", outputDetails?.reasoning_tokens, "output_tokens_details.reasoning_tokens"),
        ...providerSpecificCategories("openai_responses", raw),
    ];
}
function applyFunctionCallItem(accumulators, item, event) {
    const index = numberValue(event.output_index) ?? numberValue(item.index);
    if (index === undefined)
        return;
    const accumulator = accumulatorForIndex(accumulators, index);
    accumulator.rawItem = { ...accumulator.rawItem, ...item };
    const id = stringValue(item.id);
    if (id)
        accumulator.id = id;
    const callId = stringValue(item.call_id);
    if (callId)
        accumulator.callId = callId;
    const type = stringValue(item.type);
    if (type)
        accumulator.type = type;
    const name = stringValue(item.name);
    if (name)
        accumulator.name = name;
    const status = stringValue(item.status);
    if (status)
        accumulator.status = status;
    const argumentsText = stringValue(item.arguments);
    if (argumentsText !== undefined)
        accumulator.completeArguments = argumentsText;
    accumulators.set(index, accumulator);
}
function appendFunctionCallArgumentsDelta(accumulators, event) {
    const index = numberValue(event.output_index);
    const delta = stringValue(event.delta);
    if (index === undefined || delta === undefined)
        return;
    const accumulator = accumulatorForIndex(accumulators, index);
    const itemId = stringValue(event.item_id);
    if (itemId)
        accumulator.id = itemId;
    accumulator.type = accumulator.type ?? "function_call";
    accumulator.argumentFragments.push(delta);
    accumulators.set(index, accumulator);
}
function finishFunctionCallArguments(accumulators, event) {
    const index = numberValue(event.output_index);
    if (index === undefined)
        return;
    const accumulator = accumulatorForIndex(accumulators, index);
    const argumentsText = stringValue(event.arguments);
    if (argumentsText !== undefined)
        accumulator.completeArguments = argumentsText;
    accumulators.set(index, accumulator);
}
function accumulatorForIndex(accumulators, index) {
    return accumulators.get(index) ?? { index, argumentFragments: [] };
}
function responsesToolCallsFromAccumulators(accumulators) {
    return [...accumulators.values()]
        .sort((left, right) => left.index - right.index)
        .map(responsesToolCallFromAccumulator);
}
function responsesToolCallFromAccumulator(accumulator) {
    const argumentsText = accumulator.completeArguments ?? accumulator.argumentFragments.join("");
    return {
        ...(accumulator.rawItem ?? {}),
        index: accumulator.index,
        ...(accumulator.id ? { id: accumulator.id } : {}),
        ...(accumulator.callId ? { call_id: accumulator.callId } : {}),
        type: accumulator.type ?? "function_call",
        ...(accumulator.name ? { name: accumulator.name } : {}),
        arguments: argumentsText,
        ...(accumulator.status ? { status: accumulator.status } : {}),
        ...(accumulator.argumentFragments.length > 0
            ? { argumentFragments: [...accumulator.argumentFragments] }
            : {}),
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
function responseErrorType(error) {
    return stringValue(error?.type) ?? stringValue(error?.code);
}
function streamRefusalFieldPath(event) {
    const outputIndex = numberValue(event.output_index);
    const contentIndex = numberValue(event.content_index);
    if (outputIndex !== undefined && contentIndex !== undefined) {
        return `output[${outputIndex}].content[${contentIndex}].refusal`;
    }
    return "response.refusal";
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
function uniqueProviderSafety(safety) {
    const seen = new Set();
    return safety.filter((entry) => {
        const key = JSON.stringify(entry);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=openai-responses.js.map