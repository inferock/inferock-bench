import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatApproxTimeLost } from "@inferock/measure/time-loss";
import { WATERMARK_NAME, WATERMARK_URL } from "./config.js";
import {
  formatCoverageStatus,
  formatUsd,
  isExposureReportRow,
  moneyLossObservedSpendLine,
  type ReportRow,
  renderCoverageSummaryLine,
  type BenchSlaAssumptions,
  type BenchSummary,
} from "./summary.js";
import {
  BENCH_RECEIPT_SCHEMA_VERSION,
  BENCH_RECEIPT_VERSION,
  LEGACY_BENCH_RECEIPT_SCHEMA_VERSION,
} from "./receipt-schema.js";

export interface ReceiptLocality {
  readonly providerKeysSentToInferock: false;
  readonly rawReceiptsSentToInferock: false;
}

export const LOCAL_RECEIPT_LOCALITY: ReceiptLocality = {
  providerKeysSentToInferock: false,
  rawReceiptsSentToInferock: false,
};

export interface ReceiptBundle {
  readonly schemaVersion: typeof BENCH_RECEIPT_SCHEMA_VERSION;
  readonly version: typeof BENCH_RECEIPT_VERSION;
  readonly title: string;
  readonly generatedAt: string;
  readonly period: BenchSummary["period"];
  readonly totals: {
    readonly measuredCalls: number;
    readonly failures: number;
    readonly providerSpendUsd: number;
    readonly money: BenchSummary["moneyTotals"];
    readonly duration: BenchSummary["durationTotals"];
    readonly legacyCombinedStandardLossUsd?: number;
  };
  readonly coverage: BenchSummary["coverage"];
  readonly exposures: BenchSummary["exposures"];
  readonly rows: BenchSummary["rows"];
  readonly measures: BenchSummary["measures"];
  readonly assumptions: BenchSlaAssumptions;
  readonly locality?: ReceiptLocality;
  readonly watermark: {
    readonly name: string;
    readonly url: string;
  };
}

interface LegacyReceiptBundleV1 {
  readonly schemaVersion: typeof LEGACY_BENCH_RECEIPT_SCHEMA_VERSION;
  readonly title?: string;
  readonly generatedAt?: string;
  readonly period?: BenchSummary["period"];
  readonly totals?: {
    readonly measuredCalls: number;
    readonly failures: number;
    readonly standardLossUsd: number;
    readonly totalLostUsd: number;
    readonly providerRecognizedUsd: number;
    readonly recognitionGapUsd: number;
    readonly unrecognizedUsd: number;
    readonly providerSpendUsd: number;
  };
  readonly coverage?: BenchSummary["coverage"];
  readonly rows?: readonly Record<string, unknown>[];
  readonly measures?: BenchSummary["measures"];
  readonly assumptions?: BenchSlaAssumptions;
  readonly watermark?: {
    readonly name: string;
    readonly url: string;
  };
}

export function createReceiptBundle(summary: BenchSummary): ReceiptBundle {
  return {
    schemaVersion: BENCH_RECEIPT_SCHEMA_VERSION,
    version: BENCH_RECEIPT_VERSION,
    title:
      `Money loss ${formatUsd(summary.moneyTotals.standardLossUsd)}; time lost ${formatApproxTimeLost(summary.durationTotals.timeLossMs)}`,
    generatedAt: new Date().toISOString(),
    period: summary.period,
    totals: {
      measuredCalls: summary.measuredCalls,
      failures: summary.failureCount,
      providerSpendUsd: summary.providerSpendUsd,
      money: summary.moneyTotals,
      duration: summary.durationTotals,
    },
    coverage: summary.coverage,
    exposures: summary.exposures,
    rows: summary.rows,
    measures: summary.measures,
    assumptions: summary.slaAssumptions,
    locality: LOCAL_RECEIPT_LOCALITY,
    watermark: {
      name: WATERMARK_NAME,
      url: WATERMARK_URL,
    },
  };
}

export function migrateReceiptBundle(value: ReceiptBundle | LegacyReceiptBundleV1): ReceiptBundle {
  if (value.schemaVersion === BENCH_RECEIPT_SCHEMA_VERSION) return sanitizeCurrentReceiptBundle(value);
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
      providerSpendUsd: totals.providerSpendUsd,
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
    locality: undefined,
    watermark: value.watermark ?? {
      name: WATERMARK_NAME,
      url: WATERMARK_URL,
    },
  };
}

