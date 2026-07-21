import { runStreamTerminationDetectors } from "@inferock/measure/stream-termination";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import { providerRequestIdFromHeaders, sanitizedProviderReceiptHeaders, } from "./provider-call.js";
import { providerErrorReason } from "./provider-error.js";
import { CONFORMANCE_LEDGER_SCHEMA_VERSION, validationEligibility, } from "./types.js";
export async function runStreamSseConformance(input) {
    const entries = [];
    for (const probe of input.probes) {
        const result = await input.providerCall(probe);
        if (input.writer) {
            await input.writer.writeRawNdjson(probe.probeId, streamSseRawFrameRows(result.frames));
            if (result.usage)
                await input.writer.writeRawJson(probe.probeId, "usage", result.usage);
            if (result.providerErrorBody) {
                await input.writer.writeRawJson(probe.probeId, "provider-error", result.providerErrorBody);
            }
        }
        const entry = streamSseLedgerEntry({
            runId: input.runId,
            probe,
            result,
        });
        if (input.writer)
            await input.writer.appendLedger(entry);
        entries.push(entry);
    }
    return { entries };
}
export function streamSseLedgerEntry(input) {
    const frameEvidence = streamFrameEvidence(input.probe, input.result);
    const canonicalEvent = canonicalStreamEvent({
        probe: input.probe,
        result: input.result,
        frameEvidence,
    });
    const streamSignals = runStreamTerminationDetectors(canonicalEvent);
    const signalCodes = streamSignals.map((signal) => signal.code);
    const hasSignal = streamSignals.length > 0;
    const providerError = input.result.statusCode >= 400;
    const providerErrorReasonText = providerError
        ? providerErrorReason(input.result.statusCode, input.result.providerErrorBody)
        : undefined;
    const terminalEvidenceObserved = frameEvidence.normalizedTerminalStatus === "complete" ||
        frameEvidence.normalizedTerminalStatus === "error";
    const streamEvidenceObserved = frameEvidence.rawFrameCount > 0;
    const openable = streamEvidenceObserved && terminalEvidenceObserved;
    const openabilityStatus = hasSignal
        ? "signal"
        : openable
            ? "watched_clean"
            : "not_openable";
    const notOpenableReason = providerError
        ? providerErrorReasonText ?? `provider returned HTTP ${input.result.statusCode}`
        : streamEvidenceObserved
            ? "stream request without terminal evidence"
            : "not a streaming request";
    return {
        schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
        runId: input.runId,
        probeId: input.probe.probeId,
        module: "stream_sse",
        mode: "real_provider",
        provider: input.probe.provider,
        providerSurface: input.probe.providerSurface,
        model: input.probe.model,
        startedAt: input.result.startedAt,
        endedAt: input.result.endedAt,
        status: hasSignal ? "signal" : openable ? "passed" : "not_openable",
        openability: {
            surfaceOpened: openable,
            status: openabilityStatus,
            ...(openable
                ? {
                    label: "watched-clean: stream timing carried terminal evidence with no stream anomaly",
                }
                : {
                    reason: notOpenableReason,
                    label: `not-openable: ${notOpenableReason}`,
                }),
            watchedEvidence: {
                streamEvidenceObserved,
                terminalEvidenceObserved,
                rawFrameCount: frameEvidence.rawFrameCount,
                normalizedTerminalStatus: frameEvidence.normalizedTerminalStatus,
                signalCodes,
            },
        },
        validationMetadata: ["billing_observation_pending"],
        ...validationEligibility(),
        request: {
            bodyHash: stableSha256(input.probe.requestBody),
            promptId: input.probe.promptId,
            syntheticContentOnly: true,
        },
        rawEvidence: {
            rawFrameCount: frameEvidence.rawFrameCount,
            rawEventTypes: [...frameEvidence.rawEventTypes],
            rawTerminalMarkers: [...frameEvidence.rawTerminalMarkers],
            normalizedTerminalStatus: frameEvidence.normalizedTerminalStatus,
            contentDeltaCount: frameEvidence.contentDeltaCount,
            ...(input.result.firstByteAt ? { firstByteAt: input.result.firstByteAt } : {}),
            ...(input.result.timeToFirstByteMs !== undefined ? { timeToFirstByteMs: input.result.timeToFirstByteMs } : {}),
            ...(frameEvidence.firstVisibleDeltaAt ? { firstVisibleDeltaAt: frameEvidence.firstVisibleDeltaAt } : {}),
            providerReceipt: frameEvidence.providerReceipt,
            ...(input.result.providerErrorBody ? { providerErrorBody: input.result.providerErrorBody } : {}),
        },
        canonical: {
            timing: canonicalTimingEvidence(canonicalEvent.timing),
            request: {
                requestId: canonicalEvent.request.requestId,
                bodyHash: canonicalEvent.request.bodyHash ?? stableSha256(input.probe.requestBody),
            },
            response: {
                statusCode: canonicalEvent.response.statusCode,
                finishReason: canonicalEvent.response.finishReason,
                ...(canonicalEvent.response.providerRequestId
                    ? { providerRequestId: canonicalEvent.response.providerRequestId }
                    : {}),
                ...(canonicalEvent.response.providerResponseId
                    ? { providerResponseId: canonicalEvent.response.providerResponseId }
                    : {}),
                ...(canonicalEvent.response.rawObjectId ? { rawObjectId: canonicalEvent.response.rawObjectId } : {}),
            },
            usage: canonicalEvent.usage,
        },
        detectors: {
            streamTerminationSignals: streamSignals,
            signalCodes,
        },
    };
}
export function streamSseProbes(input) {
    const probes = [];
    if (input.providers.includes("openai")) {
        probes.push({
            probeId: "stream-sse-openai-responses-001",
            provider: "openai",
            providerSurface: "openai_responses",
            model: input.models.openai,
            promptId: "normal-release-checklist-v1",
            requestBody: {
                model: input.models.openai,
                stream: true,
                input: "Write a concise release checklist for a small TypeScript library.",
                max_output_tokens: 384,
            },
        });
        probes.push({
            probeId: "stream-sse-openai-chat-001",
            provider: "openai",
            providerSurface: "chat_completions",
            model: input.models.openai,
            promptId: "normal-technical-summary-v1",
            requestBody: {
                model: input.models.openai,
                stream: true,
                stream_options: { include_usage: true },
                messages: [
                    { role: "user", content: "Summarize how HTTP server-sent events are consumed by a client." },
                ],
                max_completion_tokens: 384,
            },
        });
    }
    if (input.providers.includes("anthropic")) {
        probes.push({
            probeId: "stream-sse-anthropic-messages-001",
            provider: "anthropic",
            providerSurface: "anthropic_messages",
            model: input.models.anthropic,
            promptId: "normal-multistep-explanation-v1",
            requestBody: {
                model: input.models.anthropic,
                stream: true,
                max_tokens: 384,
                messages: [
                    { role: "user", content: "Explain in three steps how to triage a failed CI run." },
                ],
            },
        });
    }
    return probes;
}
function streamFrameEvidence(probe, result) {
    const eventTypes = [];
    const terminalMarkers = [];
    let normalizedTerminalStatus = "unknown";
    let contentDeltaCount = 0;
    let firstVisibleDeltaAt;
    let content = "";
    let responseId = result.responseId;
    let rawObjectId = result.rawObjectId;
    let rawErrorType;
    let rawErrorCode;
    for (const frame of result.frames) {
        const eventType = frame.event ?? "message";
        eventTypes.push(eventType);
        if (frame.data === "[DONE]") {
            terminalMarkers.push("[DONE]");
            normalizedTerminalStatus = "complete";
            continue;
        }
        const parsed = parseFrameData(frame.data);
        responseId = responseId ?? stringField(parsed, "id") ?? nestedStringField(parsed, "response", "id");
        rawObjectId = rawObjectId ?? stringField(parsed, "id");
        if (eventType === "response.completed" || eventType === "message_stop") {
            terminalMarkers.push(eventType);
            normalizedTerminalStatus = "complete";
        }
        else if (eventType === "response.incomplete" || eventType === "response.failed" || eventType === "error") {
            terminalMarkers.push(eventType === "error" ? "event:error" : eventType);
            normalizedTerminalStatus = "error";
        }
        const delta = visibleDeltaForFrame(probe.providerSurface, eventType, parsed);
        if (delta) {
            content += delta;
            contentDeltaCount += 1;
            firstVisibleDeltaAt = firstVisibleDeltaAt ?? frame.observedAt;
        }
        rawErrorType = rawErrorType ?? nestedStringField(parsed, "error", "type");
        rawErrorCode = rawErrorCode ?? nestedStringField(parsed, "error", "code");
    }
    if (normalizedTerminalStatus === "unknown" && result.terminationCause) {
        normalizedTerminalStatus = "aborted";
        rawErrorType = rawErrorType ?? result.terminationCause;
        rawErrorCode = rawErrorCode ?? result.terminationCause;
    }
    const providerRequestId = providerRequestIdFromHeaders(result.headers);
    return {
        rawFrameCount: result.frames.length,
        rawEventTypes: [...new Set(eventTypes)],
        rawTerminalMarkers: terminalMarkers,
        normalizedTerminalStatus,
        contentDeltaCount,
        ...(firstVisibleDeltaAt ? { firstVisibleDeltaAt } : {}),
        content: result.content ?? content,
        providerReceipt: {
            ...(providerRequestId ? { providerRequestId } : {}),
            ...(responseId ? { responseId } : {}),
            ...(rawObjectId ? { rawObjectId } : {}),
            sanitizedHeaders: sanitizedProviderReceiptHeaders(result.headers),
        },
        ...(rawErrorType ? { rawErrorType } : {}),
        ...(rawErrorCode ? { rawErrorCode } : {}),
    };
}
function canonicalStreamEvent(input) {
    const timing = streamTimingFromFrames(input.result, input.frameEvidence.normalizedTerminalStatus);
    const timingEvidence = timing;
    const providerRequestId = providerRequestIdFromHeaders(input.result.headers);
    const providerReceipt = input.frameEvidence.providerReceipt;
    const providerResponseId = stringRecordField(providerReceipt, "responseId");
    const rawObjectId = stringRecordField(providerReceipt, "rawObjectId");
    const status = input.result.statusCode >= 400 || input.result.errorClass ? "error" : "success";
    const responseError = input.result.errorClass ?? input.frameEvidence.rawErrorType;
    return {
        schemaVersion: "v2",
        request: {
            tenantId: "inferock-conformance-validation",
            provider: input.probe.provider,
            requestId: input.result.requestId,
            ...(providerRequestId ? { providerRequestId } : {}),
            requestedModel: input.probe.model,
            model: input.probe.model,
            attemptIndex: 0,
            bodyHash: stableSha256(input.probe.requestBody),
            bodyHashAlgorithm: "sha256",
            bodyHashCanonicalization: "normalized_json_v1",
            expectCompletion: true,
            generation: input.probe.requestBody,
        },
        response: {
            statusCode: input.result.statusCode,
            finishReason: input.result.finishReason ?? input.frameEvidence.normalizedTerminalStatus,
            content: input.frameEvidence.content,
            servedModel: input.probe.model,
            ...(providerRequestId ? { providerRequestId } : {}),
            ...(providerResponseId ? { providerResponseId } : {}),
            ...(rawObjectId ? { rawObjectId } : {}),
            sanitizedHeaders: sanitizedProviderReceiptHeaders(input.result.headers),
            ...(input.frameEvidence.rawErrorType ? { rawErrorType: input.frameEvidence.rawErrorType } : {}),
            ...(input.frameEvidence.rawErrorCode ? { rawErrorCode: input.frameEvidence.rawErrorCode } : {}),
            ...(responseError ? { errorClass: responseError } : {}),
        },
        usage: usageFromResult(input.result, input.probe.provider),
        timing,
        attempts: [{
                attemptNumber: 0,
                provider: input.probe.provider,
                model: input.probe.model,
                status,
                timing: {
                    startedAt: timing.startedAt,
                    endedAt: timing.endedAt,
                    latencyMs: timing.latencyMs,
                    ...(timing.providerRequestStartedAt ? { providerRequestStartedAt: timing.providerRequestStartedAt } : {}),
                    ...(timing.providerResponseEndedAt ? { providerResponseEndedAt: timing.providerResponseEndedAt } : {}),
                    ...(timing.providerElapsedMs !== undefined ? { providerElapsedMs: timing.providerElapsedMs } : {}),
                    ...(timing.gatewayOverheadMs !== undefined ? { gatewayOverheadMs: timing.gatewayOverheadMs } : {}),
                    ...(timingEvidence.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: timingEvidence.monotonicElapsedMs } : {}),
                    ...(timingEvidence.monotonicClockSource ? { monotonicClockSource: timingEvidence.monotonicClockSource } : {}),
                    ...(timingEvidence.wallClockDrift ? { wallClockDrift: timingEvidence.wallClockDrift } : {}),
                    ...(timing.firstByteAt ? { firstByteAt: timing.firstByteAt } : {}),
                    ...(timing.firstTokenAt ? { firstTokenAt: timing.firstTokenAt } : {}),
                    ...(timing.lastChunkAt ? { lastChunkAt: timing.lastChunkAt } : {}),
                    ...(timing.timeToFirstByteMs !== undefined ? { timeToFirstByteMs: timing.timeToFirstByteMs } : {}),
                    ...(timing.timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs: timing.timeToFirstTokenMs } : {}),
                },
                ...(responseError ? { errorClass: responseError } : {}),
                statusCode: input.result.statusCode,
                ...(providerRequestId ? { providerRequestId } : {}),
                sanitizedHeaders: sanitizedProviderReceiptHeaders(input.result.headers),
                finalSelected: true,
            }],
    };
}
function streamTimingFromFrames(result, terminalStatus) {
    const startedMs = Date.parse(result.startedAt);
    const endedMs = Date.parse(result.endedAt);
    const firstEventFrame = result.frames[0];
    const firstContentDeltaFrame = firstContentDeltaFrameFor(result.frames);
    const frameTimes = result.frames.map((frame) => frameElapsedMs(frame, startedMs));
    const firstEventMs = firstEventFrame ? Date.parse(firstEventFrame.observedAt) : undefined;
    const firstByteMs = result.firstByteAt ? Date.parse(result.firstByteAt) : firstEventMs;
    const lastChunkMs = result.frames.length > 0 ? Date.parse(result.frames[result.frames.length - 1]?.observedAt ?? "") : undefined;
    const gaps = frameTimes.slice(1).map((value, index) => value - (frameTimes[index] ?? value));
    const maxGap = gaps.length > 0 ? Math.max(...gaps) : undefined;
    const totalDuration = resultDurationEvidence(result, startedMs, endedMs);
    return {
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        latencyMs: totalDuration.latencyMs,
        ...(result.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: result.monotonicElapsedMs } : {}),
        ...(result.monotonicClockSource ? { monotonicClockSource: result.monotonicClockSource } : {}),
        ...(totalDuration.wallClockDrift ? { wallClockDrift: totalDuration.wallClockDrift } : {}),
        ...(firstEventFrame ? { firstEventAt: firstEventFrame.observedAt } : {}),
        ...(result.firstByteAt ? { firstByteAt: result.firstByteAt } : firstByteMs !== undefined && Number.isFinite(firstByteMs)
            ? { firstByteAt: new Date(firstByteMs).toISOString() }
            : {}),
        ...(firstContentDeltaFrame ? { firstContentDeltaAt: firstContentDeltaFrame.observedAt } : {}),
        ...(firstContentDeltaFrame ? { firstTokenAt: firstContentDeltaFrame.observedAt } : {}),
        ...(lastChunkMs !== undefined && Number.isFinite(lastChunkMs) ? { lastChunkAt: new Date(lastChunkMs).toISOString() } : {}),
        ...(firstEventFrame ? { timeToFirstEventMs: frameElapsedMs(firstEventFrame, startedMs) } : {}),
        ...(result.timeToFirstByteMs !== undefined ? { timeToFirstByteMs: result.timeToFirstByteMs } : firstByteMs !== undefined
            ? { timeToFirstByteMs: elapsedMs(startedMs, firstByteMs) }
            : {}),
        ...(firstContentDeltaFrame
            ? { timeToFirstContentDeltaMs: frameElapsedMs(firstContentDeltaFrame, startedMs) }
            : {}),
        ...(firstContentDeltaFrame
            ? { timeToFirstTokenMs: frameElapsedMs(firstContentDeltaFrame, startedMs) }
            : {}),
        chunkCount: result.frames.length,
        ...(maxGap !== undefined ? { maxInterChunkGapMs: maxGap } : {}),
        ...(maxGap !== undefined ? { maxStreamGapMs: maxGap } : {}),
        terminalStatus,
    };
}
function usageFromResult(result, provider) {
    const inputTokens = numberFromUsage(result.usage, ["input_tokens", "prompt_tokens"]) ?? 8;
    const outputTokens = numberFromUsage(result.usage, ["output_tokens", "completion_tokens"]) ?? 2;
    return {
        input: inputTokens,
        output: outputTokens,
        cache: { read: 0, creation: 0 },
        raw: result.usage,
        categories: [
            { category: "input", tokens: inputTokens, provider },
            { category: "output", tokens: outputTokens, provider },
        ],
        usageSource: result.usage ? "provider" : "missing",
    };
}
function visibleDeltaForFrame(surface, eventType, parsed) {
    if (!parsed || typeof parsed !== "object")
        return "";
    const record = parsed;
    if (surface === "openai_responses") {
        return eventType === "response.output_text.delta" && typeof record.delta === "string" ? record.delta : "";
    }
    if (surface === "chat_completions") {
        const choices = Array.isArray(record.choices) ? record.choices : [];
        return choices
            .map((choice) => nestedStringField(choice, "delta", "content") ?? "")
            .join("");
    }
    if (eventType === "content_block_delta") {
        return nestedStringField(record, "delta", "text") ?? "";
    }
    return "";
}
export function streamSseRawFrameRows(frames) {
    return frames.map((frame, index) => ({
        index,
        observedAt: frame.observedAt,
        ...(frame.observedMonotonicElapsedMs !== undefined
            ? { observedMonotonicElapsedMs: frame.observedMonotonicElapsedMs }
            : {}),
        eventType: frame.event ?? "message",
        dataHash: stableSha256({ data: frame.data }),
        terminalMarker: frame.data === "[DONE]" ||
            frame.event === "response.completed" ||
            frame.event === "response.incomplete" ||
            frame.event === "response.failed" ||
            frame.event === "message_stop" ||
            frame.event === "error",
    }));
}
function canonicalTimingEvidence(timing) {
    const timingEvidence = timing;
    return {
        chunkCount: timing.chunkCount,
        ...(timing.firstEventAt ? { firstEventAt: timing.firstEventAt } : {}),
        ...(timing.firstByteAt ? { firstByteAt: timing.firstByteAt } : {}),
        ...(timing.firstContentDeltaAt ? { firstContentDeltaAt: timing.firstContentDeltaAt } : {}),
        ...(timing.firstTokenAt ? { firstTokenAt: timing.firstTokenAt } : {}),
        ...(timing.lastChunkAt ? { lastChunkAt: timing.lastChunkAt } : {}),
        ...(timing.timeToFirstEventMs !== undefined ? { timeToFirstEventMs: timing.timeToFirstEventMs } : {}),
        ...(timing.timeToFirstByteMs !== undefined ? { timeToFirstByteMs: timing.timeToFirstByteMs } : {}),
        ...(timing.timeToFirstContentDeltaMs !== undefined
            ? { timeToFirstContentDeltaMs: timing.timeToFirstContentDeltaMs }
            : {}),
        ...(timing.timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs: timing.timeToFirstTokenMs } : {}),
        ...(timingEvidence.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: timingEvidence.monotonicElapsedMs } : {}),
        ...(timingEvidence.monotonicClockSource ? { monotonicClockSource: timingEvidence.monotonicClockSource } : {}),
        ...(timingEvidence.wallClockDrift ? { wallClockDrift: wallClockDriftJson(timingEvidence.wallClockDrift) } : {}),
        ...(timing.maxInterChunkGapMs !== undefined ? { maxInterChunkGapMs: timing.maxInterChunkGapMs } : {}),
        ...(timing.maxStreamGapMs !== undefined ? { maxStreamGapMs: timing.maxStreamGapMs } : {}),
        terminalStatus: timing.terminalStatus,
    };
}
function firstContentDeltaFrameFor(frames) {
    return frames.find((frame) => frame.data !== "[DONE]" &&
        (frame.event === "response.output_text.delta" ||
            frame.event === "content_block_delta" ||
            frame.data.includes("\"delta\"")));
}
function frameElapsedMs(frame, startedMs) {
    if (frame.observedMonotonicElapsedMs !== undefined && Number.isFinite(frame.observedMonotonicElapsedMs)) {
        return frame.observedMonotonicElapsedMs;
    }
    return elapsedMs(startedMs, Date.parse(frame.observedAt));
}
function wallClockDriftJson(drift) {
    return {
        kind: drift.kind,
        wallClockElapsedMs: drift.wallClockElapsedMs,
        monotonicElapsedMs: drift.monotonicElapsedMs,
        driftMs: drift.driftMs,
    };
}
function parseFrameData(data) {
    if (data === "[DONE]")
        return null;
    try {
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
function numberFromUsage(usage, fields) {
    if (!usage)
        return undefined;
    for (const field of fields) {
        const value = usage[field];
        if (typeof value === "number")
            return value;
    }
    return undefined;
}
function stringField(value, key) {
    if (!value || typeof value !== "object")
        return undefined;
    const field = value[key];
    return typeof field === "string" ? field : undefined;
}
function nestedStringField(value, parent, key) {
    if (!value || typeof value !== "object")
        return undefined;
    const child = value[parent];
    return stringField(child, key);
}
function stringRecordField(value, key) {
    const field = value[key];
    return typeof field === "string" ? field : undefined;
}
function elapsedMs(startedMs, endedMs) {
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs))
        return 0;
    return Math.max(0, endedMs - startedMs);
}
function resultDurationEvidence(result, startedMs, endedMs) {
    const wallClockElapsedMs = endedMs - startedMs;
    if (result.monotonicElapsedMs !== undefined) {
        return {
            latencyMs: result.monotonicElapsedMs,
            ...(result.wallClockDrift ? { wallClockDrift: result.wallClockDrift } : {}),
        };
    }
    if (!Number.isFinite(wallClockElapsedMs))
        return { latencyMs: 0 };
    if (wallClockElapsedMs < 0) {
        return {
            latencyMs: 0,
            wallClockDrift: {
                kind: "negative_wall_clock_elapsed",
                wallClockElapsedMs,
                monotonicElapsedMs: 0,
                driftMs: wallClockElapsedMs,
            },
        };
    }
    return { latencyMs: wallClockElapsedMs };
}
//# sourceMappingURL=stream-sse.js.map