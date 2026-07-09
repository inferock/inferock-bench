import { roundUsd } from "@inferock/measure/pricing";
import { isProviderName } from "../provider.js";
import { coverageSummaryFromSurfaces, } from "../summary.js";
import { SPEEDTEST_RECEIPT_SCHEMA_VERSION } from "../receipt-schema.js";
import { createCoverageEstimateReceipt, } from "./runner.js";
export function createCombinedSpeedTestReceiptBundle(input) {
    if (input.providerReceipts.length === 0) {
        throw new Error("Combined speed-test receipt requires provider receipts.");
    }
    const providerSurfaceScopes = input.providerReceipts.map(providerSurfaceScope);
    const providerReceipts = providerSurfaceScopes.map((scope) => scope.receipt);
    const first = providerReceipts[0];
    const selectedProviders = providerReceipts
        .map((receipt) => receipt.providerScope?.provider ?? receipt.run.providerId ?? receipt.run.selectedModels[0]?.provider)
        .filter(isProviderName);
    const status = combinedStatus(providerReceipts);
    const totals = {
        measuredCalls: sum(providerReceipts.map((receipt) => receipt.totals.measuredCalls)),
        providerSpendUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.providerSpendUsd))),
        money: {
            standardLossUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.standardLossUsd))),
            providerRecognizedUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.providerRecognizedUsd))),
            recognitionGapUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.recognitionGapUsd))),
            unrecognizedUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.unrecognizedUsd))),
            providerSpendUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.providerSpendUsd))),
        },
        duration: {
            ...first.totals.duration,
            timeLossMs: sum(providerReceipts.map((receipt) => receipt.totals.duration.timeLossMs)),
            providerRecognizedTimeLossMs: sum(providerReceipts.map((receipt) => receipt.totals.duration.providerRecognizedTimeLossMs)),
            recognitionGapTimeMs: sum(providerReceipts.map((receipt) => receipt.totals.duration.recognitionGapTimeMs)),
            dollarTranslationUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.duration.dollarTranslationUsd))),
        },
        standardLossUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.standardLossUsd))),
        providerRecognizedUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.providerRecognizedUsd))),
        recognitionGapUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.recognitionGapUsd))),
        unrecognizedUsd: roundUsd(sum(providerReceipts.map((receipt) => receipt.totals.money.unrecognizedUsd))),
        failures: sum(providerReceipts.map((receipt) => receipt.totals.failures)),
    };
    const surfaces = combinedCoverageSurfaces(providerReceipts);
    const trafficMixes = providerReceipts
        .map((receipt) => receipt.trafficMix)
        .filter((mix) => Boolean(mix));
    const trafficMix = trafficMixes.length > 0
        ? {
            organicAgentTasks: sum(trafficMixes.map((mix) => mix.organicAgentTasks)),
            harnessPreconditionTasks: sum(trafficMixes.map((mix) => mix.harnessPreconditionTasks)),
            driftCanaryCalls: sum(trafficMixes.map((mix) => mix.driftCanaryCalls)),
            sdkRetryWorkerCalls: sum(trafficMixes.map((mix) => mix.sdkRetryWorkerCalls)),
        }
        : undefined;
    const acceptedAgentInstallHash = providerReceipts
        .map((receipt) => receipt.consent.acceptedAgentInstallHash)
        .find((hash) => Boolean(hash));
    return {
        ...first,
        schemaVersion: SPEEDTEST_RECEIPT_SCHEMA_VERSION,
        run: {
            ...first.run,
            runId: input.runId,
            status,
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            selectedModels: providerReceipts.flatMap((receipt) => receipt.run.selectedModels),
        },
        consent: {
            ...first.consent,
            estimate: createCoverageEstimateReceipt(input.acceptedEstimate),
            spendCapUsd: input.acceptedEstimate.spendCapUsd,
            ...(acceptedAgentInstallHash ? { acceptedAgentInstallHash } : {}),
        },
        totals,
        coverage: coverageSummaryFromSurfaces({
            ...first.coverage,
            runId: input.runId,
        }, surfaces),
        rows: providerReceipts.flatMap((receipt) => receipt.rows),
        agent: undefined,
        ...(trafficMix ? { trafficMix } : { trafficMix: undefined }),
        providerScope: {
            selectedProviders,
            parallelProviderCount: input.parallelProviderCount,
            localContentionPossible: input.parallelProviderCount > 1,
        },
        providerLedgers: providerSurfaceScopes.map((scope) => ({
            provider: scope.provider,
            estimatedUsd: scope.receipt.consent.estimate.estimatedUsd,
            actualUsd: scope.receipt.totals.providerSpendUsd,
            standardLossUsd: scope.receipt.totals.standardLossUsd,
            providerRecognizedUsd: scope.receipt.totals.providerRecognizedUsd,
            recognitionGapUsd: scope.receipt.totals.recognitionGapUsd,
            durationTimeLossMs: scope.receipt.totals.duration.timeLossMs,
            durationDollarTranslationUsd: scope.receipt.totals.duration.dollarTranslationUsd,
            surfacesWatched: scope.coverage.watchedCount,
            totalSurfaces: scope.coverage.totalSurfaceCount,
        })),
        providerReceipts,
    };
}
function providerSurfaceScope(receipt) {
    const coverage = coverageSummaryFromSurfaces(receipt.coverage, receipt.coverage.surfaces);
    return {
        receipt: {
            ...receipt,
            coverage,
        },
        provider: providerName(receipt.providerScope?.provider ?? receipt.run.providerId ?? receipt.run.selectedModels[0]?.provider),
        coverage,
    };
}
function combinedCoverageSurfaces(receipts) {
    const bySurface = new Map();
    const order = [];
    for (const receipt of receipts) {
        for (const surface of receipt.coverage.surfaces) {
            if (!bySurface.has(surface.surfaceId)) {
                bySurface.set(surface.surfaceId, []);
                order.push(surface.surfaceId);
            }
            bySurface.get(surface.surfaceId)?.push(surface);
        }
    }
    return order.map((surfaceId) => {
        const entries = bySurface.get(surfaceId) ?? [];
        const first = entries[0];
        const signalCount = sum(entries.map((surface) => surface.signalCount));
        if (signalCount > 0) {
            return {
                ...first,
                status: "signal",
                signalCount,
                evidenceGrade: entries.find((surface) => surface.status === "signal")?.evidenceGrade ?? first.evidenceGrade,
                label: `${signalCount} signal${signalCount === 1 ? "" : "s"} emitted across selected providers`,
            };
        }
        if (entries.some((surface) => surface.status === "watched_clean")) {
            return {
                ...first,
                status: "watched_clean",
                signalCount: 0,
                label: "watched-clean across at least one applicable selected provider",
            };
        }
        if (entries.every((surface) => surface.status === "not_applicable")) {
            return {
                ...first,
                status: "not_applicable",
                signalCount: 0,
                label: "not-applicable: no selected provider can open this surface",
            };
        }
        return {
            ...first,
            status: "not_openable",
            signalCount: 0,
            label: "not-openable: no selected provider opened this surface",
        };
    });
}
function combinedStatus(receipts) {
    if (receipts.some((receipt) => receipt.run.status === "failed"))
        return "failed";
    if (receipts.some((receipt) => receipt.run.status === "killed"))
        return "killed";
    if (receipts.every((receipt) => receipt.run.status === "aborted_before_calls"))
        return "aborted_before_calls";
    return "completed";
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function providerName(value) {
    if (isProviderName(value))
        return value;
    throw new Error(`Combined speed-test receipt has unknown provider ${value ?? "missing"}.`);
}
//# sourceMappingURL=provider-scope.js.map