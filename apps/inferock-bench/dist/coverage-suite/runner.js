import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GEMINI_DEVELOPER_API_PLANE, lookupPrice, lookupPriceForEvent, roundUsd, } from "@inferock/measure/pricing";
import { normalizeCanonicalEvent } from "@inferock/measure/canonical-event";
import { formatApproxTimeLost } from "@inferock/measure/time-loss";
import { WATERMARK_NAME, WATERMARK_URL, benchKeyFromConfig, } from "../config.js";
import { LOCAL_RECEIPT_LOCALITY } from "../receipt.js";
import { createBenchApp } from "../proxy.js";
import { formatCoverageStatus, formatUsd, isExposureReportRow, renderCoverageSummaryLine, summarizeBenchEvents, coverageSummaryFromSurfaces, } from "../summary.js";
import { LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION, SPEEDTEST_RECEIPT_SCHEMA_VERSION, } from "../receipt-schema.js";
import { BENCH_PACKAGE_VERSION } from "../version.js";
import { normalizedUsageFromBaselineTask, } from "./baseline.js";
import { BenchRequestAnnotationRegistry, registerCoverageSuiteOutputSchemas, registerCoverageSuiteTaskRequestAnnotations, } from "./runner-annotations.js";
import { DRIFT_CANARY_BASELINE_RUN_COUNT, loadDriftCanaryManifest, } from "../drift-canary/manifest.js";
import { DRIFT_CANARY_PROGRESS_TASK_ID, runDriftCanary, } from "../drift-canary/runner.js";
import { openRouterPlaneForModel } from "../openrouter-pins.js";
export const SPEND_CAP_REACHED_MESSAGE = "spend cap reached — run incomplete";
export async function runBuiltInCoverageSuite(input) {
    const runId = input.runId ?? `speedtest_${randomUUID()}`;
    const startedAt = input.startedAt ?? new Date().toISOString();
    const consentedAt = input.consentedAt ?? startedAt;
    const log = input.log ?? console.log;
    const registry = new BenchRequestAnnotationRegistry();
    registerCoverageSuiteOutputSchemas(input.suite, { tenantId: "local" });
    const app = createBenchApp({
        config: input.config,
        store: input.store,
        env: input.env,
        providerFetch: input.providerFetch,
        requestAnnotations: registry,
        log,
    });
    const benchKey = benchKeyFromConfig(input.config, input.env);
    if (!benchKey)
        throw new Error("Built-in coverage runner requires a local bench key.");
    let status = "completed";
    let statusReason;
    let callsLaunched = 0;
    const plannedCalls = buildPlannedSuiteCalls({
        suite: input.suite,
        baseline: input.baseline,
        selectedModels: input.estimate.selectedModels,
        eventTime: consentedAt,
    });
    let driftCanaryManifest;
    try {
        driftCanaryManifest = await loadDriftCanaryManifest();
    }
    catch (error) {
        status = "failed";
        statusReason = error instanceof Error ? error.message : "drift canary manifest failed to load";
    }
    const plannedDriftCanaryCalls = driftCanaryManifest
        ? input.estimate.selectedModels.length * driftCanaryManifest.items.length
        : 0;
    await input.onProgress?.({
        type: "run_started",
        runId,
        plannedCallCount: plannedCalls.length + plannedDriftCanaryCalls,
        taskIds: [...plannedCalls.map((call) => call.taskId), DRIFT_CANARY_PROGRESS_TASK_ID],
    });
    for (let index = 0; status === "completed" && index < plannedCalls.length;) {
        if (input.abortSignal?.aborted) {
            status = callsLaunched === 0 ? "aborted_before_calls" : "killed";
            statusReason = "aborted_by_user";
            break;
        }
        const call = plannedCalls[index];
        if (!call)
            break;
        const wave = call.concurrencyGroup
            ? plannedCalls.slice(index).filter((entry) => entry.concurrencyGroup === call.concurrencyGroup &&
                entry.taskId === call.taskId &&
                entry.selectedModel.provider === call.selectedModel.provider)
            : [call];
        const budget = await enforcePreLaunchBudget(input, runId, wave);
        if (budget.status !== "completed") {
            status = budget.status;
            statusReason = budget.statusReason;
            break;
        }
        try {
            callsLaunched += wave.length;
            await input.onProgress?.({
                type: "task_started",
                runId,
                taskId: call.taskId,
                callCount: wave.length,
                estimatedCostUsd: roundUsd(wave.reduce((total, entry) => total + entry.estimatedCostUsd, 0)),
            });
            await Promise.all(wave.map((entry) => executePlannedCall({
                app,
                registry,
                runId,
                benchKey,
                suite: input.suite,
                call: entry,
            })));
            await input.onProgress?.({
                type: "task_completed",
                runId,
                taskId: call.taskId,
                callCount: wave.length,
                estimatedCostUsd: roundUsd(wave.reduce((total, entry) => total + entry.estimatedCostUsd, 0)),
            });
        }
        catch (error) {
            status = "failed";
            statusReason = error instanceof Error ? error.message : "coverage suite task failed";
            await input.onProgress?.({
                type: "task_failed",
                runId,
                taskId: call.taskId,
                statusReason,
            });
            break;
        }
        const postCall = await postCallBudgetState(input, runId);
        if (postCall.status !== "completed") {
            status = postCall.status;
            statusReason = postCall.statusReason;
            break;
        }
        index += wave.length;
    }
    let driftCanary;
    if (status === "completed" && driftCanaryManifest) {
        await input.onProgress?.({
            type: "task_started",
            runId,
            taskId: DRIFT_CANARY_PROGRESS_TASK_ID,
            callCount: plannedDriftCanaryCalls,
        });
        try {
            driftCanary = await runDriftCanary({
                runId,
                manifest: driftCanaryManifest,
                app,
                registry,
                benchKey,
                selectedModels: input.estimate.selectedModels,
                store: input.store,
                eventTime: consentedAt,
                summaryOptions: { config: input.config },
                abortSignal: input.abortSignal,
                budget: {
                    preLaunch: async (calls) => driftCanaryBudgetState(await enforcePreLaunchBudget(input, runId, calls)),
                    postCall: async () => driftCanaryBudgetState(await postCallBudgetState(input, runId)),
                },
            });
            if (driftCanary.status === "completed") {
                await input.onProgress?.({
                    type: "task_completed",
                    runId,
                    taskId: DRIFT_CANARY_PROGRESS_TASK_ID,
                    callCount: driftCanary.callsLaunched,
                });
            }
            else {
                status = driftCanary.status;
                statusReason = driftCanary.statusReason ?? "drift_canary_incomplete";
                await input.onProgress?.({
                    type: "task_failed",
                    runId,
                    taskId: DRIFT_CANARY_PROGRESS_TASK_ID,
                    statusReason,
                });
            }
        }
        catch (error) {
            status = "failed";
            statusReason = error instanceof Error ? error.message : "drift canary failed";
            await input.onProgress?.({
                type: "task_failed",
                runId,
                taskId: DRIFT_CANARY_PROGRESS_TASK_ID,
                statusReason,
            });
        }
    }
    await input.onProgress?.({
        type: "run_drained",
        runId,
    });
    await input.onProgress?.({
        type: "run_completed",
        runId,
        status,
        ...(statusReason ? { statusReason } : {}),
    });
    const endedAt = new Date().toISOString();
    const records = await input.store.readAll();
    const summary = summarizeBenchEvents(records, { runId }, { config: input.config });
    const receipt = createSpeedTestReceiptBundle({
        runId,
        status,
        statusReason,
        startedAt,
        endedAt,
        consentedAt,
        estimate: input.estimate,
        summary,
        suite: input.suite,
        ...(driftCanary ? { driftCanary } : {}),
    });
    return {
        runId,
        status,
        ...(statusReason ? { statusReason } : {}),
        receipt,
    };
}
export function createSpeedTestReceiptBundle(input) {
    const driftRows = driftCanaryReportRows(input.driftCanary);
    const driftStandardLossUsd = roundUsd(sum(driftRows.map((row) => row.standardLossUsd)));
    const driftProviderRecognizedUsd = roundUsd(sum(driftRows.map((row) => row.providerRecognizedUsd)));
    const driftRecognitionGapUsd = roundUsd(sum(driftRows.map((row) => row.recognitionGapUsd)));
    const coverage = applyDriftCanaryCoverage(input.summary.coverage, input.driftCanary);
    const selectedProviders = uniqueProviders(input.estimate.selectedModels.map((model) => model.provider));
    return {
        schemaVersion: SPEEDTEST_RECEIPT_SCHEMA_VERSION,
        run: {
            runId: input.runId,
            status: input.status,
            ...(input.statusReason ? { statusReason: input.statusReason } : {}),
            generator: input.estimate.generator,
            ...(input.providerId ? { providerId: input.providerId } : {}),
            suiteVersion: input.suite.suiteVersion,
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            selectedModels: input.estimate.selectedModels.map((model) => ({
                provider: model.provider,
                model: model.model,
            })),
        },
        consent: {
            consentedAt: input.consentedAt,
            estimate: createCoverageEstimateReceipt(input.estimate),
            spendCapUsd: input.estimate.spendCapUsd,
            ...(input.acceptedAgentInstallHash ? { acceptedAgentInstallHash: input.acceptedAgentInstallHash } : {}),
        },
        totals: {
            measuredCalls: input.summary.measuredCalls,
            providerSpendUsd: input.summary.providerSpendUsd,
            money: {
                standardLossUsd: roundUsd(input.summary.moneyTotals.standardLossUsd + driftStandardLossUsd),
                providerRecognizedUsd: roundUsd(input.summary.moneyTotals.providerRecognizedUsd + driftProviderRecognizedUsd),
                recognitionGapUsd: roundUsd(input.summary.moneyTotals.recognitionGapUsd + driftRecognitionGapUsd),
                unrecognizedUsd: roundUsd(input.summary.moneyTotals.unrecognizedUsd + driftRecognitionGapUsd),
                providerSpendUsd: input.summary.moneyTotals.providerSpendUsd,
            },
            duration: input.summary.durationTotals,
            standardLossUsd: roundUsd(input.summary.standardLossUsd + driftStandardLossUsd),
            providerRecognizedUsd: roundUsd(input.summary.providerRecognizedUsd + driftProviderRecognizedUsd),
            recognitionGapUsd: roundUsd(input.summary.recognitionGapUsd + driftRecognitionGapUsd),
            unrecognizedUsd: roundUsd(input.summary.unrecognizedUsd + driftRecognitionGapUsd),
            failures: input.summary.failureCount + driftRows.length,
        },
        coverage,
        exposures: input.summary.exposures,
        rows: [...input.summary.rows, ...driftRows],
        ...(input.driftCanary ? { driftCanary: input.driftCanary } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.trafficMix ? { trafficMix: input.trafficMix } : {}),
        ...(input.agentOrganicTasks ? { agentOrganicTasks: input.agentOrganicTasks } : {}),
        providerScope: {
            ...(input.providerId ? { provider: input.providerId } : {}),
            selectedProviders,
            parallelProviderCount: 1,
            localContentionPossible: false,
        },
        assumptions: input.summary.slaAssumptions,
        locality: LOCAL_RECEIPT_LOCALITY,
        watermark: {
            name: WATERMARK_NAME,
            url: WATERMARK_URL,
        },
    };
}
export function migrateSpeedTestReceiptBundle(value) {
    if (!isRecord(value) || !isRecord(value.run) || !isRecord(value.totals) || !isRecord(value.coverage)) {
        return null;
    }
    if (value.schemaVersion === SPEEDTEST_RECEIPT_SCHEMA_VERSION) {
        return sanitizeCurrentSpeedTestReceiptBundle(value);
    }
    if (value.schemaVersion !== LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION)
        return null;
    const assumptions = isRecord(value.assumptions)
        ? value.assumptions
        : legacySpeedTestAssumptions();
    const rows = Array.isArray(value.rows) ? value.rows.map(migrateLegacySpeedTestRow) : [];
    const moneyRows = rows.filter(isMoneyNativeSpeedTestRow);
    const moneyStandardLossUsd = roundUsd(sum(moneyRows.map((row) => row.standardLossUsd)));
    const moneyProviderRecognizedUsd = roundUsd(sum(moneyRows.map((row) => row.providerRecognizedUsd)));
    const moneyRecognitionGapUsd = roundUsd(sum(moneyRows.map((row) => row.recognitionGapUsd)));
    const legacyCombinedStandardLossUsd = numberValue(value.totals.standardLossUsd) ?? 0;
    const providerSpendUsd = numberValue(value.totals.providerSpendUsd) ?? 0;
    return {
        ...value,
        schemaVersion: SPEEDTEST_RECEIPT_SCHEMA_VERSION,
        totals: {
            measuredCalls: numberValue(value.totals.measuredCalls) ?? 0,
            providerSpendUsd,
            money: {
                standardLossUsd: moneyStandardLossUsd,
                providerRecognizedUsd: moneyProviderRecognizedUsd,
                recognitionGapUsd: moneyRecognitionGapUsd,
                unrecognizedUsd: moneyRecognitionGapUsd,
                providerSpendUsd,
            },
            duration: {
                timeLossMs: sum(rows.map((row) => row.timeLossMs)),
                providerRecognizedTimeLossMs: sum(rows.map((row) => row.providerRecognizedTimeLossMs)),
                recognitionGapTimeMs: sum(rows.map((row) => row.recognitionGapTimeMs)),
                dollarTranslationUsd: roundUsd(sum(rows.map((row) => row.dollarTranslationUsd ?? 0))),
                rate: assumptions.timeValueRate,
                thresholds: assumptions.activeLatencySegments,
            },
            standardLossUsd: moneyStandardLossUsd,
            providerRecognizedUsd: moneyProviderRecognizedUsd,
            recognitionGapUsd: moneyRecognitionGapUsd,
            unrecognizedUsd: moneyRecognitionGapUsd,
            failures: numberValue(value.totals.failures) ?? 0,
            legacyCombinedStandardLossUsd,
        },
        exposures: [],
        rows,
        assumptions,
    };
}
function legacySpeedTestAssumptions() {
    return {
        standardVersion: "legacy",
        timeValueRate: {
            usdPerHour: 0,
            currency: "USD",
            unit: "hour",
            label: "legacy",
            oneLineWhy: "legacy speed-test receipt",
            overrideKey: "legacy",
        },
        activeLatencySegments: [],
        impactFooterLines: [],
    };
}
function migrateLegacySpeedTestRow(row) {
    const record = isRecord(row) ? row : {};
    const code = stringValue(record.code) ?? "";
    const failureClass = stringValue(record.failureClass) ?? "";
    const evidenceGrade = stringValue(record.evidenceGrade) ?? "";
    const count = numberValue(record.count) ?? 0;
    const standardLossUsd = numberValue(record.standardLossUsd) ?? 0;
    const providerRecognizedUsd = numberValue(record.providerRecognizedUsd) ?? 0;
    const recognitionGapUsd = numberValue(record.recognitionGapUsd) ??
        numberValue(record.unrecognizedUsd) ??
        Math.max(0, standardLossUsd - providerRecognizedUsd);
    const existingPrimary = record.primaryValueKind === "time_loss" || record.primaryValueKind === "money"
        ? record.primaryValueKind
        : null;
    const durationPrimary = existingPrimary === "time_loss" ||
        failureClass === "latency" ||
        failureClass === "downtime";
    return {
        code,
        failureClass,
        evidenceGrade,
        count,
        primaryValueKind: durationPrimary ? "time_loss" : "money",
        standardLossUsd: durationPrimary ? 0 : standardLossUsd,
        providerRecognizedUsd: durationPrimary ? 0 : providerRecognizedUsd,
        recognitionGapUsd: durationPrimary ? 0 : recognitionGapUsd,
        unrecognizedUsd: durationPrimary ? 0 : recognitionGapUsd,
        timeLossMs: numberValue(record.timeLossMs) ?? 0,
        providerRecognizedTimeLossMs: numberValue(record.providerRecognizedTimeLossMs) ?? 0,
        recognitionGapTimeMs: numberValue(record.recognitionGapTimeMs) ?? 0,
        dollarTranslationUsd: durationPrimary
            ? numberValue(record.dollarTranslationUsd) ?? standardLossUsd
            : null,
        ...(durationPrimary ? { legacyCompatibilityLabel: `legacy dollarized ${failureClass}` } : {}),
        pricingUnknownCount: numberValue(record.pricingUnknownCount) ?? 0,
        howComputed: Array.isArray(record.howComputed)
            ? record.howComputed.filter((line) => typeof line === "string")
            : [],
    };
}
function isMoneyNativeSpeedTestRow(row) {
    return row.primaryValueKind === "money" &&
        row.failureClass !== "latency" &&
        row.failureClass !== "downtime";
}
function driftCanaryReportRows(driftCanary) {
    if (!driftCanary)
        return [];
    return driftCanary.models.flatMap((model) => {
        const dollarization = model.dollarization;
        if (!dollarization)
            return [];
        return [{
                code: "DRIFT_REGRESSION",
                failureClass: dollarization.failureClass,
                evidenceGrade: dollarization.evidenceGrade,
                count: dollarization.affectedCallCount,
                primaryValueKind: "money",
                standardLossUsd: dollarization.standardLossUsd,
                providerRecognizedUsd: dollarization.providerRecognizedLossUsd,
                recognitionGapUsd: dollarization.recognitionGapUsd,
                unrecognizedUsd: dollarization.recognitionGapUsd,
                timeLossMs: 0,
                providerRecognizedTimeLossMs: 0,
                recognitionGapTimeMs: 0,
                dollarTranslationUsd: null,
                pricingUnknownCount: 0,
                howComputed: [String(dollarization.computationTrace.oneLine ?? "drift_canary_floor_v1")],
            }];
    });
}
function applyDriftCanaryCoverage(coverage, driftCanary) {
    if (!driftCanary)
        return coverage;
    const flaggedModels = driftCanary.models.filter((model) => model.status === "drift_flagged");
    const fullRunCompleted = driftCanary.status === "completed" &&
        driftCanary.plannedCallCount > 0 &&
        driftCanary.callsLaunched === driftCanary.plannedCallCount;
    const surfaces = coverage.surfaces.map((surface) => {
        if (surface.surfaceId !== "drift_regression")
            return surface;
        if (!fullRunCompleted || driftCanary.models.some((model) => model.status === "incomplete")) {
            return driftCanaryNotOpenableSurface(surface, driftCanary, "drift canary did not complete the full versioned canary set");
        }
        if (flaggedModels.length > 0) {
            return {
                ...surface,
                status: "signal",
                signalCount: flaggedModels.length,
                evidenceGrade: "unrecognized_standard_loss",
                label: `${flaggedModels.length} per-model drift canary regression${flaggedModels.length === 1 ? "" : "s"} flagged`,
                detectorCodes: [...new Set([...surface.detectorCodes, "DRIFT_REGRESSION"])],
                watchedEvidence: {
                    ...(surface.watchedEvidence ?? {}),
                    driftCanaryStatus: driftCanary.status,
                    driftCanaryManifestHash: driftCanary.manifestHash,
                },
                details: {
                    ...(surface.details ?? {}),
                    methodId: "per_model_known_answer_canary_v1",
                    methodVersion: "drift-canary-method-v1-2026-07-04",
                    dollarizationMethodId: "drift_canary_floor_v1",
                    manifestHash: driftCanary.manifestHash,
                    flaggedModels: flaggedModels.map((model) => ({
                        provider: model.provider,
                        model: model.model,
                        protocolVersion: model.protocolVersion,
                        effectiveProtocol: model.effectiveProtocol,
                        pValue: model.stats?.pValue,
                        baselineAccuracy: model.stats?.baselineAccuracy,
                        currentAccuracy: model.stats?.currentAccuracy,
                        standardLossUsd: model.dollarization?.standardLossUsd,
                    })),
                },
            };
        }
        const baselineCollecting = driftCanary.models.filter((model) => model.status === "baseline_collecting");
        if (baselineCollecting.length > 0) {
            const baseline = baselineCollecting.reduce((lowest, model) => {
                const collection = model.baselineCollection;
                if (!collection)
                    return lowest;
                return collection.completedPriorRuns < lowest.completedPriorRuns ? collection : lowest;
            }, baselineCollecting[0]?.baselineCollection ?? {
                completedPriorRuns: 0,
                requiredRuns: DRIFT_CANARY_BASELINE_RUN_COUNT,
            });
            return driftCanaryNotOpenableSurface(surface, driftCanary, `drift canary baseline collecting (${baseline.completedPriorRuns}/${baseline.requiredRuns})`);
        }
        if (flaggedModels.length === 0) {
            return {
                ...surface,
                status: "watched_clean",
                signalCount: 0,
                evidenceGrade: "triage_only",
                label: `watched-clean: full per-model drift canary ran against established baseline (${driftCanary.models.length} model${driftCanary.models.length === 1 ? "" : "s"})`,
                watchedEvidence: {
                    ...(surface.watchedEvidence ?? {}),
                    driftCanaryStatus: driftCanary.status,
                    driftCanaryManifestHash: driftCanary.manifestHash,
                    driftCanaryPlannedCallCount: driftCanary.plannedCallCount,
                    driftCanaryCallsLaunched: driftCanary.callsLaunched,
                    protocolVersions: driftCanary.models.map((model) => ({
                        provider: model.provider,
                        model: model.model,
                        protocolVersion: model.protocolVersion,
                    })),
                },
                details: {
                    ...(surface.details ?? {}),
                    methodId: "per_model_known_answer_canary_v1",
                    methodVersion: "drift-canary-method-v1-2026-07-04",
                    manifestHash: driftCanary.manifestHash,
                    effectiveProtocols: driftCanary.models.map((model) => ({
                        provider: model.provider,
                        model: model.model,
                        protocolVersion: model.protocolVersion,
                        effectiveProtocol: model.effectiveProtocol,
                    })),
                },
            };
        }
        return surface;
    });
    return coverageFromSurfaces(coverage, surfaces);
}
function driftCanaryNotOpenableSurface(surface, driftCanary, reason) {
    return {
        ...surface,
        status: "not_openable",
        signalCount: 0,
        evidenceGrade: "not_applicable",
        label: `not-openable: ${reason}`,
        notOpenableReason: reason,
        watchedEvidence: {
            ...(surface.watchedEvidence ?? {}),
            driftCanaryStatus: driftCanary.status,
            driftCanaryManifestHash: driftCanary.manifestHash,
            driftCanaryPlannedCallCount: driftCanary.plannedCallCount,
            driftCanaryCallsLaunched: driftCanary.callsLaunched,
            baselineCollection: driftCanary.models
                .filter((model) => model.status === "baseline_collecting")
                .map((model) => ({
                provider: model.provider,
                model: model.model,
                protocolVersion: model.protocolVersion,
                effectiveProtocol: model.effectiveProtocol,
                completedPriorRuns: model.baselineCollection?.completedPriorRuns ?? 0,
                requiredRuns: model.baselineCollection?.requiredRuns ?? DRIFT_CANARY_BASELINE_RUN_COUNT,
            })),
        },
        details: {
            ...(surface.details ?? {}),
            methodId: "per_model_known_answer_canary_v1",
            methodVersion: "drift-canary-method-v1-2026-07-04",
            phase: "baseline_collecting",
        },
    };
}
function coverageFromSurfaces(coverage, surfaces) {
    return coverageSummaryFromSurfaces(coverage, surfaces);
}
export function renderSpeedTestReceipt(bundle) {
    if (bundle.providerReceipts?.length) {
        return [
            `speed-test status: ${bundle.run.status}${bundle.run.statusReason ? ` (${bundle.run.statusReason})` : ""}`,
            `run: ${bundle.run.runId}`,
            `generator: ${bundle.run.generator}`,
            `provider scope: ${bundle.providerScope?.selectedProviders.join(", ") ?? "unknown"} (${bundle.providerScope?.parallelProviderCount ?? bundle.providerReceipts.length} parallel)`,
            ...(bundle.trafficMix ? [
                `traffic mix total: organic-agent ${bundle.trafficMix.organicAgentTasks} | harness-fill ${bundle.trafficMix.harnessPreconditionTasks} | drift-canary ${bundle.trafficMix.driftCanaryCalls} | sdk-retry ${bundle.trafficMix.sdkRetryWorkerCalls}`,
            ] : []),
            speedTestHeadline(bundle),
            `provider-recognized ${formatUsd(bundle.totals.money.providerRecognizedUsd)} | money recognition gap ${formatUsd(bundle.totals.money.recognitionGapUsd)} | time recognition gap ${formatApproxTimeLost(bundle.totals.duration.recognitionGapTimeMs)}`,
            ...speedTestExposureLines(bundle),
            ...(bundle.totals.legacyCombinedStandardLossUsd !== undefined
                ? [`legacy combined standard loss: ${formatUsd(bundle.totals.legacyCombinedStandardLossUsd)} (legacy dollarized latency/downtime not included in v3 money loss)`]
                : []),
            ...providerLedgerLines(bundle),
            ...bundle.providerReceipts.flatMap((receipt) => {
                const provider = receipt.providerScope?.provider ?? receipt.run.selectedModels[0]?.provider ?? "unknown";
                return [
                    `provider ${provider}: ${renderCoverageSummaryLine(receipt.coverage)}`,
                    ...(receipt.agent ? [`provider ${provider} agent: ${receipt.agent.name}@${receipt.agent.version} (${receipt.agent.source})`] : []),
                    ...(receipt.trafficMix ? [`provider ${provider} traffic mix: organic-agent ${receipt.trafficMix.organicAgentTasks} | harness-fill ${receipt.trafficMix.harnessPreconditionTasks} | drift-canary ${receipt.trafficMix.driftCanaryCalls} | sdk-retry ${receipt.trafficMix.sdkRetryWorkerCalls}`] : []),
                ];
            }),
            `${bundle.watermark.name} - ${bundle.watermark.url}`,
        ].join("\n");
    }
    const lines = [
        `speed-test status: ${bundle.run.status}${bundle.run.statusReason ? ` (${bundle.run.statusReason})` : ""}`,
        `run: ${bundle.run.runId}`,
        `generator: ${bundle.run.generator}${bundle.agent ? ` (${bundle.agent.name}@${bundle.agent.version}, ${bundle.agent.source})` : ""}`,
        ...(bundle.trafficMix ? [
            `traffic mix: organic-agent ${bundle.trafficMix.organicAgentTasks} | harness-fill ${bundle.trafficMix.harnessPreconditionTasks} | drift-canary ${bundle.trafficMix.driftCanaryCalls} | sdk-retry ${bundle.trafficMix.sdkRetryWorkerCalls}`,
        ] : []),
        speedTestHeadline(bundle),
        `provider-recognized ${formatUsd(bundle.totals.money.providerRecognizedUsd)} | money recognition gap ${formatUsd(bundle.totals.money.recognitionGapUsd)} | time recognition gap ${formatApproxTimeLost(bundle.totals.duration.recognitionGapTimeMs)}`,
        ...speedTestExposureLines(bundle),
        ...(bundle.totals.legacyCombinedStandardLossUsd !== undefined
            ? [`legacy combined standard loss: ${formatUsd(bundle.totals.legacyCombinedStandardLossUsd)} (legacy dollarized latency/downtime not included in v3 money loss)`]
            : []),
        ...providerLedgerLines(bundle),
        renderCoverageSummaryLine(bundle.coverage),
        "surface | status | count | label",
        ...bundle.coverage.surfaces.map((surface) => [
            surface.measure,
            formatCoverageStatus(surface.status),
            String(surface.signalCount),
            surface.label,
        ].join(" | ")),
        `${bundle.watermark.name} - ${bundle.watermark.url}`,
    ];
    return lines.join("\n");
}
function providerLedgerLines(bundle) {
    return (bundle.providerLedgers ?? []).map((ledger) => `provider ${ledger.provider} ledger: money loss ${formatUsd(ledger.standardLossUsd)} | provider-recognized ${formatUsd(ledger.providerRecognizedUsd)} | money gap ${formatUsd(ledger.recognitionGapUsd)} | time lost ${formatApproxTimeLost(ledger.durationTimeLossMs)} | approx ${formatUsd(ledger.durationDollarTranslationUsd)} at your rate`);
}
function speedTestHeadline(bundle) {
    return `spent ${formatUsd(bundle.totals.providerSpendUsd)} · money loss ${formatUsd(bundle.totals.money.standardLossUsd)} · time loss ${formatApproxTimeLost(bundle.totals.duration.timeLossMs)}`;
}
function speedTestExposureLines(bundle) {
    return (bundle.exposures ?? [])
        .filter((exposure) => exposure.amount > 0)
        .map((exposure) => {
        const count = `${exposure.count} invoice exposure${exposure.count === 1 ? "" : "s"}`;
        return exposure.class === "cache_discount_at_risk"
            ? `cache discount at risk — ${exposure.guidance}: ${count}, ${formatSpeedTestUsd(exposure.amount)}`
            : `${exposure.class} — ${exposure.guidance}: ${count}, ${formatSpeedTestUsd(exposure.amount)}`;
    });
}
function sanitizeCurrentSpeedTestReceiptBundle(bundle) {
    if (!hasPositiveExposure(bundle.exposures))
        return bundle;
    const rows = bundle.rows.filter((row) => !isExposureReportRow(row));
    if (rows.length === bundle.rows.length)
        return bundle;
    const moneyRows = rows.filter((row) => row.primaryValueKind === "money");
    const money = {
        ...bundle.totals.money,
        standardLossUsd: roundUsd(sum(moneyRows.map((row) => row.standardLossUsd))),
        providerRecognizedUsd: roundUsd(sum(moneyRows.map((row) => row.providerRecognizedUsd))),
        recognitionGapUsd: roundUsd(sum(moneyRows.map((row) => row.recognitionGapUsd))),
        unrecognizedUsd: roundUsd(sum(moneyRows.map((row) => row.unrecognizedUsd))),
    };
    return {
        ...bundle,
        totals: {
            ...bundle.totals,
            money,
            standardLossUsd: money.standardLossUsd,
            providerRecognizedUsd: money.providerRecognizedUsd,
            recognitionGapUsd: money.recognitionGapUsd,
            unrecognizedUsd: money.unrecognizedUsd,
        },
        rows,
    };
}
function hasPositiveExposure(exposures) {
    return (exposures ?? []).some((exposure) => exposure.amount > 0 && exposure.count > 0);
}
function formatSpeedTestUsd(value) {
    if (value > 0 && value < 0.01)
        return `$${value.toFixed(6)}`;
    return formatUsd(value);
}
function driftCanaryBudgetState(state) {
    if (state.status === "completed" || state.status === "killed" || state.status === "failed") {
        return {
            status: state.status,
            ...(state.statusReason ? { statusReason: state.statusReason } : {}),
        };
    }
    return {
        status: "killed",
        statusReason: state.statusReason ?? "aborted_by_user",
    };
}
export async function writeSpeedTestReceiptBundle(receiptsDir, bundle) {
    await mkdir(receiptsDir, { recursive: true });
    const filename = `speedtest-${bundle.run.runId}-${bundle.run.endedAt.replace(/[:.]/g, "-")}.json`;
    const path = join(receiptsDir, filename);
    await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    return path;
}
export async function createMeasuredCoverageTokenBaseline(input) {
    const sourceCommit = requiredRecordBaselineSourceCommit(input.sourceCommit);
    const sampleRecordsByTask = new Map();
    for (const record of input.records) {
        if (!record.suiteTaskId)
            continue;
        sampleRecordsByTask.set(record.suiteTaskId, [
            ...(sampleRecordsByTask.get(record.suiteTaskId) ?? []),
            record,
        ]);
    }
    const tasks = input.suite.tasks.map((task) => {
        const samples = sampleRecordsByTask.get(task.taskId) ?? [];
        if (samples.length === 0) {
            throw new Error(`Cannot record coverage token baseline: task ${task.taskId} has no measured samples.`);
        }
        return {
            taskId: task.taskId,
            plannedCalls: samples.length,
            provenance: "covrun_measured",
            usage: maxUsageForSamples(samples),
        };
    });
    const providerModelsMeasured = input.providerModelsMeasured?.length
        ? [...input.providerModelsMeasured]
        : measuredProviderModels(input.records);
    const baseline = {
        schemaVersion: "inferock-coverage-token-baseline-v1",
        suiteVersion: input.suite.suiteVersion,
        suiteManifestHash: input.suite.manifestHash,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        generatedBy: "covrun",
        provenance: {
            sourcePath: input.sourcePath ?? "inferock-bench test --record-baseline",
            sourceCommit,
            benchPackageVersion: input.benchPackageVersion ?? BENCH_PACKAGE_VERSION,
            providerModelsMeasured,
            sampleCountByTask: Object.fromEntries(input.suite.tasks.map((task) => [
                task.taskId,
                sampleRecordsByTask.get(task.taskId)?.length ?? 0,
            ])),
            notes: input.notes ?? "Measured by the maintainer record-baseline path from real built-in suite provider calls.",
        },
        quantile: "max",
        tasks,
    };
    if (input.outputPath) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    }
    return baseline;
}
function requiredRecordBaselineSourceCommit(value) {
    const commit = value?.trim();
    if (!commit || commit === "unknown") {
        throw new Error("Cannot record coverage token baseline without git source commit provenance.");
    }
    return commit;
}
export function createCoverageEstimateReceipt(estimate) {
    return {
        estimateHash: estimate.estimateHash,
        baselineVersion: estimate.baselineVersion,
        baselineContentDigest: estimate.baselineContentDigest,
        estimatedTokensByCategory: estimate.estimatedTokensByCategory,
        estimatedUsd: estimate.estimatedUsd,
        estimatedUsdBand: estimate.estimatedUsdBand,
        pricing: estimate.pricing.map((pricing) => ({ ...pricing })),
        driftCanaryManifestHash: estimate.driftCanaryManifestHash,
    };
}
async function enforcePreLaunchBudget(input, runId, calls) {
    const summary = summarizeBenchEvents(await input.store.readAll(), { runId }, { config: input.config });
    const estimatedInFlightUsd = roundUsd(calls.reduce((total, call) => total + call.estimatedCostUsd, 0));
    if (roundUsd(summary.providerSpendUsd + estimatedInFlightUsd) > input.estimate.spendCapUsd) {
        return {
            status: "killed",
            statusReason: SPEND_CAP_REACHED_MESSAGE,
        };
    }
    return { status: "completed" };
}
async function postCallBudgetState(input, runId) {
    const summary = summarizeBenchEvents(await input.store.readAll(), { runId }, { config: input.config });
    if (actualRunPricingUnknown(await input.store.readAll(), runId)) {
        return {
            status: "failed",
            statusReason: "pricing_unknown_after_provider_call",
        };
    }
    if (summary.providerSpendUsd > input.estimate.spendCapUsd) {
        return {
            status: "killed",
            statusReason: SPEND_CAP_REACHED_MESSAGE,
        };
    }
    return { status: "completed" };
}
function actualRunPricingUnknown(records, runId) {
    return records
        .filter((record) => record.runId === runId)
        .some((record) => {
        const event = normalizeCanonicalEvent(record.event);
        const price = lookupPriceForEvent(event);
        return !price.ok || price.pricingStatus === "partial";
    });
}
async function executePlannedCall(input) {
    const annotations = registerCoverageSuiteTaskRequestAnnotations(input.registry, {
        manifest: input.suite,
        runId: input.runId,
        taskId: input.call.taskId,
    });
    const body = requestBodyForCall(input.call);
    const headers = {
        authorization: `Bearer ${input.benchKey}`,
        "content-type": "application/json",
        ...annotations.headers,
    };
    if (annotations.annotation.factualityContract) {
        headers["x-inferock-factuality-contract"] = JSON.stringify(annotations.annotation.factualityContract);
    }
    const response = await input.app.request(input.call.path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    await response.arrayBuffer();
    if (response.status >= 400) {
        throw new Error(`coverage suite task ${input.call.taskId} failed through local proxy with HTTP ${response.status}`);
    }
}
function buildPlannedSuiteCalls(input) {
    const baselineByTaskId = new Map(input.baseline.tasks.map((task) => [task.taskId, task]));
    const calls = [];
    for (const task of input.suite.tasks) {
        for (const selectedModel of input.selectedModels) {
            const route = routeForTask(task, selectedModel.provider);
            if (!route)
                continue;
            const baselineTask = baselineByTaskId.get(task.taskId);
            if (!baselineTask)
                throw new Error(`Coverage baseline missing task ${task.taskId}.`);
            const price = lookupPrice({
                provider: selectedModel.provider,
                model: selectedModel.model,
                eventTime: input.eventTime,
                ...(providerPlane(selectedModel.provider, selectedModel.model)
                    ? { plane: providerPlane(selectedModel.provider, selectedModel.model) }
                    : {}),
                usage: normalizedUsageFromBaselineTask(baselineTask),
            });
            if (!price.ok || price.pricingStatus === "partial") {
                throw new Error(`Coverage runner cannot bound spend for ${selectedModel.provider}:${selectedModel.model}.`);
            }
            const plannedCalls = plannedCallsForCoverageSuiteTask(task);
            for (let callIndex = 0; callIndex < plannedCalls; callIndex += 1) {
                calls.push({
                    task,
                    taskId: task.taskId,
                    selectedModel,
                    route,
                    path: routePath(route, selectedModel.model),
                    callIndex,
                    plannedCalls,
                    estimatedCostUsd: price.expectedChargeUsd,
                    ...(task.concurrencyGroup ? { concurrencyGroup: task.concurrencyGroup } : {}),
                });
            }
        }
    }
    return calls;
}
function routeForTask(task, provider) {
    const routes = task.providerRoutes.filter((route) => route.startsWith(`${provider}:`));
    if (routes.length === 0)
        return undefined;
    switch (provider) {
        case "anthropic":
            return "anthropic_messages";
        case "gemini":
            if (routes.includes("gemini:gemini.generateContent"))
                return "gemini_generate_content";
            throw new Error(`Unsupported Gemini coverage route for task ${task.taskId}: ${routes.join(",")}`);
        case "openai":
            if (routes.includes("openai:responses") && !routes.includes("openai:chat.completions")) {
                return "openai_responses";
            }
            return "openai_chat_completions";
        case "openrouter":
            if (routes.includes("openrouter:openai_compatible_chat") || routes.includes("openrouter:chat.completions")) {
                return "openrouter_chat_completions";
            }
            throw new Error(`Unsupported OpenRouter coverage route for task ${task.taskId}: ${routes.join(",")}`);
    }
}
function routePath(route, model) {
    switch (route) {
        case "openai_chat_completions":
            return "/v1/chat/completions";
        case "openrouter_chat_completions":
            return "/openrouter/v1/chat/completions";
        case "openai_responses":
            return "/v1/responses";
        case "anthropic_messages":
            return "/v1/messages";
        case "gemini_generate_content":
            return `/v1beta/${geminiModelPath(model)}:generateContent`;
    }
}
function requestBodyForCall(call) {
    const base = cloneJsonRecord(call.task.requestBody);
    if (call.route === "openai_responses") {
        return {
            ...openAiSafeRequestFields(base),
            model: call.selectedModel.model,
            input: `${systemPromptForCall(call)}\n\n${userPromptForCall(call)}`,
        };
    }
    if (call.route === "anthropic_messages") {
        return {
            ...anthropicSafeRequestFields(base),
            model: call.selectedModel.model,
            system: systemPromptForCall(call),
            messages: [{ role: "user", content: userPromptForCall(call) }],
        };
    }
    if (call.route === "gemini_generate_content") {
        return {
            ...geminiSafeRequestFields(base),
            model: call.selectedModel.model,
            systemInstruction: {
                parts: [{ text: systemPromptForCall(call) }],
            },
            contents: [{
                    role: "user",
                    parts: [{ text: userPromptForCall(call) }],
                }],
        };
    }
    if (call.route === "openrouter_chat_completions") {
        return {
            ...openRouterSafeRequestFields(base, call.selectedModel.model),
            model: call.selectedModel.model,
            messages: [
                { role: "system", content: systemPromptForCall(call) },
                { role: "user", content: userPromptForCall(call) },
            ],
        };
    }
    return {
        ...openAiSafeRequestFields(base),
        model: call.selectedModel.model,
        messages: [
            { role: "system", content: systemPromptForCall(call) },
            { role: "user", content: userPromptForCall(call) },
        ],
    };
}
function openAiSafeRequestFields(body) {
    return body;
}
function openRouterSafeRequestFields(body, model) {
    const output = {};
    for (const [key, value] of Object.entries(body)) {
        if (key === "metadata" || key === "provider")
            continue;
        // The pinned Moonshot OpenRouter endpoint rejects temperature when parameter support is fail-closed.
        if (key === "temperature" && model === "moonshotai/kimi-k2.7-code")
            continue;
        output[key] = value;
    }
    return output;
}
function anthropicSafeRequestFields(body) {
    const output = {};
    for (const [key, value] of Object.entries(body)) {
        if (key === "metadata")
            continue;
        if (key === "tools" && Array.isArray(value)) {
            output.tools = value.flatMap(anthropicToolFromSuiteTool);
            output.tool_choice = { type: "auto" };
            continue;
        }
        output[key] = value;
    }
    return output;
}
function anthropicToolFromSuiteTool(value) {
    if (!isRecord(value))
        return [];
    const functionTool = isRecord(value.function) ? value.function : undefined;
    const name = stringValue(value.name) ?? stringValue(functionTool?.name);
    if (!name)
        return [];
    return [{
            name,
            ...(stringValue(value.description) ?? stringValue(functionTool?.description)
                ? { description: stringValue(value.description) ?? stringValue(functionTool?.description) }
                : {}),
            input_schema: isRecord(value.input_schema)
                ? value.input_schema
                : isRecord(functionTool?.parameters)
                    ? functionTool.parameters
                    : { type: "object" },
        }];
}
function geminiSafeRequestFields(body) {
    const output = {};
    for (const [key, value] of Object.entries(body)) {
        if (key === "metadata" || key === "messages")
            continue;
        if (key === "response_format") {
            const generationConfig = geminiGenerationConfigFromResponseFormat(value);
            if (generationConfig) {
                output.generationConfig = {
                    ...(isRecord(output.generationConfig) ? output.generationConfig : {}),
                    ...generationConfig,
                };
            }
            continue;
        }
        if (key === "generationConfig" && isRecord(value)) {
            output.generationConfig = {
                ...(isRecord(output.generationConfig) ? output.generationConfig : {}),
                ...value,
            };
            continue;
        }
        if (key === "max_tokens") {
            output.generationConfig = {
                ...(isRecord(output.generationConfig) ? output.generationConfig : {}),
                maxOutputTokens: value,
            };
            continue;
        }
        if (key === "temperature" || key === "top_p") {
            const generationConfig = isRecord(output.generationConfig) ? output.generationConfig : {};
            output.generationConfig = {
                ...generationConfig,
                [key === "top_p" ? "topP" : key]: value,
            };
            continue;
        }
        if (key === "tools" && Array.isArray(value)) {
            output.tools = geminiToolsFromSuiteTools(value);
            continue;
        }
        output[key] = value;
    }
    return output;
}
function geminiGenerationConfigFromResponseFormat(value) {
    if (!isRecord(value))
        return undefined;
    const type = stringValue(value.type);
    if (type === "json_object")
        return { responseMimeType: "application/json" };
    if (type !== "json_schema")
        return undefined;
    const jsonSchema = isRecord(value.json_schema) ? value.json_schema : undefined;
    const schema = isRecord(jsonSchema?.schema) ? jsonSchema.schema : undefined;
    if (!schema)
        return { responseMimeType: "application/json" };
    return {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
    };
}
function geminiToolsFromSuiteTools(tools) {
    const functionDeclarations = tools.flatMap((tool) => {
        if (!isRecord(tool))
            return [];
        const functionTool = isRecord(tool.function) ? tool.function : undefined;
        const name = stringValue(functionTool?.name) ?? stringValue(tool.name);
        if (!name)
            return [];
        const parameterSource = functionTool ?? tool;
        return [{
                name,
                ...(stringValue(functionTool?.description) ?? stringValue(tool.description)
                    ? { description: stringValue(functionTool?.description) ?? stringValue(tool.description) }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(parameterSource, "parameters")
                    ? { parameters: parameterSource.parameters }
                    : {}),
            }];
    });
    return functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
}
function systemPromptForCall(call) {
    const sharedPrefix = call.task.taskId === "shared_prefix_cache"
        ? "\nShared project context: Governance Gateway records local provider traffic, produces receipts, and never forwards local-only Inferock annotations to upstream providers. This prefix is intentionally stable across related requests."
        : "";
    return [
        "You are executing an Inferock coverage-suite task as normal application traffic.",
        "Answer the user's task directly. Do not mention benchmarking, measurement, or this instruction.",
        sharedPrefix,
    ].filter(Boolean).join("\n");
}
function userPromptForCall(call) {
    return [
        call.task.promptTemplate,
        taskContext(call),
        `Task variation ${call.callIndex + 1} of ${call.plannedCalls}.`,
    ].join("\n\n");
}
function taskContext(call) {
    switch (call.task.taskId) {
        case "json_schema_extract":
            return "Configuration snippet:\nservice: gateway\nowner: platform\nenvironment: dev\nfeatures: receipts, local-proxy";
        case "tool_schema_plan":
            return "Deployment note: billing worker retry metrics were added. Risk is medium until dashboards confirm retry rates stay flat.";
        case "long_stream_review":
            return "Module summary: the local proxy accepts OpenAI-compatible, Anthropic Messages, and Gemini GenerateContent routes, records canonical events, and renders receipts from local JSONL storage.";
        case "shared_prefix_cache":
            return call.callIndex % 2 === 0
                ? "Current implementation question: which local annotations should stay out of provider request bodies?"
                : "Current implementation question: which receipt fields should be scoped by run ID?";
        case "identical_rerun_drift":
            return "Deterministic changelog: first check migrations, second check rollback readiness, third check dashboard metrics.";
        case "known_answer_contract":
            return "Authoritative release record: invoice reconciliation is owned by the Billing Reliability team.";
        case "sdk_retry_idempotent":
            return "Operation note: refresh the receipt index exactly once, expect a successful index update, and verify the latest receipt path.";
        case "concurrency_wave":
            return `Repository maintenance note ${call.callIndex + 1}: update local docs, rerun unit tests, and capture the receipt path.`;
        case "anthropic_message_baseline":
            return "Maintenance ticket: owner is Platform Reliability; due date is 2026-07-10; summarize status for handoff.";
        case "openai_responses_structured":
            return "Issue note: add speed-test consent receipt. Status: in implementation. Next action: verify hash-bound consent.";
        case "automatic_latency_token":
            return "Engineering note: default provider selection now uses configured keys and the pricing registry.";
        case "organic_safety_overlays":
            return "Neutral engineering change log: added run-scoped receipt output and maintained provider-key locality.";
        default:
            return "Normal engineering context for the coverage-suite task.";
    }
}
export function plannedCallsForCoverageSuiteTask(task) {
    const metadata = isRecord(task.requestBody.metadata) ? task.requestBody.metadata : {};
    const waveSize = numberValue(metadata.waveSize);
    if (task.concurrencyGroup && waveSize && waveSize > 0)
        return Math.min(8, Math.floor(waveSize));
    const repeatCount = numberValue(metadata.repeatCount);
    if (task.driftContract && repeatCount && repeatCount > 0)
        return Math.min(5, Math.max(3, Math.floor(repeatCount)));
    return 1;
}
function maxUsageForSamples(samples) {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    const categories = new Map();
    for (const sample of samples) {
        const event = normalizeCanonicalEvent(sample.event);
        input = Math.max(input, event.usage.input);
        output = Math.max(output, event.usage.output);
        cacheRead = Math.max(cacheRead, event.usage.cache?.read ?? 0);
        cacheCreation = Math.max(cacheCreation, event.usage.cache?.creation ?? 0);
        for (const category of event.usage.categories ?? []) {
            const key = [
                category.category,
                category.sourceField ?? "",
                category.provider ?? "",
            ].join("\u001f");
            const existing = categories.get(key);
            if (!existing || category.tokens > existing.tokens) {
                categories.set(key, {
                    category: category.category,
                    tokens: category.tokens,
                    ...(category.sourceField ? { sourceField: category.sourceField } : {}),
                    ...(category.provider ? { provider: category.provider } : {}),
                });
            }
        }
    }
    return {
        input,
        output,
        cacheRead,
        cacheCreation,
        ...(categories.size > 0 ? { categories: [...categories.values()] } : {}),
    };
}
function measuredProviderModels(records) {
    const values = new Set();
    for (const record of records) {
        const event = normalizeCanonicalEvent(record.event);
        values.add(`${event.request.provider}:${event.request.model}`);
    }
    return [...values].sort();
}
function cloneJsonRecord(value) {
    return JSON.parse(JSON.stringify(value));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function uniqueProviders(providers) {
    return [...new Set(providers)];
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
//# sourceMappingURL=runner.js.map