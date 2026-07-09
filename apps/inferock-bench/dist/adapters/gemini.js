import { canonicalAttempts, canonicalRequest, canonicalTiming, createStreamTimingCapture, providerRequestIdFromHeaders, recordStreamChunk, recordStreamToken, sanitizedProviderHeaders, streamTiming, } from "./canonical-v2.js";
import { asRecord, collectRateLimitHeaders, compactRecord, isRecord, joinUrl, numberValue, parseJsonRecord, stringValue, } from "../record.js";
import { sanitizeGeminiGenerateContentPayload } from "./gemini-schema.js";
import { SseAccumulator } from "../sse.js";
const GEMINI_PROVIDER = "gemini";
const GEMINI_SURFACE = "gemini_generate_content";
const GEMINI_AUDIO_MODALITY = "AUDIO";
const GEMINI_POLICY_FINISH_REASONS = new Set([
    "SAFETY",
    "RECITATION",
    "LANGUAGE",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
    "IMAGE_OTHER",
    "NO_IMAGE",
    "MALFORMED_RESPONSE",
]);
const GEMINI_TOOL_VALIDITY_FINISH_REASONS = new Set([
    "MALFORMED_FUNCTION_CALL",
    "UNEXPECTED_TOOL_CALL",
    "TOO_MANY_TOOL_CALLS",
    "MISSING_THOUGHT_SIGNATURE",
]);
/**
 * @contract-id gemini-adapter
 */
