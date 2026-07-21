import { randomUUID } from "node:crypto";
import { roundUsd } from "@inferock/measure/pricing";
import { providerApiKey, providerBaseUrl, } from "../config.js";
import { joinUrl, parseJsonRecord, stringValue } from "../record.js";
import { SseAccumulator } from "../sse.js";
import { ANTHROPIC_VERSION } from "../adapters/anthropic.js";
import { captureMonotonicTimestamp } from "../adapters/canonical-v2.js";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import { createConformanceArtifactWriter, } from "./artifacts.js";
import { hiddenTokenLedgerEntry, hiddenTokenProbes, } from "./hidden-token.js";
import { streamSseLedgerEntry, streamSseProbes, streamSseRawFrameRows, } from "./stream-sse.js";
import { hiddenTokenServingModelCandidates, isDisallowedConformanceProbeModel, } from "./model-selection.js";
import { sanitizedProviderErrorBody, } from "./provider-error.js";
import { summarizeConformanceLedger } from "./summary.js";
import { CONFORMANCE_LEDGER_SCHEMA_VERSION, validationEligibility, } from "./types.js";
export async function runAcceptedRealProviderConformance(input) {
    const writer = createConformanceArtifactWriter({
        paths: input.paths,
        createdAt: input.eventTime,
        mode: "real_provider",
        modules: input.modules,
        providers: input.providers,
    });
    await writer.writeManifest();
    const planned = plannedProbes({
        modules: input.modules,
        providers: input.providers,
        estimate: input.estimate,
    });
    if (planned.length === 0) {
        throw new Error("Accepted conformance run has no planned probes.");
    }
    const providerFetch = input.providerFetch ?? fetch;
    const entries = [];
    let spentUsd = 0;
    for (const plannedProbe of planned) {
        const spendBefore = spentUsd;
        const spendAfter = roundUsd(spendBefore + plannedProbe.estimatedProbeUsd);
        if (spendAfter > input.estimate.spendCapUsd) {
            const entry = notRunSpendCapEntry({
                runId: writer.runId,
                plannedProbe,
                accounting: {
                    estimatedProbeUsd: plannedProbe.estimatedProbeUsd,
                    spentBeforeUsd: spendBefore,
                    spentAfterUsd: spendBefore,
                    spendCapUsd: input.estimate.spendCapUsd,
                },
            });
            await writer.appendLedger(entry);
            entries.push(entry);
            continue;
        }
        spentUsd = spendAfter;
        if (plannedProbe.module === "stream_sse") {
            const result = await callStreamSseProvider({
                probe: plannedProbe.probe,
                config: input.config,
                env: input.env,
                providerFetch,
            });
            await writer.writeRawNdjson(plannedProbe.probe.probeId, streamSseRawFrameRows(result.frames));
            if (result.usage)
                await writer.writeRawJson(plannedProbe.probe.probeId, "usage", result.usage);
            if (result.providerErrorBody) {
                await writer.writeRawJson(plannedProbe.probe.probeId, "provider-error", result.providerErrorBody);
            }
            const entry = withProbeAccounting(streamSseLedgerEntry({
                runId: writer.runId,
                probe: plannedProbe.probe,
                result,
            }), {
                estimatedProbeUsd: plannedProbe.estimatedProbeUsd,
                spentBeforeUsd: spendBefore,
                spentAfterUsd: spendAfter,
                spendCapUsd: input.estimate.spendCapUsd,
            });
            await writer.appendLedger(entry);
            entries.push(entry);
        }
        else {
            const modelResolution = await resolveHiddenProbeModel({
                plannedProbe,
                config: input.config,
                env: input.env,
                providerFetch,
            });
            if (!modelResolution.ok) {
                spentUsd = spendBefore;
                const entry = withProbeAccounting(noServableProbeModelEntry({
                    runId: writer.runId,
                    plannedProbe,
                    rawEvidence: modelResolution.rawEvidence,
                }), {
                    estimatedProbeUsd: plannedProbe.estimatedProbeUsd,
                    spentBeforeUsd: spendBefore,
                    spentAfterUsd: spendBefore,
                    spendCapUsd: input.estimate.spendCapUsd,
                });
                await writer.appendLedger(entry);
                entries.push(entry);
                continue;
            }
            const result = await callHiddenTokenProvider({
                probe: modelResolution.probe,
                config: input.config,
                env: input.env,
                providerFetch,
            });
            await writer.writeRawJson(modelResolution.probe.probeId, "usage", result.rawUsage);
            if (result.providerErrorBody) {
                await writer.writeRawJson(modelResolution.probe.probeId, "provider-error", result.providerErrorBody);
            }
            const entry = withProbeAccounting(withHiddenModelResolutionEvidence(hiddenTokenLedgerEntry({
                runId: writer.runId,
                probe: modelResolution.probe,
                result,
            }), modelResolution), {
                estimatedProbeUsd: plannedProbe.estimatedProbeUsd,
                spentBeforeUsd: spendBefore,
                spentAfterUsd: spendAfter,
                spendCapUsd: input.estimate.spendCapUsd,
            });
            await writer.appendLedger(entry);
            entries.push(entry);
        }
    }
    if (entries.length === 0) {
        throw new Error("Accepted conformance run produced no probe ledger entries.");
    }
    const summary = summarizeConformanceLedger({
        runId: writer.runId,
        entries,
        generatedAt: new Date().toISOString(),
    });
    await writer.writeSummary(summary);
    return {
        runId: writer.runId,
        artifactDir: writer.runDir,
        estimateHash: input.estimate.estimateHash,
        selectedProviders: input.providers,
        summary,
    };
}
function plannedProbes(input) {
    const planned = [];
    const stream = input.modules.includes("stream_sse")
        ? streamSseProbes({
            providers: input.providers,
            models: {
                openai: selectedModelForProvider(input, "openai", "stream"),
                anthropic: selectedModelForProvider(input, "anthropic", "stream"),
            },
        })
        : [];
    const hidden = input.modules.includes("hidden_token")
        ? hiddenTokenProbes({
            providers: input.providers,
            models: {
                openai: {
                    positive: selectedModelForProvider(input, "openai", "hidden_token_positive"),
                    negative: selectedModelForProvider(input, "openai", "hidden_token_negative"),
                },
                anthropic: {
                    positive: selectedModelForProvider(input, "anthropic", "hidden_token_positive"),
                    negative: selectedModelForProvider(input, "anthropic", "hidden_token_negative"),
                },
            },
        })
        : [];
    const streamProbeUsd = perProbeBudget(input.estimate.moduleBudgetsUsd.stream_sse, stream.length);
    const hiddenProbeUsd = perProbeBudget(input.estimate.moduleBudgetsUsd.hidden_token, hidden.length);
    planned.push(...stream.map((probe) => ({
        module: "stream_sse",
        probe,
        estimatedProbeUsd: streamProbeUsd,
    })));
    planned.push(...hidden.map((probe) => ({
        module: "hidden_token",
        probe,
        estimatedProbeUsd: hiddenProbeUsd,
        modelCandidates: hiddenModelCandidatesForProbe(probe),
    })));
    return planned;
}
function selectedModelForProvider(input, provider, purpose) {
    return input.providers.includes(provider)
        ? selectedModel(input.estimate, provider, purpose)
        : "not-selected";
}
function selectedModel(estimate, provider, purpose) {
    const selected = estimate.selectedModels.find((model) => model.provider === provider && model.purpose === purpose);
    if (!selected) {
        throw new Error(`Conformance estimate did not select a ${provider} ${purpose} model.`);
    }
    return selected.model;
}
function perProbeBudget(moduleBudgetUsd, probeCount) {
    if (probeCount <= 0)
        return 0;
    return roundUsd(moduleBudgetUsd / probeCount);
}
function conformanceMonotonicTiming(startedAt, endedAt) {
    const monotonicElapsedMs = monotonicElapsedMsBetween(startedAt, endedAt);
    const wallClockElapsedMs = endedAt.wallTime.getTime() - startedAt.wallTime.getTime();
    const driftMs = wallClockElapsedMs - monotonicElapsedMs;
    const driftKind = wallClockElapsedMs < 0
        ? "negative_wall_clock_elapsed"
        : Math.abs(driftMs) > 1_000
            ? "implausible_wall_clock_drift"
            : undefined;
    return {
        monotonicElapsedMs,
        monotonicClockSource: endedAt.monotonicClockSource,
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
function monotonicElapsedMsBetween(startedAt, endedAt) {
    return Math.max(0, Number(endedAt.monotonicNs - startedAt.monotonicNs) / 1_000_000);
}
async function callStreamSseProvider(input) {
    const requestId = randomUUID();
    const startedAt = captureMonotonicTimestamp();
    let response;
    try {
        response = await input.providerFetch(...providerRequest(input.probe, input.config, input.env));
    }
    catch {
        const endedAt = captureMonotonicTimestamp();
        return {
            requestId,
            startedAt: startedAt.wallTime.toISOString(),
            endedAt: endedAt.wallTime.toISOString(),
            ...conformanceMonotonicTiming(startedAt, endedAt),
            statusCode: 502,
            headers: {},
            frames: [],
            errorClass: "provider_transport_error",
        };
    }
    if (response.status >= 400) {
        const errorBody = sanitizedProviderErrorBody(await response.text());
        const endedAt = captureMonotonicTimestamp();
        return {
            requestId,
            startedAt: startedAt.wallTime.toISOString(),
            endedAt: endedAt.wallTime.toISOString(),
            ...conformanceMonotonicTiming(startedAt, endedAt),
            statusCode: response.status,
            headers: headersRecord(response.headers),
            frames: [],
            providerErrorBody: errorBody,
            errorClass: `http_${response.status}:provider_error`,
        };
    }
    const streamRead = await readSseFrames(response, startedAt);
    const frames = streamRead.frames;
    const endedAt = captureMonotonicTimestamp();
    return {
        requestId,
        startedAt: startedAt.wallTime.toISOString(),
        endedAt: endedAt.wallTime.toISOString(),
        ...conformanceMonotonicTiming(startedAt, endedAt),
        ...(streamRead.firstByteAt ? { firstByteAt: streamRead.firstByteAt } : {}),
        ...(streamRead.timeToFirstByteMs !== undefined ? { timeToFirstByteMs: streamRead.timeToFirstByteMs } : {}),
        statusCode: response.status,
        headers: headersRecord(response.headers),
        frames,
        ...(usageFromStreamFrames(input.probe.providerSurface, frames) ? {
            usage: usageFromStreamFrames(input.probe.providerSurface, frames),
        } : {}),
        ...(responseIdFromStreamFrames(frames) ? { responseId: responseIdFromStreamFrames(frames) } : {}),
    };
}
async function callHiddenTokenProvider(input) {
    const requestId = randomUUID();
    const startedAt = captureMonotonicTimestamp();
    let response;
    try {
        response = await input.providerFetch(...providerRequest(input.probe, input.config, input.env));
    }
    catch {
        const endedAt = captureMonotonicTimestamp();
        return {
            requestId,
            startedAt: startedAt.wallTime.toISOString(),
            endedAt: endedAt.wallTime.toISOString(),
            ...conformanceMonotonicTiming(startedAt, endedAt),
            statusCode: 502,
            rawUsage: {},
            content: "",
            finishReason: "provider_transport_error",
        };
    }
    const text = await response.text();
    const providerErrorBody = response.status >= 400
        ? sanitizedProviderErrorBody(text)
        : undefined;
    const parsed = parseJsonRecord(text) ?? {};
    const endedAt = captureMonotonicTimestamp();
    return {
        requestId,
        startedAt: startedAt.wallTime.toISOString(),
        endedAt: endedAt.wallTime.toISOString(),
        ...conformanceMonotonicTiming(startedAt, endedAt),
        statusCode: response.status,
        rawUsage: usageFromJson(input.probe.providerSurface, parsed),
        content: contentFromJson(input.probe.providerSurface, parsed),
        ...(finishReasonFromJson(input.probe.providerSurface, parsed) ? {
            finishReason: finishReasonFromJson(input.probe.providerSurface, parsed),
        } : {}),
        ...(responseIdFromJson(parsed) ? { responseId: responseIdFromJson(parsed) } : {}),
        ...(providerErrorBody ? { providerErrorBody } : {}),
    };
}
function providerRequest(probe, config, env) {
    const apiKey = providerApiKey(probe.provider, config, env);
    if (!apiKey)
        throw new Error(`Missing ${probe.provider} validation provider key for conformance probe ${probe.probeId}.`);
    const baseUrl = providerBaseUrl(probe.provider, config, env);
    if (probe.provider === "openai" && probe.providerSurface === "openai_responses") {
        return [
            joinUrl(baseUrl, "/responses"),
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(openAiResponsesBody(probe.requestBody)),
            },
        ];
    }
    if (probe.provider === "openai") {
        return [
            joinUrl(baseUrl, "/chat/completions"),
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(openAiChatBody(probe.requestBody)),
            },
        ];
    }
    return [
        joinUrl(baseUrl, "/messages"),
        {
            method: "POST",
            headers: {
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify(anthropicMessagesBody(probe.requestBody)),
        },
    ];
}
async function readSseFrames(response, startedAt) {
    if (!response.body) {
        const observedAt = captureMonotonicTimestamp();
        return {
            frames: parseSseText(await response.text(), observedAt.wallTime.toISOString(), monotonicElapsedMsBetween(startedAt, observedAt)),
            firstByteAt: observedAt.wallTime.toISOString(),
            timeToFirstByteMs: monotonicElapsedMsBetween(startedAt, observedAt),
        };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const accumulator = new SseAccumulator();
    const frames = [];
    let firstByteAt;
    while (true) {
        const chunk = await reader.read();
        if (chunk.done)
            break;
        const observedAt = captureMonotonicTimestamp();
        if (!firstByteAt && chunk.value.byteLength > 0)
            firstByteAt = observedAt;
        const observedElapsedMs = monotonicElapsedMsBetween(startedAt, observedAt);
        for (const message of accumulator.push(decoder.decode(chunk.value, { stream: true }))) {
            frames.push({
                observedAt: observedAt.wallTime.toISOString(),
                observedMonotonicElapsedMs: observedElapsedMs,
                ...(message.event ? { event: message.event } : {}),
                data: message.data,
            });
        }
    }
    const observedAt = captureMonotonicTimestamp();
    const observedElapsedMs = monotonicElapsedMsBetween(startedAt, observedAt);
    for (const message of [...accumulator.push(decoder.decode()), ...accumulator.end()]) {
        frames.push({
            observedAt: observedAt.wallTime.toISOString(),
            observedMonotonicElapsedMs: observedElapsedMs,
            ...(message.event ? { event: message.event } : {}),
            data: message.data,
        });
    }
    return {
        frames,
        ...(firstByteAt ? { firstByteAt: firstByteAt.wallTime.toISOString() } : {}),
        ...(firstByteAt ? { timeToFirstByteMs: monotonicElapsedMsBetween(startedAt, firstByteAt) } : {}),
    };
}
function parseSseText(raw, observedAt, observedMonotonicElapsedMs) {
    const accumulator = new SseAccumulator();
    return [...accumulator.push(raw), ...accumulator.end()].map((message) => ({
        observedAt,
        observedMonotonicElapsedMs,
        ...(message.event ? { event: message.event } : {}),
        data: message.data,
    }));
}
function usageFromStreamFrames(surface, frames) {
    let usage;
    for (const frame of frames) {
        const parsed = parseFrameRecord(frame);
        if (!parsed)
            continue;
        const candidate = surface === "openai_responses"
            ? recordField(recordField(parsed, "response"), "usage") ?? recordField(parsed, "usage")
            : surface === "anthropic_messages"
                ? recordField(recordField(parsed, "message"), "usage") ?? recordField(parsed, "usage")
                : recordField(parsed, "usage");
        if (candidate)
            usage = { ...(usage ?? {}), ...candidate };
    }
    return usage;
}
function responseIdFromStreamFrames(frames) {
    for (const frame of frames) {
        const parsed = parseFrameRecord(frame);
        const id = stringValue(parsed?.id) ?? stringValue(recordField(parsed, "message")?.id) ??
            stringValue(recordField(parsed, "response")?.id);
        if (id)
            return id;
    }
    return undefined;
}
function usageFromJson(_surface, parsed) {
    return recordField(parsed, "usage") ?? {};
}
function contentFromJson(surface, parsed) {
    if (surface === "openai_responses") {
        const outputText = stringValue(parsed.output_text);
        if (outputText)
            return outputText;
        return outputTextFromResponsesOutput(parsed.output);
    }
    if (surface === "chat_completions") {
        const choice = firstRecord(parsed.choices);
        const message = recordField(choice, "message");
        const content = message?.content;
        return typeof content === "string" ? content : "";
    }
    return textFromAnthropicContent(parsed.content);
}
function finishReasonFromJson(surface, parsed) {
    if (surface === "openai_responses")
        return stringValue(parsed.status);
    if (surface === "chat_completions")
        return stringValue(firstRecord(parsed.choices)?.finish_reason);
    return stringValue(parsed.stop_reason);
}
function responseIdFromJson(parsed) {
    return stringValue(parsed.id);
}
function withProbeAccounting(entry, accounting) {
    const explicit = explicitConformanceStatus(entry);
    return {
        ...entry,
        validationMetadata: [...new Set([...entry.validationMetadata, "spend_accounted_preflight_estimate"])],
        rawEvidence: {
            ...entry.rawEvidence,
            conformanceStatus: explicit.status,
            ...(explicit.reason ? { conformanceReason: explicit.reason } : {}),
            spend: spendEvidence(accounting),
        },
    };
}
function notRunSpendCapEntry(input) {
    const probe = input.plannedProbe.probe;
    const now = new Date().toISOString();
    const reason = "spend cap would be exceeded before probe";
    return {
        schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
        runId: input.runId,
        probeId: probe.probeId,
        module: input.plannedProbe.module,
        mode: "real_provider",
        provider: probe.provider,
        providerSurface: providerSurfaceForProbe(input.plannedProbe),
        model: probe.model,
        startedAt: now,
        endedAt: now,
        status: "not_run_spend_cap",
        openability: {
            surfaceOpened: false,
            status: "not_openable",
            reason,
            label: `not-openable: ${reason}`,
            watchedEvidence: {
                conformanceStatus: "not_run_spend_cap",
                spend: spendEvidence(input.accounting),
            },
        },
        validationMetadata: ["billing_observation_pending", "spend_accounted_preflight_estimate"],
        ...validationEligibility(),
        request: {
            bodyHash: stableSha256(probe.requestBody),
            promptId: probe.promptId,
            syntheticContentOnly: true,
        },
        rawEvidence: {
            conformanceStatus: "not_run_spend_cap",
            conformanceReason: reason,
            spend: spendEvidence(input.accounting),
        },
        canonical: {},
        detectors: {},
    };
}
function noServableProbeModelEntry(input) {
    const probe = input.plannedProbe.probe;
    const now = new Date().toISOString();
    const reason = "no_servable_probe_model";
    return {
        schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
        runId: input.runId,
        probeId: probe.probeId,
        module: "hidden_token",
        mode: "real_provider",
        provider: probe.provider,
        providerSurface: providerSurfaceForProbe(input.plannedProbe),
        model: probe.model,
        startedAt: now,
        endedAt: now,
        status: "inconclusive",
        openability: {
            surfaceOpened: false,
            status: "not_openable",
            reason,
            label: `not-openable: ${reason}`,
            watchedEvidence: {
                selectedModel: probe.model,
                modelCandidates: [...input.plannedProbe.modelCandidates],
                conformanceStatus: "inconclusive",
                conformanceReason: reason,
            },
        },
        validationMetadata: ["billing_observation_pending", "probe_model_preflight_failed"],
        ...validationEligibility(),
        request: {
            bodyHash: stableSha256(probe.requestBody),
            promptId: probe.promptId,
            syntheticContentOnly: true,
        },
        rawEvidence: {
            conformanceStatus: "inconclusive",
            conformanceReason: reason,
            ...input.rawEvidence,
        },
        canonical: {},
        detectors: {},
    };
}
async function resolveHiddenProbeModel(input) {
    const originalModel = input.plannedProbe.probe.model;
    const attempts = [];
    const candidates = uniqueStrings([
        originalModel,
        ...input.plannedProbe.modelCandidates,
    ]);
    for (const candidate of candidates) {
        if (isDisallowedConformanceProbeModel(input.plannedProbe.probe.provider, candidate)) {
            attempts.push({
                model: candidate,
                status: "rejected",
                reason: "disallowed_conformance_probe_model",
            });
            continue;
        }
        const availability = await preflightModelAvailability({
            provider: input.plannedProbe.probe.provider,
            model: candidate,
            config: input.config,
            env: input.env,
            providerFetch: input.providerFetch,
        });
        attempts.push({
            model: candidate,
            ...availability.rawEvidence,
        });
        if (availability.available) {
            const substituted = candidate !== originalModel;
            const evidence = {
                modelSelection: {
                    originalModel,
                    selectedModel: candidate,
                    substituted,
                    preflight: "provider_models_list",
                    attempts,
                },
            };
            return {
                ok: true,
                probe: hiddenProbeWithModel(input.plannedProbe.probe, candidate),
                metadata: substituted ? ["probe_model_substituted"] : [],
                rawEvidence: evidence,
            };
        }
    }
    return {
        ok: false,
        reason: "no_servable_probe_model",
        rawEvidence: {
            modelSelection: {
                originalModel,
                selectedModel: null,
                substituted: false,
                preflight: "provider_models_list",
                attempts,
            },
        },
    };
}
function withHiddenModelResolutionEvidence(entry, resolution) {
    return {
        ...entry,
        validationMetadata: [...new Set([...entry.validationMetadata, ...resolution.metadata])],
        openability: {
            ...entry.openability,
            watchedEvidence: {
                ...(entry.openability.watchedEvidence ?? {}),
                modelSelection: resolution.rawEvidence.modelSelection,
            },
        },
        rawEvidence: {
            ...entry.rawEvidence,
            ...resolution.rawEvidence,
        },
    };
}
async function preflightModelAvailability(input) {
    let response;
    try {
        response = await input.providerFetch(...providerModelsListRequest(input.provider, input.config, input.env));
    }
    catch {
        return {
            available: false,
            rawEvidence: {
                status: "model_list_transport_error",
            },
        };
    }
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
        return {
            available: false,
            rawEvidence: {
                status: "model_list_http_error",
                statusCode: response.status,
                providerErrorBody: sanitizedProviderErrorBody(text),
            },
        };
    }
    const parsed = parseJsonRecord(text) ?? {};
    const modelIds = modelIdsFromListResponse(parsed);
    const available = modelIds.some((modelId) => listedModelMatchesCandidate(input.provider, modelId, input.model));
    return {
        available,
        rawEvidence: {
            status: available ? "model_list_available" : "model_list_missing",
            listedModelCount: modelIds.length,
        },
    };
}
function providerModelsListRequest(provider, config, env) {
    const apiKey = providerApiKey(provider, config, env);
    if (!apiKey)
        throw new Error(`Missing ${provider} validation provider key for conformance model preflight.`);
    const baseUrl = providerBaseUrl(provider, config, env);
    if (provider === "openai") {
        return [
            joinUrl(baseUrl, "/models"),
            {
                method: "GET",
                headers: {
                    authorization: `Bearer ${apiKey}`,
                },
            },
        ];
    }
    return [
        joinUrl(baseUrl, "/models"),
        {
            method: "GET",
            headers: {
                "anthropic-version": ANTHROPIC_VERSION,
                "x-api-key": apiKey,
            },
        },
    ];
}
function modelIdsFromListResponse(parsed) {
    const data = Array.isArray(parsed.data) ? parsed.data : [];
    return data.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            return [];
        const record = entry;
        const id = stringValue(record.id) ?? stringValue(record.model);
        return id ? [id] : [];
    });
}
function listedModelMatchesCandidate(provider, listedModel, candidate) {
    return listedModel === candidate ||
        (provider === "anthropic" && listedModel.startsWith(`${candidate}-`));
}
function hiddenModelCandidatesForProbe(probe) {
    return hiddenTokenServingModelCandidates(probe.provider, hiddenProbePurpose(probe));
}
function hiddenProbePurpose(probe) {
    return probe.kind === "positive" ? "hidden_token_positive" : "hidden_token_negative";
}
function hiddenProbeWithModel(probe, model) {
    return {
        ...probe,
        model,
        requestBody: {
            ...probe.requestBody,
            model,
        },
    };
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
function explicitConformanceStatus(entry) {
    if (entry.status === "not_run_spend_cap")
        return { status: "not_run_spend_cap" };
    if (entry.status === "signal" || entry.openability.status === "signal")
        return { status: "anomaly" };
    if (entry.status === "passed" && entry.openability.status === "watched_clean")
        return { status: "conformant" };
    return {
        status: "inconclusive",
        reason: entry.openability.reason ?? entry.openability.label ?? entry.status,
    };
}
function spendEvidence(accounting) {
    return {
        pricingBasis: "preflight_estimate",
        estimatedProbeUsd: roundUsd(accounting.estimatedProbeUsd),
        spentBeforeUsd: roundUsd(accounting.spentBeforeUsd),
        spentAfterUsd: roundUsd(accounting.spentAfterUsd),
        spendCapUsd: roundUsd(accounting.spendCapUsd),
    };
}
function providerSurfaceForProbe(plannedProbe) {
    if (plannedProbe.module === "stream_sse")
        return plannedProbe.probe.providerSurface;
    return plannedProbe.probe.kind === "positive"
        ? plannedProbe.probe.providerSurface
        : "hidden_token_negative_control";
}
function openAiResponsesBody(body) {
    const output = mutableBody(body);
    if (!Object.prototype.hasOwnProperty.call(output, "max_output_tokens") &&
        Object.prototype.hasOwnProperty.call(output, "max_tokens")) {
        output.max_output_tokens = output.max_tokens;
    }
    delete output.max_tokens;
    if (isOpenAiReasoningModel(stringValue(output.model)))
        delete output.temperature;
    if (output.store !== true)
        delete output.metadata;
    return output;
}
function openAiChatBody(body) {
    const output = mutableBody(body);
    if (output.stream === true) {
        output.stream_options = {
            ...(isPlainRecord(output.stream_options) ? output.stream_options : {}),
            include_usage: true,
        };
    }
    if (isOpenAiReasoningModel(stringValue(output.model))) {
        if (!Object.prototype.hasOwnProperty.call(output, "max_completion_tokens") &&
            Object.prototype.hasOwnProperty.call(output, "max_tokens")) {
            output.max_completion_tokens = output.max_tokens;
        }
        delete output.max_tokens;
        delete output.temperature;
    }
    if (output.store !== true)
        delete output.metadata;
    return output;
}
function anthropicMessagesBody(body) {
    const output = mutableBody(body);
    delete output.response_format;
    delete output.metadata;
    if (isAnthropicTemperatureUnsupportedModel(stringValue(output.model)))
        delete output.temperature;
    return output;
}
function isOpenAiReasoningModel(model) {
    return model?.startsWith("gpt-5") === true || model?.startsWith("o") === true;
}
function isAnthropicTemperatureUnsupportedModel(model) {
    if (!model)
        return false;
    return /^claude-[a-z]+-5(?:-|$)/.test(model) ||
        /^claude-[a-z]+-4-(?:[7-9]|\d{2,})(?:-|$)/.test(model);
}
function mutableBody(body) {
    return { ...body };
}
function parseFrameRecord(frame) {
    if (frame.data === "[DONE]")
        return undefined;
    return parseJsonRecord(frame.data);
}
function recordField(value, key) {
    if (!isPlainRecord(value))
        return undefined;
    const field = value[key];
    return isPlainRecord(field) ? field : undefined;
}
function firstRecord(value) {
    return Array.isArray(value) && isPlainRecord(value[0]) ? value[0] : undefined;
}
function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function outputTextFromResponsesOutput(value) {
    if (!Array.isArray(value))
        return "";
    return value.flatMap((item) => {
        if (!isPlainRecord(item))
            return [];
        const content = item.content;
        if (!Array.isArray(content))
            return [];
        return content.flatMap((part) => {
            if (!isPlainRecord(part))
                return [];
            const text = stringValue(part.text);
            return text ? [text] : [];
        });
    }).join("");
}
function textFromAnthropicContent(value) {
    if (!Array.isArray(value))
        return "";
    return value.flatMap((part) => {
        if (!isPlainRecord(part) || part.type !== "text")
            return [];
        const text = stringValue(part.text);
        return text ? [text] : [];
    }).join("");
}
function headersRecord(headers) {
    const output = {};
    headers.forEach((value, key) => {
        output[key] = value;
    });
    return output;
}
//# sourceMappingURL=real-provider.js.map