export function renderReceipt(input: ReceiptBundle | LegacyReceiptBundleV1, compact: boolean): string {
  const inputSchemaVersion = input.schemaVersion;
  const bundle = migrateReceiptBundle(input);
  const exposures = receiptExposures(bundle);
  const observedSpendLine = compact && inputSchemaVersion === BENCH_RECEIPT_SCHEMA_VERSION
    ? receiptMoneyLossObservedSpendLine(bundle)
    : null;
  const lines = [
    receiptHeadline(bundle),
    receiptMoneyRecognitionLine(bundle, observedSpendLine),
    ...exposures.map(renderExposureLine),
    bundle.title,
    `period: ${bundle.period.since ?? "beginning"} to ${bundle.period.until}`,
    `measured ${bundle.totals.measuredCalls} calls, ${bundle.totals.failures} failures`,
    "Guide: failures observed are calls with problems, loss signals are the rows below, and provider-recognized is what your provider already reported or credited.",
    `money-native standard loss ${formatReceiptUsd(bundle.totals.money.standardLossUsd)} | provider-recognized ${formatReceiptUsd(bundle.totals.money.providerRecognizedUsd)} | money recognition gap ${formatReceiptUsd(bundle.totals.money.recognitionGapUsd)}`,
    `duration loss ${formatApproxTimeLost(bundle.totals.duration.timeLossMs)} | provider-recognized time ${formatApproxTimeLost(bundle.totals.duration.providerRecognizedTimeLossMs)} | time recognition gap ${formatApproxTimeLost(bundle.totals.duration.recognitionGapTimeMs)}`,
    `secondary translation approx ${formatReceiptUsd(bundle.totals.duration.dollarTranslationUsd)} at your rate (edit)`,
    `provider spend observed: ${formatReceiptUsd(bundle.totals.providerSpendUsd)}`,
    renderCoverageSummaryLine(bundle.coverage),
  ];

  const rows = compact ? bundle.rows.slice(0, 6) : bundle.rows;
  if (rows.length === 0) {
    lines.push("no loss rows");
  } else {
    lines.push("class | evidence | count | primary impact | provider-recognized | recognition gap");
    for (const row of rows) {
      lines.push([
        `${row.code}/${row.failureClass}`,
        row.evidenceGrade,
        String(row.count),
        receiptPrimaryImpact(row),
        receiptProviderRecognized(row),
        receiptRecognitionGap(row),
      ].join(" | "));
      if (row.providerRecognitionLine) lines.push(`  ${row.providerRecognitionLine}`);
      if (row.legacyCompatibilityLabel) {
        lines.push(`  compatibility: ${row.legacyCompatibilityLabel}`);
      }
      if (row.primaryValueKind === "time_loss" && row.dollarTranslationUsd !== null) {
        lines.push(`  secondary translation: approx ${formatUsd(row.dollarTranslationUsd)} at your rate (edit)`);
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

function receiptHeadline(bundle: ReceiptBundle): string {
  return [
    `spent ${formatUsd(bundle.totals.providerSpendUsd)}`,
    `money loss ${receiptMoneyLossDisplay(bundle)}`,
    `time loss ${formatApproxTimeLost(bundle.totals.duration.timeLossMs)}`,
  ].join(" · ");
}

function receiptMoneyLossDisplay(bundle: ReceiptBundle): string {
  const pricingUnknownCount = sum(bundle.rows.map((row) => row.pricingUnknownCount));
  if (pricingUnknownCount > 0 && bundle.totals.money.standardLossUsd === 0) return "pricing unknown";
  return formatUsd(bundle.totals.money.standardLossUsd);
}

function receiptMoneyRecognitionLine(bundle: ReceiptBundle, observedSpendLine: string | null): string {
  return [
    `provider-recognized ${formatReceiptUsd(bundle.totals.money.providerRecognizedUsd)}`,
    `recognition gap ${formatReceiptUsd(bundle.totals.money.recognitionGapUsd)}`,
    observedSpendLine,
  ].filter(Boolean).join(" · ");
}

function receiptMoneyLossObservedSpendLine(bundle: ReceiptBundle): string {
  return moneyLossObservedSpendLine({
    standardLossUsd: bundle.totals.money.standardLossUsd,
    providerSpendUsd: bundle.totals.providerSpendUsd,
  }) ?? "money loss = no priced spend measured";
}

function receiptExposures(bundle: ReceiptBundle): BenchSummary["exposures"] {
  return (bundle.exposures ?? []).filter((exposure) => exposure.amount > 0);
}

function renderExposureLine(exposure: BenchSummary["exposures"][number]): string {
  const count = `${exposure.count} invoice exposure${exposure.count === 1 ? "" : "s"}`;
  if (exposure.class === "cache_discount_at_risk") {
    return `cache discount at risk — ${exposure.guidance}: ${count}, ${formatReceiptUsd(exposure.amount)}`;
  }
  return `${exposure.class} — ${exposure.guidance}: ${count}, ${formatReceiptUsd(exposure.amount)}`;
}

function sanitizeCurrentReceiptBundle(bundle: ReceiptBundle): ReceiptBundle {
  if (!hasPositiveExposure(bundle.exposures)) return bundle;
  const rows = bundle.rows.filter((row) => !isExposureReportRow(row));
  if (rows.length === bundle.rows.length) return bundle;
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

function hasPositiveExposure(exposures: BenchSummary["exposures"] | undefined): boolean {
  return (exposures ?? []).some((exposure) => exposure.amount > 0 && exposure.count > 0);
}

function migrateLegacyRow(row: Record<string, unknown>): ReportRow {
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
      ? row.howComputed.filter((line): line is string => typeof line === "string")
      : [],
  };
}

function receiptPrimaryImpact(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") return formatApproxTimeLost(row.timeLossMs);
  return formatUsd(row.standardLossUsd);
}

function receiptProviderRecognized(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") {
    return `${formatUsd(row.providerRecognizedUsd)} / ${formatApproxTimeLost(row.providerRecognizedTimeLossMs)}`;
  }
  return formatUsd(row.providerRecognizedUsd);
}

function receiptRecognitionGap(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") return formatApproxTimeLost(row.recognitionGapTimeMs);
  return formatUsd(row.recognitionGapUsd);
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatReceiptUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return formatUsd(value);
}

export async function writeReceiptBundle(
  receiptsDir: string,
  bundle: ReceiptBundle,
): Promise<string> {
  await mkdir(receiptsDir, { recursive: true });
  const filename = `receipt-${bundle.generatedAt.replace(/[:.]/g, "-")}.json`;
  const path = join(receiptsDir, filename);
  await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return path;
}