export const geminiAdapter = {
    provider: GEMINI_PROVIDER,
    buildRequest(input) {
        const stream = input.body.stream === true;
        const operation = stream ? "streamGenerateContent" : "generateContent";
        const suffix = stream ? `:${operation}?alt=sse` : `:${operation}`;
        return {
            url: joinUrl(input.baseUrl, `/${geminiModelPath(input.body.model)}${suffix}`),
            init: {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-goog-api-key": input.apiKey,
                },
                body: JSON.stringify(generateContentPayload(input.body)),
            },
        };
    },
    toCanonicalEvent(input) {
        return mapGeminiResponseToCanonical(input);
    },
    observeStream(input) {
        return observeGeminiStream(input);
    },
};
export function mapGeminiResponseToCanonical(input) {
    const parsed = parseJsonRecord(input.responseBody);
    const rateLimitHeaders = collectRateLimitHeaders(input.headers);
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    if (!parsed || input.statusCode >= 400 || isRecord(parsed.error)) {
        const error = asRecord(parsed?.error);
        const rawErrorType = geminiErrorStatus(error, parsed, input.statusCode);
        const rawErrorCode = geminiErrorCode(error);
        const errorMessage = stringValue(error?.message) ?? stringValue(parsed?.message) ?? "";
        const servedModel = input.requestModel;
        const errorClass = `http_${input.statusCode}:${rawErrorType}`;
        return {
            rateLimitHeaders,
            event: {
                schemaVersion: "v2",
                request: canonicalRequest(input, GEMINI_PROVIDER, GEMINI_SURFACE),
                response: {
                    statusCode: input.statusCode,
                    finishReason: "error",
                    content: errorMessage,
                    servedModel,
                    servedModelSource: "adapter_fallback",
                    ...(providerRequestId ? { providerRequestId } : {}),
                    ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                    rawErrorType,
                    ...(rawErrorCode ? { rawErrorCode } : {}),
                    ...(error ? { stopDetails: { error } } : {}),
                    providerSafety: geminiErrorSafety(rawErrorType),
                    errorClass,
                },
                usage: geminiUsageToCanonical({ input: 0, output: 0 }),
                timing: canonicalTiming(input.startedAt, input.endedAt, "error", input),
                attempts: canonicalAttempts(input, GEMINI_PROVIDER, servedModel, input.endedAt, "error", errorClass),
            },
        };
    }
    const candidates = geminiCandidates(parsed);
    const usage = readGeminiUsage(asRecord(parsed.usageMetadata));
    const modelVersion = stringValue(parsed.modelVersion);
    const servedModel = modelVersion ?? input.requestModel;
    const servedModelSource = modelVersion ? "provider_response" : "adapter_fallback";
    const providerResponseId = stringValue(parsed.responseId);
    const finishReason = normalizedFinishReason(firstFinishReason(candidates, parsed));
    const toolCalls = geminiToolCallsFromCandidates(candidates);
    const providerSafety = geminiProviderSafety(parsed, candidates);
    const stopDetails = geminiStopDetails(parsed, candidates);
    return {
        rateLimitHeaders,
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, GEMINI_PROVIDER, GEMINI_SURFACE),
            response: {
                statusCode: input.statusCode,
                finishReason,
                content: geminiContentText(candidates),
                servedModel,
                servedModelSource,
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                ...(toolCalls.length > 0 ? { rawToolCalls: toolCalls } : {}),
                ...(providerRequestId ? { providerRequestId } : {}),
                ...(providerResponseId ? { providerResponseId, rawObjectId: providerResponseId } : {}),
                ...(usage.serviceTier ? { serviceTier: usage.serviceTier } : {}),
                ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                ...(stopDetails ? { stopDetails } : {}),
                ...(providerSafety.length > 0 ? { providerSafety } : {}),
            },
            usage: geminiUsageToCanonical(usage),
            timing: canonicalTiming(input.startedAt, input.endedAt, "complete", input),
            attempts: canonicalAttempts(input, GEMINI_PROVIDER, servedModel, input.endedAt, "success"),
        },
    };
}
function observeGeminiStream(input) {
    const decoder = new TextDecoder();
    const parser = new SseAccumulator();
    const state = {
        content: "",
        finishReason: "",
        usage: { input: 0, output: 0 },
        toolCalls: [],
        providerSafety: [],
        timing: createStreamTimingCapture(),
    };
    return input.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            const observedAt = new Date();
            let observedContentDelta = false;
            for (const message of parser.push(decoder.decode(chunk, { stream: true }))) {
                observedContentDelta = applyGeminiStreamMessage(state, message.data, input.statusCode, observedAt) ||
                    observedContentDelta;
            }
            if (observedContentDelta)
                recordStreamToken(state.timing, observedAt);
            controller.enqueue(chunk);
        },
        flush() {
            const observedAt = new Date();
            const tail = decoder.decode();
            for (const message of [...parser.push(tail), ...parser.end()]) {
                if (applyGeminiStreamMessage(state, message.data, input.statusCode, observedAt)) {
                    recordStreamToken(state.timing, observedAt);
                }
            }
            if (state.timing.terminalStatus === "unknown") {
                state.timing.terminalStatus = geminiStreamTerminalStatus(input.statusCode, state);
            }
            input.onTerminal(finalizeGeminiStream(input, state));
        },
    }));
}
function applyGeminiStreamMessage(state, data, statusCode, observedAt) {
    const parsed = parseJsonRecord(data);
    if (!parsed)
        return false;
    recordStreamChunk(state.timing, observedAt);
    if (isRecord(parsed.error)) {
        const rawErrorType = geminiErrorStatus(parsed.error, parsed, statusCode);
        const rawErrorCode = geminiErrorCode(parsed.error);
        state.errorClass = `http_${statusCode}:${rawErrorType}`;
        state.rawErrorType = rawErrorType;
        state.rawErrorCode = rawErrorCode;
        state.finishReason = "error";
        state.providerSafety.push(...geminiErrorSafety(rawErrorType));
        state.timing.terminalStatus = "error";
        return false;
    }
    const responseId = stringValue(parsed.responseId);
    if (responseId)
        state.providerResponseId = responseId;
    const modelVersion = stringValue(parsed.modelVersion);
    if (modelVersion)
        state.modelVersion = modelVersion;
    const candidates = geminiCandidates(parsed);
    const contentDelta = geminiContentText(candidates);
    if (contentDelta)
        state.content += contentDelta;
    const finishReason = normalizedFinishReason(firstFinishReason(candidates, parsed));
    if (finishReason) {
        state.finishReason = finishReason;
        if (!state.errorClass && statusCode < 400)
            state.timing.terminalStatus = "complete";
    }
    state.toolCalls.push(...geminiToolCallsFromCandidates(candidates));
    state.providerSafety.push(...geminiProviderSafety(parsed, candidates));
    state.stopDetails = mergeStopDetails(state.stopDetails, geminiStopDetails(parsed, candidates));
    const usage = readGeminiUsage(asRecord(parsed.usageMetadata));
    if (usage.raw)
        state.usage = usage;
    return Boolean(contentDelta);
}
function finalizeGeminiStream(input, state) {
    const endedAt = new Date();
    const servedModel = state.modelVersion ?? input.requestModel;
    const servedModelSource = state.modelVersion ? "provider_response" : "adapter_fallback";
    const providerRequestId = providerRequestIdFromHeaders(input.headers);
    const sanitizedHeaders = sanitizedProviderHeaders(input.headers);
    const terminalStatus = state.errorClass || input.statusCode >= 400 ? "error" : "success";
    return {
        rateLimitHeaders: collectRateLimitHeaders(input.headers),
        event: {
            schemaVersion: "v2",
            request: canonicalRequest(input, GEMINI_PROVIDER, GEMINI_SURFACE),
            response: {
                statusCode: input.statusCode,
                finishReason: state.finishReason,
                content: state.content,
                servedModel,
                servedModelSource,
                ...(state.toolCalls.length > 0 ? { toolCalls: state.toolCalls } : {}),
                ...(state.toolCalls.length > 0 ? { rawToolCalls: state.toolCalls } : {}),
                ...(providerRequestId ? { providerRequestId } : {}),
                ...(state.providerResponseId ? { providerResponseId: state.providerResponseId, rawObjectId: state.providerResponseId } : {}),
                ...(state.usage.serviceTier ? { serviceTier: state.usage.serviceTier } : {}),
                ...(sanitizedHeaders ? { sanitizedHeaders } : {}),
                ...(state.stopDetails ? { stopDetails: state.stopDetails } : {}),
                ...(state.providerSafety.length > 0 ? { providerSafety: state.providerSafety } : {}),
                ...(state.rawErrorType ? { rawErrorType: state.rawErrorType } : {}),
                ...(state.rawErrorCode ? { rawErrorCode: state.rawErrorCode } : {}),
                ...(state.errorClass ? { errorClass: state.errorClass } : {}),
            },
            usage: geminiUsageToCanonical(state.usage),
            timing: streamTiming(input.startedAt, endedAt, state.timing, { ...input, providerResponseEndedAt: endedAt }),
            attempts: canonicalAttempts({ ...input, providerResponseEndedAt: endedAt }, GEMINI_PROVIDER, servedModel, endedAt, terminalStatus, state.errorClass),
        },
    };
}
function generateContentPayload(body) {
    return sanitizeGeminiGenerateContentPayload(body).payload;
}
function geminiStreamTerminalStatus(statusCode, state) {
    if (state.errorClass || statusCode >= 400)
        return "error";
    return state.finishReason ? "complete" : "aborted";
}
function geminiModelPath(value) {
    const model = stringValue(value) ?? "models/provider_default";
    return model.startsWith("models/") ? model : `models/${model}`;
}
function geminiCandidates(parsed) {
    return Array.isArray(parsed.candidates) ? parsed.candidates.filter(isRecord) : [];
}
function firstFinishReason(candidates, parsed) {
    const first = candidates[0];
    return stringValue(first?.finishReason) ??
        stringValue(asRecord(parsed.promptFeedback)?.blockReason);
}
function normalizedFinishReason(value) {
    if (!value)
        return "";
    if (value === "MAX_TOKENS")
        return "max_tokens";
    return value.toLowerCase();
}
function geminiContentText(candidates) {
    return candidates
        .map((candidate) => textFromGeminiContent(asRecord(candidate.content)))
        .filter((text) => text.length > 0)
        .join("\n");
}
function textFromGeminiContent(content) {
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return parts
        .filter(isRecord)
        .map((part) => stringValue(part.text) ?? "")
        .join("");
}
function geminiToolCallsFromCandidates(candidates) {
    return candidates.flatMap((candidate, candidateIndex) => {
        const content = asRecord(candidate.content);
        const parts = Array.isArray(content?.parts) ? content.parts.filter(isRecord) : [];
        return parts.flatMap((part, partIndex) => {
            const functionCall = asRecord(part.functionCall);
            if (!functionCall)
                return [];
            const name = stringValue(functionCall.name);
            const id = stringValue(functionCall.id);
            return [{
                    type: "function_call",
                    provider: GEMINI_PROVIDER,
                    candidateIndex,
                    partIndex,
                    functionCall,
                    ...(id ? { id } : {}),
                    ...(name ? { name } : {}),
                    ...(Object.prototype.hasOwnProperty.call(functionCall, "args") ? { args: functionCall.args } : {}),
                }];
        });
    });
}
function geminiProviderSafety(parsed, candidates) {
    const safety = [];
    const promptFeedback = asRecord(parsed.promptFeedback);
    const blockReason = stringValue(promptFeedback?.blockReason);
    if (blockReason) {
        safety.push({
            kind: "content_filter",
            source: "provider",
            reason: blockReason,
            raw: {
                fieldPath: "promptFeedback.blockReason",
                promptFeedback,
            },
        });
    }
    candidates.forEach((candidate, index) => {
        const finishReason = stringValue(candidate.finishReason);
        if (finishReason && GEMINI_POLICY_FINISH_REASONS.has(finishReason)) {
            safety.push({
                kind: "content_filter",
                source: "provider",
                reason: finishReason,
                raw: {
                    fieldPath: `candidates[${index}].finishReason`,
                    finishReason,
                },
            });
        }
        const blockingSafetyRatings = blockingGeminiSafetyRatings(candidate);
        if (blockingSafetyRatings.length > 0) {
            safety.push({
                kind: "safety",
                source: "provider",
                reason: finishReason ?? "safety_ratings",
                raw: {
                    fieldPath: `candidates[${index}].safetyRatings`,
                    safetyRatings: blockingSafetyRatings,
                },
            });
        }
    });
    return safety;
}
function blockingGeminiSafetyRatings(candidate) {
    const safetyRatings = Array.isArray(candidate.safetyRatings)
        ? candidate.safetyRatings.filter(isRecord)
        : [];
    return safetyRatings.filter((rating) => {
        const probability = stringValue(rating.probability)?.toUpperCase();
        return rating.blocked === true || probability === "BLOCKED";
    });
}
function geminiErrorSafety(rawErrorType) {
    return /policy|safety|permission|blocked|prohibited|recitation/i.test(rawErrorType)
        ? [{ kind: "safety", source: "provider", reason: rawErrorType }]
        : [];
}
function geminiStopDetails(parsed, candidates) {
    const candidateDetails = candidates.flatMap((candidate, index) => {
        const finishReason = stringValue(candidate.finishReason);
        const finishMessage = stringValue(candidate.finishMessage);
        if (!finishReason && !finishMessage)
            return [];
        return [{
                candidateIndex: index,
                ...(finishReason ? { finishReason } : {}),
                ...(finishMessage ? { finishMessage } : {}),
                ...(finishReason && GEMINI_TOOL_VALIDITY_FINISH_REASONS.has(finishReason)
                    ? { toolValidityEvidence: true }
                    : {}),
            }];
    });
    const promptFeedback = asRecord(parsed.promptFeedback);
    if (candidateDetails.length === 0 && !promptFeedback)
        return undefined;
    return {
        ...(candidateDetails.length > 0 ? { candidates: candidateDetails } : {}),
        ...(promptFeedback ? { promptFeedback } : {}),
    };
}
function readGeminiUsage(usage) {
    const promptTokenCount = numberValue(usage?.promptTokenCount) ?? 0;
    const cachedContentTokenCount = numberValue(usage?.cachedContentTokenCount);
    const cacheRead = cachedContentTokenCount ?? 0;
    const candidatesTokenCount = numberValue(usage?.candidatesTokenCount) ?? 0;
    const thoughtsTokenCount = numberValue(usage?.thoughtsTokenCount);
    const totalTokenCount = numberValue(usage?.totalTokenCount);
    const audioCacheRead = modalityTokenCount(cacheTokenDetails(usage), GEMINI_AUDIO_MODALITY);
    const audioPrompt = modalityTokenCount(promptTokenDetails(usage), GEMINI_AUDIO_MODALITY);
    const audioInput = audioPrompt === undefined
        ? undefined
        : Math.max(0, audioPrompt - (audioCacheRead ?? 0));
    return {
        input: Math.max(0, promptTokenCount - cacheRead),
        output: candidatesTokenCount,
        cacheRead: cachedContentTokenCount,
        thoughts: thoughtsTokenCount,
        total: totalTokenCount,
        thoughtPricingStatus: geminiThoughtPricingStatus({
            promptTokenCount,
            candidatesTokenCount,
            thoughtsTokenCount,
            totalTokenCount,
        }),
        audioInput,
        audioCacheRead,
        toolUsePrompt: numberValue(usage?.toolUsePromptTokenCount),
        serviceTier: stringValue(usage?.serviceTier),
        ...(usage ? { raw: usage } : {}),
    };
}
function geminiUsageToCanonical(usage) {
    return {
        input: usage.input,
        output: usage.output,
        ...(usage.cacheRead !== undefined ? { cache: { read: usage.cacheRead } } : {}),
        ...(usage.raw ? { raw: usage.raw } : {}),
        categories: geminiUsageCategories(usage),
        usageSource: usage.raw ? "provider" : "missing",
        ...(usage.serviceTier ? { serviceTier: usage.serviceTier } : {}),
    };
}
function geminiUsageCategories(usage) {
    return [
        { category: "input", tokens: usage.input, sourceField: "promptTokenCount - cachedContentTokenCount" },
        { category: "output", tokens: usage.output, sourceField: "candidatesTokenCount" },
        ...optionalCategory("cache_read", usage.cacheRead, "cachedContentTokenCount"),
        ...optionalCategory(geminiThoughtCategory(usage), usage.thoughts, "thoughtsTokenCount"),
        ...optionalCategory("provider:gemini:totalTokenCount", usage.total, "totalTokenCount"),
        ...optionalCategory("audio_input", usage.audioInput, "promptTokensDetails[AUDIO] - cacheTokensDetails[AUDIO]"),
        ...optionalCategory("audio_cache_read", usage.audioCacheRead, "cacheTokensDetails[AUDIO]"),
        ...optionalCategory("provider:gemini:toolUsePromptTokenCount", usage.toolUsePrompt, "toolUsePromptTokenCount"),
    ];
}
function geminiThoughtCategory(usage) {
    return usage.thoughtPricingStatus === "additive_total_reconciled"
        ? "gemini_thinking"
        : "gemini_thinking_unverified";
}
function geminiThoughtPricingStatus(input) {
    if (input.thoughtsTokenCount === undefined)
        return undefined;
    if (input.totalTokenCount === undefined)
        return "total_absent";
    return input.promptTokenCount + input.candidatesTokenCount + input.thoughtsTokenCount === input.totalTokenCount
        ? "additive_total_reconciled"
        : "total_inconsistent";
}
function optionalCategory(category, tokens, sourceField) {
    return tokens === undefined
        ? []
        : [{ category, tokens, sourceField }];
}
function promptTokenDetails(usage) {
    return modalityDetails(usage?.promptTokensDetails);
}
function cacheTokenDetails(usage) {
    const details = modalityDetails(usage?.cacheTokensDetails);
    return details.length > 0 ? details : modalityDetails(usage?.cachedContentTokensDetails);
}
function modalityDetails(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}
function modalityTokenCount(details, modality) {
    const tokens = details
        .filter((detail) => stringValue(detail.modality)?.toUpperCase() === modality)
        .map((detail) => numberValue(detail.tokenCount) ?? 0);
    if (tokens.length === 0)
        return undefined;
    return tokens.reduce((total, tokenCount) => total + tokenCount, 0);
}
function geminiErrorStatus(error, parsed, statusCode) {
    return stringValue(error?.status) ??
        stringValue(error?.type) ??
        stringValue(parsed?.status) ??
        `HTTP_${statusCode}`;
}
function geminiErrorCode(error) {
    const code = error?.code;
    if (typeof code === "number")
        return String(code);
    return stringValue(code);
}
function mergeStopDetails(left, right) {
    if (!left)
        return right;
    if (!right)
        return left;
    return compactRecord({
        ...left,
        ...right,
        candidates: [
            ...(Array.isArray(left.candidates) ? left.candidates : []),
            ...(Array.isArray(right.candidates) ? right.candidates : []),
        ],
    });
}
//# sourceMappingURL=gemini.js.map