import { randomUUID } from "node:crypto";
import { GEMINI_DEVELOPER_API_PLANE, lookupPrice, lookupPriceForEvent, roundUsd, } from "@inferock/measure/pricing";
import { normalizeCanonicalEvent } from "@inferock/measure/canonical-event";
import { wholeCallStandardFloorKey, wholeCallStandardFloorsForBenchEvents, } from "../summary.js";
import { dollarizeDriftCanaryRegression, } from "./dollarization.js";
import { gradeDriftCanaryResponse } from "./grader.js";
import { DRIFT_CANARY_ESTIMATED_USAGE, DRIFT_CANARY_WORKLOAD_CLASS, driftCanaryEffectiveProtocol, driftCanaryItemIdFromSuiteTaskId, driftCanarySuiteTaskId, } from "./manifest.js";
import { flagDriftByAccuracyDrop } from "./stats.js";
import { openRouterPlaneForModel } from "../openrouter-pins.js";
export const DRIFT_CANARY_PROGRESS_TASK_ID = "drift_canary";
export async function runDriftCanary(input) {
    const plannedCalls = buildPlannedDriftCanaryCalls({
        manifest: input.manifest,
        selectedModels: input.selectedModels,
        eventTime: input.eventTime,
    });
    let callsLaunched = 0;
    for (const call of plannedCalls) {
        if (input.abortSignal?.aborted) {
            return {
                status: callsLaunched === 0 ? "killed" : "killed",
                statusReason: "aborted_by_user",
                runId: input.runId,
                manifestHash: input.manifest.manifestHash,
                callsLaunched,
                plannedCallCount: plannedCalls.length,
                models: await evaluateDriftCanaryModels(input),
            };
        }
        const budget = await input.budget?.preLaunch?.([call]);
        if (budget && budget.status !== "completed") {
            return {
                ...budget,
                runId: input.runId,
                manifestHash: input.manifest.manifestHash,
                callsLaunched,
                plannedCallCount: plannedCalls.length,
                models: await evaluateDriftCanaryModels(input),
            };
        }
        callsLaunched += 1;
        await executeDriftCanaryCall({
            app: input.app,
            registry: input.registry,
            runId: input.runId,
            benchKey: input.benchKey,
            manifest: input.manifest,
            call,
        });
        const postCall = await input.budget?.postCall?.();
        if (postCall && postCall.status !== "completed") {
            return {
                ...postCall,
                runId: input.runId,
                manifestHash: input.manifest.manifestHash,
                callsLaunched,
                plannedCallCount: plannedCalls.length,
                models: await evaluateDriftCanaryModels(input),
            };
        }
    }
    return {
        status: "completed",
        runId: input.runId,
        manifestHash: input.manifest.manifestHash,
        callsLaunched,
        plannedCallCount: plannedCalls.length,
        models: await evaluateDriftCanaryModels(input),
    };
}
export function buildPlannedDriftCanaryCalls(input) {
    return input.selectedModels.filter(isDriftCanarySelectedModel).flatMap((selectedModel) => {
        const price = lookupPrice({
            provider: selectedModel.provider,
            model: selectedModel.model,
            eventTime: input.eventTime,
            ...(providerPlane(selectedModel.provider, selectedModel.model)
                ? { plane: providerPlane(selectedModel.provider, selectedModel.model) }
                : {}),
            usage: DRIFT_CANARY_ESTIMATED_USAGE,
        });
        if (!price.ok || price.pricingStatus === "partial") {
            throw new Error(`Drift canary cannot bound spend for ${selectedModel.provider}:${selectedModel.model}.`);
        }
        return input.manifest.items.map((item) => ({
            selectedModel,
            item,
            estimatedCostUsd: price.expectedChargeUsd,
        }));
    });
}
async function executeDriftCanaryCall(input) {
    const requestId = randomUUID();
    const suiteTaskId = driftCanarySuiteTaskId(input.call.item.itemId);
    const effectiveProtocol = driftCanaryEffectiveProtocol(input.manifest, input.call.selectedModel);
    input.registry.register(requestId, {
        runId: input.runId,
        suiteTaskId,
        workloadClass: DRIFT_CANARY_WORKLOAD_CLASS,
        driftCanaryProtocolVersion: effectiveProtocol.protocolVersion,
    });
    const response = await input.app.request(routePath(input.call.selectedModel.provider, input.call.selectedModel.model), {
        method: "POST",
        headers: {
            authorization: `Bearer ${input.benchKey}`,
            "content-type": "application/json",
            "x-inferock-request-id": requestId,
        },
        body: JSON.stringify(requestBodyForCanaryCall(input.manifest, input.call, effectiveProtocol)),
    });
    await response.arrayBuffer();
    if (response.status >= 400) {
        throw new Error(`drift canary item ${input.call.item.itemId} failed through local proxy with HTTP ${response.status}`);
    }
}
async function evaluateDriftCanaryModels(input) {
    const records = await input.store.readAll();
    return input.selectedModels.filter(isDriftCanarySelectedModel).map((selected) => evaluateDriftCanaryModel({
        runId: input.runId,
        manifest: input.manifest,
        selectedModel: selected,
        records,
        summaryOptions: input.summaryOptions,
    }));
}
function evaluateDriftCanaryModel(input) {
    const effectiveProtocol = driftCanaryEffectiveProtocol(input.manifest, input.selectedModel);
    const itemById = new Map(input.manifest.items.map((item) => [item.itemId, item]));
    const evaluated = input.records.flatMap((record) => evaluatedCanaryRecord(record, itemById, input.selectedModel, effectiveProtocol.protocolVersion) ?? []);
    const completeRuns = completeCanaryRuns(input.manifest, evaluated, effectiveProtocol.protocolVersion);
    const currentRun = completeRuns.find((run) => run.runId === input.runId);
    if (!currentRun) {
        return {
            provider: input.selectedModel.provider,
            model: input.selectedModel.model,
            status: "incomplete",
            manifestHash: input.manifest.manifestHash,
            protocolVersion: effectiveProtocol.protocolVersion,
            effectiveProtocol,
            itemResults: evaluated
                .filter((record) => record.runId === input.runId)
                .map((record) => record.itemResult),
        };
    }
    const currentIndex = completeRuns.findIndex((run) => run.runId === input.runId);
    const baselineRuns = completeRuns.slice(0, input.manifest.baselineRunCount);
    if (currentIndex < input.manifest.baselineRunCount || baselineRuns.length < input.manifest.baselineRunCount) {
        const priorBaselineRuns = completeRuns.slice(0, Math.min(currentIndex, input.manifest.baselineRunCount));
        return {
            provider: input.selectedModel.provider,
            model: input.selectedModel.model,
            status: "baseline_collecting",
            manifestHash: input.manifest.manifestHash,
            protocolVersion: effectiveProtocol.protocolVersion,
            effectiveProtocol,
            currentRun: publicRun(currentRun),
            baselineCollection: {
                completedPriorRuns: priorBaselineRuns.length,
                requiredRuns: input.manifest.baselineRunCount,
            },
            itemResults: currentRun.itemResults,
        };
    }
    const baseline = aggregateBaseline(baselineRuns);
    if (!baseline) {
        throw new Error("Drift canary baseline aggregation failed despite enough complete runs.");
    }
    const stats = flagDriftByAccuracyDrop({
        baselinePassed: baseline.passed,
        baselineTotal: baseline.total,
        currentPassed: currentRun.passed,
        currentTotal: currentRun.total,
        alpha: input.manifest.alpha,
    });
    const status = stats.flagged ? "drift_flagged" : "watched_clean";
    const result = {
        provider: input.selectedModel.provider,
        model: input.selectedModel.model,
        status,
        manifestHash: input.manifest.manifestHash,
        protocolVersion: effectiveProtocol.protocolVersion,
        effectiveProtocol,
        currentRun: publicRun(currentRun),
        baseline,
        stats,
        itemResults: currentRun.itemResults,
    };
    if (!stats.flagged)
        return result;
    const lastGood = lastGoodRun({
        completeRuns,
        currentIndex,
        baseline,
        baselineRunCount: input.manifest.baselineRunCount,
        alpha: input.manifest.alpha,
    });
    const affectedCalls = driftCanaryAffectedCallsInWindow(input.records, {
        provider: input.selectedModel.provider,
        model: input.selectedModel.model,
        since: lastGood.endedAt,
        until: currentRun.endedAt,
        floorSummaryWindow: { runId: input.runId },
        summaryOptions: input.summaryOptions,
    });
    return {
        ...result,
        dollarization: dollarizeDriftCanaryRegression({
            provider: input.selectedModel.provider,
            model: input.selectedModel.model,
            baseline,
            current: publicRun(currentRun),
            alpha: input.manifest.alpha,
            pValue: stats.pValue,
            lastGoodRunId: lastGood.runId,
            firstFlaggedRunId: currentRun.runId,
            window: {
                since: lastGood.endedAt,
                until: currentRun.endedAt,
            },
            affectedCalls,
        }),
    };
}
function evaluatedCanaryRecord(record, itemById, selectedModel, protocolVersion) {
    if (!record.runId)
        return null;
    if (record.driftCanaryProtocolVersion !== protocolVersion)
        return null;
    const itemId = driftCanaryItemIdFromSuiteTaskId(record.suiteTaskId);
    if (!itemId)
        return null;
    const item = itemById.get(itemId);
    if (!item)
        return null;
    const event = normalizeCanonicalEvent(record.event);
    if (event.request.provider !== selectedModel.provider || event.request.model !== selectedModel.model)
        return null;
    if (event.response.statusCode >= 400)
        return null;
    const grade = gradeDriftCanaryResponse({
        dataset: item.dataset,
        expectedAnswer: item.expectedAnswer,
        responseText: event.response.content,
    });
    return {
        runId: record.runId,
        item,
        event,
        grade,
        itemResult: itemResultForRecord(item, event, grade),
    };
}
function completeCanaryRuns(manifest, records, protocolVersion) {
    const byRunId = new Map();
    for (const record of records) {
        byRunId.set(record.runId, [...(byRunId.get(record.runId) ?? []), record]);
    }
    const runs = [];
    for (const [runId, runRecords] of byRunId.entries()) {
        const latestByItem = new Map();
        for (const record of runRecords) {
            const existing = latestByItem.get(record.item.itemId);
            if (!existing || record.event.timing.startedAt >= existing.event.timing.startedAt) {
                latestByItem.set(record.item.itemId, record);
            }
        }
        const orderedRecords = manifest.items.map((item) => latestByItem.get(item.itemId));
        if (orderedRecords.some((record) => record === undefined))
            continue;
        const itemResults = orderedRecords.map((record) => {
            if (!record)
                throw new Error("unreachable complete drift canary record gap");
            return record.itemResult;
        });
        runs.push({
            runId,
            protocolVersion,
            itemResults,
            passed: itemResults.filter((item) => item.passed).length,
            total: itemResults.length,
            accuracy: itemResults.filter((item) => item.passed).length / itemResults.length,
            startedAt: minIso(itemResults.map((item) => item.startedAt)),
            endedAt: maxIso(itemResults.map((item) => item.endedAt)),
        });
    }
    return runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
}
function aggregateBaseline(runs) {
    if (runs.length === 0)
        return undefined;
    const passed = sum(runs.map((run) => run.passed));
    const total = sum(runs.map((run) => run.total));
    return {
        protocolVersion: runs[0].protocolVersion,
        runIds: runs.map((run) => run.runId),
        passed,
        total,
        accuracy: passed / total,
    };
}
function lastGoodRun(input) {
    const baselineLast = input.completeRuns[input.baselineRunCount - 1];
    if (!baselineLast)
        throw new Error("Drift canary baseline has no last run.");
    let lastGood = baselineLast;
    for (const run of input.completeRuns.slice(input.baselineRunCount, input.currentIndex)) {
        const stats = flagDriftByAccuracyDrop({
            baselinePassed: input.baseline.passed,
            baselineTotal: input.baseline.total,
            currentPassed: run.passed,
            currentTotal: run.total,
            alpha: input.alpha,
        });
        if (!stats.flagged)
            lastGood = run;
    }
    return lastGood;
}
export function driftCanaryAffectedCallsInWindow(records, input) {
    const affected = [];
    const existingFloors = wholeCallStandardFloorsForBenchEvents(records, input.floorSummaryWindow ?? {}, input.summaryOptions);
    for (const record of records) {
        const event = normalizeCanonicalEvent(record.event);
        if (event.request.provider !== input.provider || event.request.model !== input.model)
            continue;
        if (event.timing.startedAt <= input.since || event.timing.startedAt > input.until)
            continue;
        const costUsd = eventCostUsd(event);
        if (costUsd === null)
            continue;
        const existingFloor = existingFloors.get(wholeCallStandardFloorKey({
            tenantId: event.request.tenantId,
            provider: event.request.provider,
            requestId: event.request.requestId,
            startedAt: event.timing.startedAt,
            endedAt: event.timing.endedAt,
        }));
        affected.push({
            requestId: event.request.requestId,
            kind: driftCanaryItemIdFromSuiteTaskId(record.suiteTaskId) ? "canary" : "customer",
            costUsd,
            ...(existingFloor
                ? {
                    appliedCostUsd: 0,
                    supersededByExistingFloor: {
                        signalCode: existingFloor.signalCode,
                        standardLossUsd: existingFloor.standardLossUsd,
                        standardLossMethod: existingFloor.standardLossMethod,
                    },
                }
                : {}),
        });
    }
    return affected;
}
function itemResultForRecord(item, event, grade) {
    const costUsd = eventCostUsd(event);
    return {
        itemId: item.itemId,
        dataset: item.dataset,
        expectedAnswer: grade.expectedAnswer,
        extractedAnswer: grade.extractedAnswer,
        passed: grade.passed,
        responseText: event.response.content,
        requestId: event.request.requestId,
        servedModel: event.response.servedModel,
        ...(event.response.systemFingerprint ? { systemFingerprint: event.response.systemFingerprint } : {}),
        ...(costUsd !== null ? { costUsd } : {}),
        startedAt: event.timing.startedAt,
        endedAt: event.timing.endedAt,
    };
}
function eventCostUsd(event) {
    const price = lookupPriceForEvent(event);
    if (!price.ok || price.pricingStatus === "partial")
        return null;
    return roundUsd(price.expectedChargeUsd);
}
function requestBodyForCanaryCall(manifest, call, effectiveProtocol = driftCanaryEffectiveProtocol(manifest, call.selectedModel)) {
    const userPrompt = promptForCanaryItem(call.item);
    if (call.selectedModel.provider === "anthropic") {
        // Anthropic documents rejected sampling fields on Claude 4.7+/5; those canaries use provider-default temperature.
        // https://docs.anthropic.com/en/api/prompt-validation
        return {
            model: call.selectedModel.model,
            ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
            max_tokens: effectiveProtocol.maxTokenBound,
            system: manifest.protocol.systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
        };
    }
    if (call.selectedModel.provider === "gemini") {
        return {
            model: call.selectedModel.model,
            generationConfig: {
                ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
                maxOutputTokens: effectiveProtocol.maxTokenBound,
            },
            systemInstruction: {
                parts: [{ text: manifest.protocol.systemPrompt }],
            },
            contents: [{
                    role: "user",
                    parts: [{ text: userPrompt }],
                }],
        };
    }
    if (effectiveProtocol.maxTokenParameter === "max_completion_tokens") {
        // GPT-5/o canaries use Chat Completions reasoning-compatible token fields and provider-default temperature.
        // https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
        // https://developers.openai.com/api/docs/guides/reasoning
        return {
            model: call.selectedModel.model,
            max_completion_tokens: effectiveProtocol.maxTokenBound,
            messages: [
                { role: "system", content: manifest.protocol.systemPrompt },
                { role: "user", content: userPrompt },
            ],
        };
    }
    return {
        model: call.selectedModel.model,
        ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
        max_tokens: effectiveProtocol.maxTokenBound,
        messages: [
            { role: "system", content: manifest.protocol.systemPrompt },
            { role: "user", content: userPrompt },
        ],
    };
}
export const __driftCanaryTestHooks = {
    evaluateDriftCanaryModel,
    driftCanaryEffectiveProtocol,
    requestBodyForCanaryCall,
};
function promptForCanaryItem(item) {
    if (item.dataset === "mmlu_hendrycks_test") {
        return [
            item.question,
            "",
            `A. ${item.choices.A}`,
            `B. ${item.choices.B}`,
            `C. ${item.choices.C}`,
            `D. ${item.choices.D}`,
            "",
            "Return only A, B, C, or D.",
        ].join("\n");
    }
    return `${item.question}\n\nReturn only the final numeric answer.`;
}
function routePath(provider, model) {
    if (provider === "anthropic")
        return "/v1/messages";
    if (provider === "gemini")
        return `/v1beta/${geminiModelPath(model ?? "models/provider_default")}:generateContent`;
    if (provider === "openrouter")
        return "/openrouter/v1/chat/completions";
    return "/v1/chat/completions";
}
function isDriftCanarySelectedModel(model) {
    return model.provider === "openai" ||
        model.provider === "anthropic" ||
        model.provider === "gemini" ||
        model.provider === "openrouter";
}
function geminiModelPath(model) {
    return model.startsWith("models/") ? model : `models/${model}`;
}
function providerPlane(provider, model) {
    if (provider === "gemini")
        return GEMINI_DEVELOPER_API_PLANE;
    if (provider === "openrouter")
        return openRouterPlaneForModel(model);
    return undefined;
}
function publicRun(run) {
    return {
        runId: run.runId,
        protocolVersion: run.protocolVersion,
        passed: run.passed,
        total: run.total,
        accuracy: run.accuracy,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
    };
}
function minIso(values) {
    return values.reduce((min, value) => value < min ? value : min);
}
function maxIso(values) {
    return values.reduce((max, value) => value > max ? value : max);
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
//# sourceMappingURL=runner.js.map