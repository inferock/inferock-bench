import { normalizeCanonicalEvent, } from "@inferock/measure/canonical-event";
import { countOpenAiOutputTokens, detectOpenAiTokenRecount, } from "@inferock/measure/billing-integrity";
import { billedVisibleAnthropicOutputTokens, buildAnthropicTokenCrossCheckSignal, crossCheckAnthropicOutputTokens, } from "@inferock/measure/anthropic-token-crosscheck";
import { runDetectors } from "@inferock/measure";
import { isHiddenOutputUsageCategory } from "@inferock/measure/usage-categories";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import { CONFORMANCE_LEDGER_SCHEMA_VERSION, validationEligibility, } from "./types.js";
import { providerErrorReason } from "./provider-error.js";
export async function runHiddenTokenConformance(input) {
    const entries = [];
    for (const probe of input.probes) {
        const result = await input.providerCall(probe);
        if (input.writer) {
            await input.writer.writeRawJson(probe.probeId, "usage", result.rawUsage);
            if (result.providerErrorBody) {
                await input.writer.writeRawJson(probe.probeId, "provider-error", result.providerErrorBody);
            }
        }
        const entry = hiddenTokenLedgerEntry({
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
export function hiddenTokenLedgerEntry(input) {
    const event = canonicalHiddenTokenEvent(input.probe, input.result);
    const detectorEvent = normalizeCanonicalEvent(event);
    const hiddenCategoryNames = hiddenUsageCategoryNames(event.usage.categories);
    const recognizedHiddenOutputTokens = recognizedHiddenTokens(event.usage.categories);
    const detectorSignals = runDetectors(detectorEvent);
    const billedEmptyFired = detectorSignals.some((signal) => signal.code === "BILLED_EMPTY");
    const openAiRecount = openAiRecountDiagnostic(event);
    const anthropicCrossCheck = anthropicCrossCheckDiagnostic(event);
    const anomalyCodes = [
        ...detectorSignals.map((signal) => signal.code),
        ...(openAiRecount.openAiTokenRecountMismatchFired ? ["OPENAI_TOKEN_RECOUNT_MISMATCH"] : []),
        ...(anthropicCrossCheck.anthropicTokenCrossCheckFired ? ["ANTHROPIC_TOKEN_CROSSCHECK"] : []),
    ];
    const providerError = input.result.statusCode >= 400;
    const providerErrorReasonText = providerError
        ? providerErrorReason(input.result.statusCode, input.result.providerErrorBody)
        : undefined;
    const positiveProbe = input.probe.kind === "positive";
    const hiddenObserved = recognizedHiddenOutputTokens > 0;
    const negativeControl = input.probe.kind !== "positive";
    const signal = anomalyCodes.some((code) => code === "BILLED_EMPTY" ||
        code === "OPENAI_TOKEN_RECOUNT_MISMATCH" ||
        code === "ANTHROPIC_TOKEN_CROSSCHECK");
    const status = providerError ? "inconclusive" : signal
        ? "signal"
        : positiveProbe && !hiddenObserved
            ? "inconclusive"
            : "passed";
    const surfaceStatus = providerError ? "not_openable" : signal
        ? "signal"
        : positiveProbe
            ? hiddenObserved ? "watched_clean" : "not_openable"
            : "watched_clean";
    return {
        schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
        runId: input.runId,
        probeId: input.probe.probeId,
        module: "hidden_token",
        mode: "real_provider",
        provider: input.probe.provider,
        providerSurface: negativeControl ? "hidden_token_negative_control" : input.probe.providerSurface,
        model: input.probe.model,
        startedAt: input.result.startedAt,
        endedAt: input.result.endedAt,
        status,
        openability: {
            surfaceOpened: providerError ? false : positiveProbe ? hiddenObserved : true,
            status: surfaceStatus,
            label: providerError
                ? `not-openable: ${providerErrorReasonText}`
                : hiddenTokenOpenabilityLabel({
                    positiveProbe,
                    hiddenObserved,
                    signal,
                    negativeControlKind: negativeControl ? input.probe.kind : undefined,
                }),
            watchedEvidence: {
                rawUsagePresent: true,
                selectedModel: input.probe.model,
                requestMode: input.probe.kind,
                hiddenCategoryNames: [...hiddenCategoryNames],
                recognizedHiddenOutputTokens,
            },
            ...(providerError
                ? {
                    reason: providerErrorReasonText,
                }
                : !positiveProbe || hiddenObserved || signal
                    ? {}
                    : {
                        reason: "hidden-token surface not opened; provider returned no recognized reasoning/thinking usage",
                    }),
        },
        validationMetadata: validationMetadataForProbe(input.probe),
        ...validationEligibility(),
        request: {
            bodyHash: stableSha256(input.probe.requestBody),
            promptId: input.probe.promptId,
            syntheticContentOnly: true,
        },
        rawEvidence: {
            rawUsage: input.result.rawUsage,
            hiddenUsagePaths: rawHiddenUsagePaths(input.probe.providerSurface, input.result.rawUsage),
            recognizedHiddenOutputTokens,
            hiddenCategoryNames: [...hiddenCategoryNames],
            billedEmptyFired,
            requestMode: input.probe.kind,
            ...(input.result.responseId ? { responseId: input.result.responseId } : {}),
            ...(input.result.providerErrorBody ? { providerErrorBody: input.result.providerErrorBody } : {}),
        },
        canonical: {
            usage: {
                input: event.usage.input,
                output: event.usage.output,
                categories: event.usage.categories,
            },
            recognizedHiddenOutputTokens,
            hiddenCategoryNames: [...hiddenCategoryNames],
            openAiRecount,
            anthropicCrossCheck,
        },
        detectors: {
            signalCodes: [...new Set(anomalyCodes)],
            billedEmptyFired,
            openAiTokenRecountMismatchFired: openAiRecount.openAiTokenRecountMismatchFired,
            anthropicTokenCrossCheckFired: anthropicCrossCheck.anthropicTokenCrossCheckFired,
            detectorSignals: detectorSignals,
        },
    };
}
export function hiddenTokenProbes(input) {
    const probes = [];
    if (input.providers.includes("openai")) {
        const positiveModel = hiddenTokenModel(input.models.openai, "positive");
        const negativeModel = hiddenTokenModel(input.models.openai, "negative");
        probes.push({
            probeId: "hidden-token-openai-responses-positive-001",
            provider: "openai",
            providerSurface: "openai_responses",
            model: positiveModel,
            promptId: "hidden-token-normal-reasoning-responses-v1",
            kind: "positive",
            requestBody: {
                model: positiveModel,
                reasoning: { effort: "low" },
                input: "Solve a small arithmetic word problem and answer briefly.",
                max_output_tokens: 1024,
            },
        });
        probes.push({
            probeId: "hidden-token-openai-chat-positive-001",
            provider: "openai",
            providerSurface: "chat_completions",
            model: positiveModel,
            promptId: "hidden-token-normal-reasoning-chat-v1",
            kind: "positive",
            requestBody: {
                model: positiveModel,
                reasoning_effort: "low",
                messages: [{ role: "user", content: "Explain why 9 * 9 = 81 in one sentence." }],
                max_completion_tokens: 1024,
            },
        });
        const negativeBody = {
            model: negativeModel,
            messages: [{ role: "user", content: "Say hello in one short sentence." }],
            max_completion_tokens: 128,
        };
        if (supportsOpenAiReasoningNone(negativeModel)) {
            negativeBody.reasoning = { effort: "none" };
        }
        probes.push({
            probeId: "hidden-token-openai-chat-negative-control-001",
            provider: "openai",
            providerSurface: "chat_completions",
            model: negativeModel,
            promptId: "hidden-token-openai-no-reasoning-control-v1",
            kind: "caller_owned_control",
            requestBody: negativeBody,
        });
    }
    if (input.providers.includes("anthropic")) {
        const positiveModel = hiddenTokenModel(input.models.anthropic, "positive");
        const negativeModel = hiddenTokenModel(input.models.anthropic, "negative");
        probes.push({
            probeId: "hidden-token-anthropic-messages-positive-001",
            provider: "anthropic",
            providerSurface: "anthropic_messages",
            model: positiveModel,
            promptId: "hidden-token-anthropic-thinking-v1",
            kind: "positive",
            requestBody: {
                model: positiveModel,
                thinking: { type: "adaptive" },
                output_config: { effort: "low" },
                max_tokens: 2048,
                messages: [{ role: "user", content: "Plan a three-step debugging approach." }],
            },
        });
        probes.push({
            probeId: "hidden-token-anthropic-negative-control-001",
            provider: "anthropic",
            providerSurface: "anthropic_messages",
            model: negativeModel,
            promptId: "hidden-token-anthropic-no-thinking-control-v1",
            kind: "real_provider_negative_control",
            requestBody: {
                model: negativeModel,
                max_tokens: 256,
                messages: [{ role: "user", content: "Say hello in one short sentence." }],
            },
        });
    }
    return probes;
}
function hiddenTokenModel(selection, kind) {
    return typeof selection === "string" ? selection : selection[kind];
}
function supportsOpenAiReasoningNone(model) {
    return /^gpt-5(?:\.|-|$)/.test(model) || /^o\d/.test(model);
}
function elapsedMs(startedMs, endedMs) {
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs))
        return 0;
    return Math.max(0, endedMs - startedMs);
}
function canonicalHiddenTokenEvent(probe, result) {
    const usage = canonicalUsageFromRaw(probe, result.rawUsage);
    const latencyMs = result.monotonicElapsedMs ?? elapsedMs(Date.parse(result.startedAt), Date.parse(result.endedAt));
    return {
        schemaVersion: "v2",
        request: {
            tenantId: "inferock-conformance-validation",
            provider: probe.provider,
            requestId: result.requestId,
            requestedModel: probe.model,
            model: probe.model,
            attemptIndex: 0,
            bodyHash: stableSha256(probe.requestBody),
            bodyHashAlgorithm: "sha256",
            bodyHashCanonicalization: "normalized_json_v1",
            expectCompletion: true,
            generation: probe.requestBody,
        },
        response: {
            statusCode: result.statusCode,
            finishReason: result.finishReason ?? "stop",
            content: result.content,
            servedModel: probe.model,
            ...(result.responseId ? { providerResponseId: result.responseId, rawObjectId: result.responseId } : {}),
        },
        usage,
        timing: {
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            latencyMs,
            ...(result.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: result.monotonicElapsedMs } : {}),
            ...(result.monotonicClockSource ? { monotonicClockSource: result.monotonicClockSource } : {}),
            ...(result.wallClockDrift ? { wallClockDrift: result.wallClockDrift } : {}),
            chunkCount: 0,
            terminalStatus: result.statusCode >= 400 ? "error" : "complete",
        },
        attempts: [{
                attemptNumber: 0,
                provider: probe.provider,
                model: probe.model,
                status: result.statusCode >= 400 ? "error" : "success",
                timing: {
                    startedAt: result.startedAt,
                    endedAt: result.endedAt,
                    latencyMs,
                    ...(result.monotonicElapsedMs !== undefined ? { monotonicElapsedMs: result.monotonicElapsedMs } : {}),
                    ...(result.monotonicClockSource ? { monotonicClockSource: result.monotonicClockSource } : {}),
                    ...(result.wallClockDrift ? { wallClockDrift: result.wallClockDrift } : {}),
                },
                statusCode: result.statusCode,
                finalSelected: true,
            }],
    };
}
function canonicalUsageFromRaw(probe, rawUsage) {
    const inputTokens = numericUsage(rawUsage, ["input_tokens", "prompt_tokens"]) ?? 0;
    const outputTokens = numericUsage(rawUsage, ["output_tokens", "completion_tokens"]) ?? 0;
    const hiddenTokens = rawHiddenTokens(probe.providerSurface, rawUsage);
    const categories = [
        { category: "input", tokens: inputTokens, provider: probe.provider },
        { category: "output", tokens: outputTokens, provider: probe.provider },
    ];
    if (hiddenTokens > 0) {
        if (probe.providerSurface === "openai_responses") {
            categories.push({ category: "reasoning", tokens: hiddenTokens, provider: "openai", sourceField: "output_tokens_details.reasoning_tokens" }, { category: "provider:openai:output_tokens_details.reasoning_tokens", tokens: hiddenTokens, provider: "openai", sourceField: "output_tokens_details.reasoning_tokens" });
        }
        else if (probe.providerSurface === "chat_completions") {
            categories.push({ category: "reasoning", tokens: hiddenTokens, provider: "openai", sourceField: "completion_tokens_details.reasoning_tokens" }, { category: "provider:openai:completion_tokens_details.reasoning_tokens", tokens: hiddenTokens, provider: "openai", sourceField: "completion_tokens_details.reasoning_tokens" });
        }
        else {
            categories.push({ category: "thinking", tokens: hiddenTokens, provider: "anthropic", sourceField: "output_tokens_details.thinking_tokens" }, { category: "provider:anthropic:output_tokens_details.thinking_tokens", tokens: hiddenTokens, provider: "anthropic", sourceField: "output_tokens_details.thinking_tokens" });
        }
    }
    return {
        input: inputTokens,
        output: outputTokens,
        cache: { read: 0, creation: 0 },
        raw: rawUsage,
        categories,
        usageSource: "provider",
    };
}
function openAiRecountDiagnostic(event) {
    if (event.request.provider !== "openai") {
        return {
            openAiTokenRecountMismatchFired: false,
        };
    }
    const recountedVisibleOutputTokens = countOpenAiOutputTokens(event.request.model ?? event.request.requestedModel, event.response.content);
    const knownHiddenOutputTokens = recognizedHiddenTokens(event.usage.categories);
    const billedVisibleOutputTokens = Math.max(0, event.usage.output - knownHiddenOutputTokens);
    const billedVsRecountDeltaTokens = billedVisibleOutputTokens - recountedVisibleOutputTokens;
    const signal = detectOpenAiTokenRecount(event);
    return {
        recountedVisibleOutputTokens,
        knownHiddenOutputTokens,
        billedVisibleOutputTokens,
        billedVsRecountDeltaTokens,
        openAiTokenRecountMismatchFired: signal?.code === "OPENAI_TOKEN_RECOUNT_MISMATCH",
    };
}
function anthropicCrossCheckDiagnostic(event) {
    if (event.request.provider !== "anthropic") {
        return {
            anthropicTokenCrossCheckFired: false,
        };
    }
    const crossCheck = crossCheckAnthropicOutputTokens(event, { fallbackReason: "conformance_hidden_token_validation" });
    const signal = buildAnthropicTokenCrossCheckSignal(event, crossCheck);
    return {
        thinkingTokens: crossCheck.thinkingTokens,
        billedVisibleOutputTokens: billedVisibleAnthropicOutputTokens(event),
        mode: crossCheck.mode,
        withinBound: crossCheck.withinBound,
        anthropicTokenCrossCheckFired: signal?.code === "ANTHROPIC_TOKEN_CROSSCHECK",
    };
}
function validationMetadataForProbe(probe) {
    if (probe.kind === "real_provider_negative_control") {
        return ["billing_observation_pending", "real_provider_negative_control"];
    }
    if (probe.kind === "caller_owned_control") {
        return ["billing_observation_pending", "caller_owned_control"];
    }
    return ["billing_observation_pending"];
}
function hiddenTokenOpenabilityLabel(input) {
    if (input.signal)
        return "signal: hidden-token conformance anomaly found";
    if (!input.positiveProbe) {
        return input.negativeControlKind === "caller_owned_control"
            ? "watched-clean: caller-owned no-hidden-token control stayed clean"
            : "watched-clean: real-provider negative-control surface stayed clean";
    }
    return input.hiddenObserved
        ? "watched-clean: hidden usage category recognized; billed-empty and recount guards passed"
        : "not-openable: hidden-token surface not opened; provider returned no recognized reasoning/thinking usage";
}
function hiddenUsageCategoryNames(categories) {
    return [...new Set(categories
            .filter((category) => isHiddenOutputUsageCategory(category.category))
            .map((category) => category.category))];
}
function recognizedHiddenTokens(categories) {
    const canonical = sumHiddenTokensOnce(categories.filter((category) => category.category === "reasoning" ||
        category.category === "thinking" ||
        category.category === "hidden_output" ||
        category.category === "output_hidden" ||
        category.category === "completion_reasoning" ||
        category.category === "gemini_thinking"));
    if (canonical > 0)
        return canonical;
    return sumHiddenTokensOnce(categories.filter((category) => isHiddenOutputUsageCategory(category.category)));
}
function sumHiddenTokensOnce(categories) {
    const seen = new Set();
    let total = 0;
    for (const category of categories) {
        const key = category.sourceField ?? category.category;
        if (seen.has(key))
            continue;
        seen.add(key);
        total += category.tokens;
    }
    return total;
}
function rawHiddenTokens(surface, rawUsage) {
    if (surface === "openai_responses") {
        return nestedNumber(rawUsage, "output_tokens_details", "reasoning_tokens") ?? 0;
    }
    if (surface === "chat_completions") {
        return nestedNumber(rawUsage, "completion_tokens_details", "reasoning_tokens") ?? 0;
    }
    return nestedNumber(rawUsage, "output_tokens_details", "thinking_tokens") ?? 0;
}
function rawHiddenUsagePaths(surface, rawUsage) {
    const path = surface === "openai_responses"
        ? "output_tokens_details.reasoning_tokens"
        : surface === "chat_completions"
            ? "completion_tokens_details.reasoning_tokens"
            : "output_tokens_details.thinking_tokens";
    return rawHiddenTokens(surface, rawUsage) > 0 ? [path] : [];
}
function numericUsage(rawUsage, fields) {
    for (const field of fields) {
        const value = rawUsage[field];
        if (typeof value === "number")
            return value;
    }
    return undefined;
}
function nestedNumber(rawUsage, parent, field) {
    const child = rawUsage[parent];
    if (!child || typeof child !== "object" || Array.isArray(child))
        return undefined;
    const value = child[field];
    return typeof value === "number" ? value : undefined;
}
//# sourceMappingURL=hidden-token.js.map