import { join } from "node:path";
import { formatApproxTimeLost } from "@inferock/measure/time-loss";
import { WATERMARK_NAME, WATERMARK_URL } from "./config.js";
import { reconciledApproxTimePartition, reconciledUsdPartition, } from "./display-partition.js";
import { ensurePrivateDir, writePrivateTextFile } from "./private-files.js";
import { formatCoverageStatus, formatUsd, ESTIMATED_RECOVERABLE_LABEL, ESTIMATED_RECOVERABLE_TIME_LABEL, FAILURE_SIGNAL_COUNT_LABEL, PROVIDER_SPEND_OBSERVED_LABEL, isExposureReportRow, moneyLossObservedSpendPercentFromLine, moneyLossObservedSpendLine, renderCoverageSummaryLine, timeValueRateUseLabel, } from "./summary.js";
import { BENCH_RECEIPT_SCHEMA_VERSION, BENCH_RECEIPT_VERSION, } from "./receipt-schema.js";
export const LOCAL_RECEIPT_LOCALITY = {
    providerKeysSentToInferock: false,
    rawReceiptsSentToInferock: false,
};
export function createReceiptBundle(summary) {
    return {
        schemaVersion: BENCH_RECEIPT_SCHEMA_VERSION,
        version: BENCH_RECEIPT_VERSION,
        title: `Money loss ${formatUsd(summary.moneyTotals.standardLossUsd)}; time lost ${formatApproxTimeLost(summary.durationTotals.timeLossMs)}`,
        generatedAt: new Date().toISOString(),
        period: summary.period,
        totals: {
            measuredCalls: summary.measuredCalls,
            failures: summary.failureCount,
            failuresLabel: FAILURE_SIGNAL_COUNT_LABEL,
            providerSpendUsd: summary.providerSpendUsd,
            providerSpendUsdLabel: PROVIDER_SPEND_OBSERVED_LABEL,
            money: summary.moneyTotals,
            duration: summary.durationTotals,
        },
        coverage: summary.coverage,
        exposures: summary.exposures,
        rows: summary.rows,
        measures: summary.measures,
        assumptions: summary.slaAssumptions,
        ...(summary.illustrativeProjection ? { illustrativeProjection: summary.illustrativeProjection } : {}),
        locality: LOCAL_RECEIPT_LOCALITY,
        watermark: {
            name: WATERMARK_NAME,
            url: WATERMARK_URL,
        },
    };
}
export function migrateReceiptBundle(value) {
    if (value.schemaVersion === BENCH_RECEIPT_SCHEMA_VERSION)
        return sanitizeCurrentReceiptBundle(value);
    const totals = value.totals ?? {
        measuredCalls: 0,
        failures: 0,
        standardLossUsd: 0,
        totalLostUsd: 0,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 0,
        unrecognizedUsd: 0,
        providerSpendUsd: 0,
    };
    const rows = (value.rows ?? []).map(migrateLegacyRow);
    const moneyRows = rows.filter((row) => row.primaryValueKind === "money");
    const money = {
        standardLossUsd: roundUsd(sum(moneyRows.map((row) => row.standardLossUsd))),
        providerRecognizedUsd: roundUsd(sum(moneyRows.map((row) => row.providerRecognizedUsd))),
        recognitionGapUsd: roundUsd(sum(moneyRows.map((row) => row.recognitionGapUsd))),
        unrecognizedUsd: roundUsd(sum(moneyRows.map((row) => row.unrecognizedUsd))),
        providerSpendUsd: totals.providerSpendUsd,
    };
    const duration = {
        timeLossMs: sum(rows.map((row) => row.timeLossMs)),
        providerRecognizedTimeLossMs: sum(rows.map((row) => row.providerRecognizedTimeLossMs)),
        recognitionGapTimeMs: sum(rows.map((row) => row.recognitionGapTimeMs)),
        dollarTranslationUsd: roundUsd(sum(rows.map((row) => row.dollarTranslationUsd ?? 0))),
        rate: value.assumptions?.timeValueRate ?? {
            usdPerHour: 0,
            currency: "USD",
            unit: "hour",
            label: "legacy",
            oneLineWhy: "legacy receipt",
            overrideKey: "legacy",
        },
        thresholds: value.assumptions?.activeLatencySegments ?? [],
    };
    return {
        schemaVersion: BENCH_RECEIPT_SCHEMA_VERSION,
        version: BENCH_RECEIPT_VERSION,
        title: value.title ?? "legacy receipt migrated to money and time ledgers",
        generatedAt: value.generatedAt ?? new Date().toISOString(),
        period: value.period ?? { since: null, until: value.generatedAt ?? new Date().toISOString() },
        totals: {
            measuredCalls: totals.measuredCalls,
            failures: totals.failures,
            failuresLabel: FAILURE_SIGNAL_COUNT_LABEL,
            providerSpendUsd: totals.providerSpendUsd,
            providerSpendUsdLabel: PROVIDER_SPEND_OBSERVED_LABEL,
            money,
            duration,
            legacyCombinedStandardLossUsd: totals.standardLossUsd,
        },
        coverage: value.coverage ?? {
            suiteVersion: "",
            methodVersion: "",
            runId: "",
            watchedCount: 0,
            totalSurfaceCount: 0,
            signalCount: 0,
            notOpenableCount: 0,
            surfaces: [],
        },
        exposures: [],
        rows,
        measures: value.measures ?? [],
        assumptions: value.assumptions ?? {
            standardVersion: "legacy",
            timeValueRate: duration.rate,
            activeLatencySegments: [],
            impactFooterLines: [],
        },
        ...(value.illustrativeProjection ? { illustrativeProjection: value.illustrativeProjection } : {}),
        locality: undefined,
        watermark: value.watermark ?? {
            name: WATERMARK_NAME,
            url: WATERMARK_URL,
        },
    };
}
export function renderReceipt(input, compact) {
    const inputSchemaVersion = input.schemaVersion;
    const bundle = migrateReceiptBundle(input);
    const exposures = receiptExposures(bundle);
    const computedObservedSpendLine = inputSchemaVersion === BENCH_RECEIPT_SCHEMA_VERSION
        ? receiptMoneyLossObservedSpendLine(bundle)
        : null;
    const headlineObservedSpendLine = bundle.illustrativeProjection && computedObservedSpendLine
        ? computedObservedSpendLine.replace("observed spend", "example spend")
        : computedObservedSpendLine;
    const observedSpendLine = compact ? headlineObservedSpendLine : null;
    const trafficLine = bundle.illustrativeProjection
        ? `example ${bundle.totals.measuredCalls} calls, ${bundle.totals.failures} findings`
        : `measured ${bundle.totals.measuredCalls} calls, ${bundle.totals.failures} failure signals`;
    const guideLine = bundle.illustrativeProjection
        ? "Guide: example findings are synthetic scenario calls with problems; estimated recoverable is Inferock arithmetic, not a provider admission."
        : "Guide: failure signals are measurement findings; a call can produce more than one signal. Estimated recoverable is Inferock arithmetic from observed events, not a provider admission.";
    const spendLine = bundle.illustrativeProjection
        ? `example provider spend: ${formatReceiptUsd(bundle.totals.providerSpendUsd)}`
        : `${PROVIDER_SPEND_OBSERVED_LABEL}: ${formatReceiptUsd(bundle.totals.providerSpendUsd)}`;
    const moneySplit = receiptMoneySplit(bundle.totals.money);
    const durationSplit = receiptDurationSplit(bundle.totals.duration);
    const lines = [
        receiptHeadline(bundle, headlineObservedSpendLine),
        ...receiptProjectionLines(bundle.illustrativeProjection),
        receiptMoneyRecognitionLine(bundle, observedSpendLine),
        ...exposures.map(renderExposureLine),
        bundle.title,
        `period: ${bundle.period.since ?? "beginning"} to ${bundle.period.until}`,
        trafficLine,
        guideLine,
        `money-native standard loss ${moneySplit.total} | ${ESTIMATED_RECOVERABLE_LABEL} ${moneySplit.parts.providerRecognized} | money recognition gap ${moneySplit.parts.recognitionGap}`,
        `duration loss ${durationSplit.total} | ${ESTIMATED_RECOVERABLE_TIME_LABEL} ${durationSplit.parts.providerRecognized} | time recognition gap ${durationSplit.parts.recognitionGap}`,
        `secondary translation approx ${formatReceiptUsd(bundle.totals.duration.dollarTranslationUsd)} ${timeValueRateUseLabel(bundle.totals.duration.rate)}`,
        spendLine,
        renderCoverageSummaryLine(bundle.coverage),
    ];
    const rows = compact ? bundle.rows.slice(0, 6) : bundle.rows;
    if (rows.length === 0) {
        lines.push("no loss rows");
    }
    else {
        const rowMoneySplits = receiptDisplayedMoneyRowSplits(rows);
        lines.push(`class | evidence | count | primary impact | ${ESTIMATED_RECOVERABLE_LABEL} | recognition gap`);
        for (const [index, row] of rows.entries()) {
            lines.push([
                `${row.code}/${row.failureClass}`,
                row.evidenceGrade,
                String(row.count),
                receiptPrimaryImpact(row, rowMoneySplits[index]),
                receiptProviderRecognized(row, rowMoneySplits[index]),
                receiptRecognitionGap(row, rowMoneySplits[index]),
            ].join(" | "));
            if (row.providerRecognitionLine)
                lines.push(`  ${row.providerRecognitionLine}`);
            if (row.legacyCompatibilityLabel) {
                lines.push(`  compatibility: ${row.legacyCompatibilityLabel}`);
            }
            if (row.primaryValueKind === "time_loss" && row.dollarTranslationUsd !== null) {
                lines.push(`  secondary translation: approx ${formatUsd(row.dollarTranslationUsd)} ${timeValueRateUseLabel(row.rateSnapshot)}`);
            }
            for (const line of row.howComputed) {
                lines.push(`  how computed: ${line}`);
            }
        }
    }
    lines.push("surface | status | count | label");
    for (const surface of bundle.coverage.surfaces) {
        lines.push([
            surface.measure,
            formatCoverageStatus(surface.status),
            String(surface.signalCount),
            surface.label,
        ].join(" | "));
    }
    lines.push(...bundle.assumptions.impactFooterLines);
    lines.push(`${bundle.watermark.name} - ${bundle.watermark.url}`);
    return lines.join("\n");
}
function receiptHeadline(bundle, observedSpendLine) {
    return [
        `priced spend ${formatUsd(bundle.totals.providerSpendUsd)}`,
        `money loss ${receiptMoneyLossHeadlineDisplay(bundle, observedSpendLine)}`,
        `time loss ${formatApproxTimeLost(bundle.totals.duration.timeLossMs)}`,
        `invoice-check exposure ${formatReceiptUsd(invoiceCheckExposureAmount(bundle.exposures))}`,
    ].join(" · ");
}
function receiptProjectionLines(projection) {
    if (!projection)
        return [];
    return [
        projection.label,
        projection.sourceLine,
        projection.precisionLine,
        projection.notMeasuredLine,
        `${projection.basisLinkText} ${projection.basisHref}`,
        `${projection.actualRunsLinkText} ${projection.actualRuns.map((run) => `${run.label}: ${run.href}`).join(" | ")}`,
    ];
}
function receiptMoneyLossHeadlineDisplay(bundle, observedSpendLine) {
    const display = receiptMoneyLossDisplay(bundle);
    const pricingUnknownCount = sum(bundle.rows.map((row) => row.pricingUnknownCount));
    if (pricingUnknownCount > 0 && bundle.totals.money.standardLossUsd === 0)
        return display;
    const percent = moneyLossObservedSpendPercentFromLine(observedSpendLine);
    return percent ? `${display} (${percent})` : display;
}
function receiptMoneyLossDisplay(bundle) {
    const pricingUnknownCount = sum(bundle.rows.map((row) => row.pricingUnknownCount));
    if (pricingUnknownCount > 0 && bundle.totals.money.standardLossUsd === 0)
        return "pricing unknown";
    return formatUsd(bundle.totals.money.standardLossUsd);
}
function receiptMoneyRecognitionLine(bundle, observedSpendLine) {
    const moneySplit = receiptMoneySplit(bundle.totals.money);
    return [
        `${ESTIMATED_RECOVERABLE_LABEL} ${moneySplit.parts.providerRecognized}`,
        `recognition gap ${moneySplit.parts.recognitionGap}`,
        observedSpendLine,
    ].filter(Boolean).join(" · ");
}
function receiptMoneyLossObservedSpendLine(bundle) {
    const pricingUnknownCount = sum(bundle.rows.map((row) => row.pricingUnknownCount));
    if (pricingUnknownCount > 0 && bundle.totals.money.standardLossUsd === 0)
        return null;
    return moneyLossObservedSpendLine({
        standardLossUsd: bundle.totals.money.standardLossUsd,
        providerSpendUsd: bundle.totals.providerSpendUsd,
    }, { suppressRoundedZero: true });
}
function receiptExposures(bundle) {
    return (bundle.exposures ?? []).filter((exposure) => exposure.amount > 0);
}
function invoiceCheckExposureAmount(exposures) {
    return sum((exposures ?? []).filter((exposure) => exposure.amount > 0).map((exposure) => exposure.amount));
}
function renderExposureLine(exposure) {
    const count = `${exposure.count} invoice exposure${exposure.count === 1 ? "" : "s"}`;
    if (exposure.class === "cache_discount_at_risk") {
        return `cache discount at risk — ${exposure.guidance}: ${count}, ${formatReceiptUsd(exposure.amount)}`;
    }
    return `${exposure.class} — ${exposure.guidance}: ${count}, ${formatReceiptUsd(exposure.amount)}`;
}
function sanitizeCurrentReceiptBundle(bundle) {
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
        },
        rows,
    };
}
function hasPositiveExposure(exposures) {
    return (exposures ?? []).some((exposure) => exposure.amount > 0 && exposure.count > 0);
}
function migrateLegacyRow(row) {
    const code = stringValue(row.code) ?? "";
    const failureClass = stringValue(row.failureClass) ?? "";
    const evidenceGrade = stringValue(row.evidenceGrade) ?? "";
    const count = numericValue(row.count) ?? 0;
    const standardLossUsd = numericValue(row.standardLossUsd) ?? 0;
    const providerRecognizedUsd = numericValue(row.providerRecognizedUsd) ?? 0;
    const recognitionGapUsd = numericValue(row.recognitionGapUsd) ??
        numericValue(row.unrecognizedUsd) ??
        Math.max(0, standardLossUsd - providerRecognizedUsd);
    const durationPrimary = failureClass === "latency" || failureClass === "downtime";
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
        timeLossMs: numericValue(row.timeLossMs) ?? 0,
        providerRecognizedTimeLossMs: numericValue(row.providerRecognizedTimeLossMs) ?? 0,
        recognitionGapTimeMs: numericValue(row.recognitionGapTimeMs) ?? 0,
        dollarTranslationUsd: durationPrimary
            ? numericValue(row.dollarTranslationUsd) ?? standardLossUsd
            : null,
        ...(durationPrimary ? { legacyCompatibilityLabel: `legacy dollarized ${failureClass}` } : {}),
        pricingUnknownCount: numericValue(row.pricingUnknownCount) ?? 0,
        howComputed: Array.isArray(row.howComputed)
            ? row.howComputed.filter((line) => typeof line === "string")
            : [],
    };
}
function receiptPrimaryImpact(row, moneySplit) {
    if (row.primaryValueKind === "time_loss") {
        const clock = row.timeLossClockLabel ? ` (${row.timeLossClockLabel})` : "";
        return `${formatApproxTimeLost(row.timeLossMs)}${clock}`;
    }
    return moneySplit?.total ?? formatReceiptUsd(row.standardLossUsd);
}
function receiptProviderRecognized(row, moneySplit) {
    if (row.primaryValueKind === "time_loss") {
        const split = receiptRowTimeSplit(row);
        return `${formatReceiptUsd(row.providerRecognizedUsd)} / ${split.parts.providerRecognized}`;
    }
    return (moneySplit ?? receiptRowMoneySplit(row)).parts.providerRecognized;
}
function receiptRecognitionGap(row, moneySplit) {
    if (row.primaryValueKind === "time_loss")
        return receiptRowTimeSplit(row).parts.recognitionGap;
    return (moneySplit ?? receiptRowMoneySplit(row)).parts.recognitionGap;
}
function receiptMoneySplit(money) {
    return reconciledUsdPartition({
        total: money.standardLossUsd,
        parts: [
            { key: "providerRecognized", value: money.providerRecognizedUsd },
            { key: "recognitionGap", value: money.recognitionGapUsd },
        ],
    });
}
function receiptDurationSplit(duration) {
    return reconciledApproxTimePartition({
        totalMs: duration.timeLossMs,
        parts: [
            { key: "providerRecognized", value: duration.providerRecognizedTimeLossMs },
            { key: "recognitionGap", value: duration.recognitionGapTimeMs },
        ],
    });
}
function receiptRowMoneySplit(row) {
    return reconciledUsdPartition({
        total: row.standardLossUsd,
        parts: [
            { key: "providerRecognized", value: row.providerRecognizedUsd },
            { key: "recognitionGap", value: row.recognitionGapUsd },
        ],
    });
}
function receiptDisplayedMoneyRowSplits(rows) {
    const displays = [];
    const groups = new Map();
    rows.forEach((row, index) => {
        if (row.primaryValueKind === "time_loss")
            return;
        const key = [row.code, row.failureClass].join("\u001f");
        const group = groups.get(key) ?? [];
        group.push({ row, index });
        groups.set(key, group);
    });
    for (const group of groups.values()) {
        const total = sum(group.map((entry) => entry.row.standardLossUsd));
        const partition = reconciledUsdPartition({
            total,
            parts: group.map((entry) => ({ key: String(entry.index), value: entry.row.standardLossUsd })),
        });
        for (const entry of group) {
            const displayValue = partition.values[String(entry.index)] ?? entry.row.standardLossUsd;
            displays[entry.index] = reconciledUsdPartition({
                total: displayValue,
                parts: [
                    { key: "providerRecognized", value: entry.row.providerRecognizedUsd },
                    { key: "recognitionGap", value: entry.row.recognitionGapUsd },
                ],
                fractionDigits: partition.fractionDigits,
            });
        }
    }
    return displays;
}
function receiptRowTimeSplit(row) {
    return reconciledApproxTimePartition({
        totalMs: row.timeLossMs,
        parts: [
            { key: "providerRecognized", value: row.providerRecognizedTimeLossMs },
            { key: "recognitionGap", value: row.recognitionGapTimeMs },
        ],
    });
}
function numericValue(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function stringValue(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function roundUsd(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
function formatReceiptUsd(value) {
    if (value > 0 && value < 0.01)
        return `$${value.toFixed(6)}`;
    return formatUsd(value);
}
export async function writeReceiptBundle(receiptsDir, bundle) {
    await ensurePrivateDir(receiptsDir);
    const filename = `receipt-${bundle.generatedAt.replace(/[:.]/g, "-")}.json`;
    const path = join(receiptsDir, filename);
    await writePrivateTextFile(path, `${JSON.stringify(bundle, null, 2)}\n`);
    return path;
}
//# sourceMappingURL=receipt.js.map