import { join } from "node:path";
import { formatApproxTimeLost } from "@inferock/measure/time-loss";
import {
  LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION,
  SPEEDTEST_RECEIPT_SCHEMA_VERSION,
} from "./receipt-schema.js";
import {
  migrateReceiptBundle,
  type ReceiptBundle,
} from "./receipt.js";
import { migrateSpeedTestReceiptBundle, type SpeedTestReceiptBundle } from "./coverage-suite/runner.js";
import {
  reconciledApproxTimePartition,
  reconciledUsdPartition,
} from "./display-partition.js";
import { ensurePrivateDir, writePrivateTextFile } from "./private-files.js";
import {
  ESTIMATED_RECOVERABLE_LABEL,
  ESTIMATED_RECOVERABLE_TIME_LABEL,
  formatUsd,
  moneyLossObservedSpendLine,
  moneyLossObservedSpendPercentFromLine,
  timeValueRateUseLabel,
  type ReportRow,
} from "./summary.js";

export const SHARE_CARD_FOOTER = "github.com/inferock/inferock-bench";
const DEFAULT_CARD_WIDTH = 68;
const MIN_CARD_WIDTH = 48;
const RESET = "\u001b[0m";
const WARM = "\u001b[38;5;94m";
const STRONG = "\u001b[1m";

export type ShareCardReceipt = ReceiptBundle | SpeedTestReceiptBundle | Record<string, unknown>;

export interface ShareCardModel {
  readonly headline: string;
  readonly receiptLabel: string;
  readonly standardLoss: string;
  readonly providerRecognized: string;
  readonly recognitionGap: string;
  readonly spendShare?: string;
  readonly cacheDiscountExposure?: string;
  readonly timeLoss?: string;
  readonly providerRecognizedTime?: string;
  readonly timeGap?: string;
  readonly timeTranslation?: string;
  readonly measuredCalls: string;
  readonly failures: string;
  readonly keysStayedLocal: boolean;
  readonly coverageLine?: string;
  readonly providerScopeLine?: string;
  readonly topCause: string;
  readonly selectedModels?: readonly string[];
}

interface NormalizedReceipt {
  readonly schemaVersion: string;
  readonly generatedAt?: string;
  readonly period?: {
    readonly since?: string | null;
    readonly until?: string;
  };
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
    readonly startedAt?: string;
    readonly endedAt?: string;
    readonly selectedModels?: readonly { readonly provider?: string; readonly model?: string }[];
  };
  readonly totals?: Record<string, unknown>;
  readonly coverage?: Record<string, unknown>;
  readonly exposures?: readonly Record<string, unknown>[];
  readonly rows?: readonly Record<string, unknown>[];
  readonly locality?: Record<string, unknown>;
  readonly providerScope?: Record<string, unknown>;
}

export function createShareCardModel(receipt: ShareCardReceipt): ShareCardModel {
  const normalized = normalizeReceipt(receipt);
  const totals = recordValue(normalized.totals);
  const money = recordValue(totals?.money);
  const duration = recordValue(totals?.duration);
  const durationRate = recordValue(duration?.rate);
  const providerSpend = numberValue(totals?.providerSpendUsd) ?? numberValue(money?.providerSpendUsd);
  const rawStandardLoss = numberValue(money?.standardLossUsd);
  const standardLoss = billBoundedStandardLoss(rawStandardLoss, providerSpend);
  const providerRecognized = numberValue(money?.providerRecognizedUsd);
  const explicitRecognitionGap = numberValue(money?.recognitionGapUsd);
  const recognitionGap = recognitionGapForBillBoundedStandardLoss({
    rawStandardLoss,
    standardLoss,
    providerRecognized,
    explicitRecognitionGap,
  });
  const moneySplit = standardLoss !== null && providerRecognized !== null && recognitionGap !== null
    ? reconciledUsdPartition({
        total: standardLoss,
        parts: [
          { key: "providerRecognized", value: providerRecognized },
          { key: "recognitionGap", value: recognitionGap },
        ],
      })
    : null;
  const timeLossMs = numberValue(duration?.timeLossMs);
  const providerRecognizedTimeLossMs = numberValue(duration?.providerRecognizedTimeLossMs);
  const explicitTimeGapMs = numberValue(duration?.recognitionGapTimeMs);
  const timeGapMs = explicitTimeGapMs ?? derivedGap(timeLossMs, providerRecognizedTimeLossMs);
  const timeSplit = timeLossMs !== null && providerRecognizedTimeLossMs !== null && timeGapMs !== null
    ? reconciledApproxTimePartition({
        totalMs: timeLossMs,
        parts: [
          { key: "providerRecognized", value: providerRecognizedTimeLossMs },
          { key: "timeGap", value: timeGapMs },
        ],
      })
    : null;
  const dollarTranslation = numberValue(duration?.dollarTranslationUsd);
  const rows = (normalized.rows ?? []).map((row) => row as unknown as ReportRow);
  const cacheDiscountExposure = cacheDiscountExposureTotal(normalized.exposures);
  const invoiceCheckExposure = invoiceCheckExposureTotal(normalized.exposures);
  const pricingUnknownCount = rows.reduce((total, row) => total + (numberValue(row.pricingUnknownCount) ?? 0), 0);
  const measuredCalls = numberValue(totals?.measuredCalls);
  const failures = numberValue(totals?.failures);
  const spendShare = spendShareLine({ standardLoss, providerSpend, pricingUnknownCount });

  return {
    headline: headlineFor({
      standardLoss,
      providerSpend,
      timeLossMs,
      invoiceCheckExposure,
      pricingUnknownCount,
      spendShare,
    }),
    receiptLabel: receiptLabel(normalized),
    standardLoss: standardLossLine(standardLoss, pricingUnknownCount, moneySplit?.total),
    providerRecognized: providerRecognized === null
      ? "estimated recoverable not in receipt"
      : moneySplit?.parts.providerRecognized ?? formatShareUsd(providerRecognized),
    recognitionGap: recognitionGap === null
      ? "gap not in receipt"
      : moneySplit?.parts.recognitionGap ?? formatShareUsd(recognitionGap),
    ...(spendShare ? { spendShare } : {}),
    ...(cacheDiscountExposure !== null
      ? {
          cacheDiscountExposure:
            `cache discount at risk — verify your invoice: ${integer(cacheDiscountExposure.count)} invoice exposure${cacheDiscountExposure.count === 1 ? "" : "s"}, ${formatShareUsd(cacheDiscountExposure.amount)}`,
        }
      : {}),
    ...(timeLossMs && timeLossMs > 0
      ? {
          timeLoss: timeSplit?.total ?? formatApproxTimeLost(timeLossMs),
          providerRecognizedTime: providerRecognizedTimeLossMs === null
            ? "not in receipt"
            : timeSplit?.parts.providerRecognized ?? formatApproxTimeLost(providerRecognizedTimeLossMs),
          timeGap: timeGapMs === null ? "not in receipt" : timeSplit?.parts.timeGap ?? formatApproxTimeLost(timeGapMs),
          ...(dollarTranslation !== null
            ? { timeTranslation: `approx ${formatShareUsd(dollarTranslation)} ${timeValueRateUseLabel(durationRate)}` }
            : {}),
        }
      : {}),
    measuredCalls: measuredCalls === null ? "calls not in receipt" : integer(measuredCalls),
    failures: failures === null ? "failure signals not in receipt" : integer(failures),
    keysStayedLocal: keysStayedLocal(normalized.locality),
    ...(coverageLine(normalized.coverage) ? { coverageLine: coverageLine(normalized.coverage) as string } : {}),
    ...(providerScopeLine(normalized.providerScope)
      ? { providerScopeLine: providerScopeLine(normalized.providerScope) as string }
      : {}),
    topCause: topCause(rows, normalized.rows !== undefined),
    ...(selectedModels(normalized.run?.selectedModels).length > 0
      ? { selectedModels: selectedModels(normalized.run?.selectedModels) }
      : {}),
  };
}

export function renderShareCard(
  model: ShareCardModel,
  options: { readonly color?: boolean; readonly width?: number } = {},
): string {
  const width = Math.max(MIN_CARD_WIDTH, options.width ?? DEFAULT_CARD_WIDTH);
  const innerWidth = width - 4;
  const sections: string[][] = [
    wrapLine(`Inferock Bench receipt${model.receiptLabel ? ` | ${model.receiptLabel}` : ""}`, innerWidth),
    wrapLine(model.headline, innerWidth),
    [
      `standard loss: ${model.standardLoss}`,
      `${ESTIMATED_RECOVERABLE_LABEL}: ${model.providerRecognized}`,
      `recognition gap: ${model.recognitionGap}`,
      ...(model.cacheDiscountExposure ? [model.cacheDiscountExposure] : []),
      ...(model.spendShare ? [model.spendShare] : []),
    ],
    timeLines(model),
    wrapLine(runFacts(model), innerWidth),
    model.providerScopeLine ? wrapLine(model.providerScopeLine, innerWidth) : [],
    model.coverageLine ? wrapLine(model.coverageLine, innerWidth) : [],
    model.selectedModels?.length ? wrapLine(`models: ${model.selectedModels.join(", ")}`, innerWidth) : [],
    wrapLine(`top cause: ${model.topCause}`, innerWidth),
    [SHARE_CARD_FOOTER],
  ].filter((section) => section.length > 0);

  const lines = [
    border(width),
    ...sections.flatMap((section, index) => [
      ...(index === 0 ? [] : [emptyLine(width)]),
      ...section.flatMap((line) => wrapLine(line, innerWidth)).map((line) => cardLine(line, width)),
    ]),
    border(width),
  ];

  if (!options.color) return lines.join("\n");
  return lines.map((line, index) =>
    index === 0 || index === lines.length - 1
      ? `${WARM}${line}${RESET}`
      : line.includes(model.headline)
      ? `${STRONG}${line}${RESET}`
      : line
  ).join("\n");
}

export async function writeShareCard(
  receiptsDir: string,
  receiptGeneratedAt: string,
  rendered: string,
): Promise<string> {
  await ensurePrivateDir(receiptsDir);
  const filename = `share-card-${receiptGeneratedAt.replace(/[:.]/g, "-")}.txt`;
  const path = join(receiptsDir, filename);
  await writeShareCardFile(path, rendered);
  return path;
}

export async function writeShareCardFile(path: string, rendered: string): Promise<string> {
  await writePrivateTextFile(path, `${rendered}\n`, { privateParent: false });
  return path;
}

function normalizeReceipt(receipt: ShareCardReceipt): NormalizedReceipt {
  const schemaVersion = stringValue((receipt as { readonly schemaVersion?: unknown }).schemaVersion);
  if (schemaVersion === "inferock-bench-receipt-v2" || schemaVersion === "inferock-bench-receipt-v1") {
    const normalized = migrateReceiptBundle(receipt as ReceiptBundle) as unknown as NormalizedReceipt;
    if (schemaVersion === "inferock-bench-receipt-v1") {
      const source = receipt as Record<string, unknown>;
      if (!recordValue(source.totals)) delete (normalized as { totals?: unknown }).totals;
      if (!recordValue(source.coverage)) delete (normalized as { coverage?: unknown }).coverage;
      if (!Array.isArray(source.rows)) delete (normalized as { rows?: unknown }).rows;
    }
    return normalized;
  }
  if (
    schemaVersion === SPEEDTEST_RECEIPT_SCHEMA_VERSION ||
    schemaVersion === LEGACY_SPEEDTEST_RECEIPT_SCHEMA_VERSION
  ) {
    const migrated = migrateSpeedTestReceiptBundle(receipt);
    if (migrated) return migrated as unknown as NormalizedReceipt;
  }
  throw new Error("unsupported_receipt_schema");
}

function headlineFor(input: {
  readonly standardLoss: number | null;
  readonly providerSpend: number | null;
  readonly timeLossMs: number | null;
  readonly invoiceCheckExposure: number;
  readonly pricingUnknownCount: number;
  readonly spendShare: string | null;
}): string {
  return [
    `priced spend ${input.providerSpend === null ? "not in receipt" : formatShareUsd(input.providerSpend)}`,
    `money loss ${moneyLossHeadlineValue(input.standardLoss, input.pricingUnknownCount, input.spendShare)}`,
    `time loss ${input.timeLossMs === null ? "not in receipt" : formatApproxTimeLost(input.timeLossMs)}`,
    `invoice-check exposure ${formatShareUsd(input.invoiceCheckExposure)}`,
  ].join(" · ");
}

function moneyLossHeadlineValue(
  standardLoss: number | null,
  pricingUnknownCount: number,
  spendShare: string | null,
): string {
  if (pricingUnknownCount > 0 && (standardLoss ?? 0) === 0) return "pricing unknown";
  if (standardLoss === null) return "not in receipt";
  const formatted = formatShareUsd(standardLoss);
  const percent = moneyLossObservedSpendPercentFromLine(spendShare);
  return percent ? `${formatted} (${percent})` : formatted;
}

function spendShareLine(input: {
  readonly standardLoss: number | null;
  readonly providerSpend: number | null;
  readonly pricingUnknownCount: number;
}): string | null {
  const standardLoss = input.standardLoss ?? 0;
  if (input.pricingUnknownCount > 0 && standardLoss === 0) return null;
  if (standardLoss <= 0) return null;
  return moneyLossObservedSpendLine(
    { standardLossUsd: standardLoss, providerSpendUsd: input.providerSpend },
    { suppressRoundedZero: true },
  );
}

function receiptLabel(receipt: NormalizedReceipt): string {
  if (receipt.run?.status) return `status ${receipt.run.status}`;
  const since = receipt.period?.since;
  const until = receipt.period?.until ?? receipt.generatedAt;
  if (since && until) return `${shortDate(since)} to ${shortDate(until)}`;
  if (until) return `through ${shortDate(until)}`;
  return "";
}

function coverageLine(coverage: unknown): string | null {
  const record = recordValue(coverage);
  if (!record) return null;
  const watched = numberValue(record.watchedCount);
  const total = numberValue(record.totalSurfaceCount);
  if (watched === null || total === null) return null;
  const notOpenable = numberValue(record.notOpenableCount) ?? 0;
  return [
    `surfaces watched ${integer(watched)}/${integer(total)}`,
    ...(notOpenable > 0 ? [`${integer(notOpenable)} not openable`] : []),
  ].join(" | ");
}

function keysStayedLocal(locality: unknown): boolean {
  const record = recordValue(locality);
  return record?.providerKeysSentToInferock === false && record.rawReceiptsSentToInferock === false;
}

function providerScopeLine(providerScope: unknown): string | null {
  const record = recordValue(providerScope);
  if (!record) return null;
  const parallelProviderCount = numberValue(record.parallelProviderCount);
  if (parallelProviderCount === null) return null;
  const contention = booleanValue(record.localContentionPossible) ?? parallelProviderCount > 1;
  return [
    `provider scope ${integer(parallelProviderCount)} parallel`,
    contention ? "local contention possible" : "no local contention",
  ].join(" · ");
}

function topCause(rows: readonly ReportRow[], rowsPresent: boolean): string {
  if (!rowsPresent) return "failure rows not in receipt";
  if (rows.length === 0) return "none in this receipt";
  const selected = [...rows].sort(compareImpact)[0];
  if (!selected) return "none in this receipt";
  const name = selected.failureClass || selected.code;
  return `${name} · ${integer(selected.count)} ${selected.count === 1 ? "signal" : "signals"} · ${primaryImpact(selected)}`;
}

function compareImpact(left: ReportRow, right: ReportRow): number {
  return impactScore(right) - impactScore(left);
}

function impactScore(row: ReportRow): number {
  if (row.primaryValueKind === "time_loss") return row.timeLossMs;
  if (row.standardLossUsd > 0) return row.standardLossUsd;
  return row.pricingUnknownCount > 0 ? 0.000001 : 0;
}

function primaryImpact(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") {
    const clock = row.timeLossClockLabel ? ` (${row.timeLossClockLabel})` : "";
    return `${formatApproxTimeLost(row.timeLossMs)}${clock}`;
  }
  if (row.pricingUnknownCount > 0 && row.standardLossUsd === 0) {
    return "pricing unknown — add model price";
  }
  if (row.pricingUnknownCount > 0) {
    return `${formatShareUsd(row.standardLossUsd)} (+ ${integer(row.pricingUnknownCount)} pricing unknown — add model price)`;
  }
  return formatShareUsd(row.standardLossUsd);
}

function cacheDiscountExposureTotal(
  exposures: readonly Record<string, unknown>[] | undefined,
): { readonly amount: number; readonly count: number } | null {
  if (!exposures) return null;
  const matching = exposures
    .filter((exposure) => stringValue(exposure.class) === "cache_discount_at_risk")
    .map((exposure) => ({
      amount: numberValue(exposure.amount) ?? 0,
      count: numberValue(exposure.count) ?? 0,
    }));
  const amount = matching.reduce((sum, exposure) => sum + exposure.amount, 0);
  const count = matching.reduce((sum, exposure) => sum + exposure.count, 0);
  return amount > 0 && count > 0 ? { amount, count } : null;
}

function invoiceCheckExposureTotal(exposures: readonly Record<string, unknown>[] | undefined): number {
  return (exposures ?? [])
    .map((exposure) => numberValue(exposure.amount) ?? 0)
    .filter((amount) => amount > 0)
    .reduce((sum, amount) => sum + amount, 0);
}

function standardLossLine(
  standardLoss: number | null,
  pricingUnknownCount: number,
  displayedStandardLoss?: string,
): string {
  if (pricingUnknownCount > 0 && (standardLoss ?? 0) === 0) return "pricing unknown - add model price";
  if (standardLoss === null) return "standard loss not in receipt";
  if (pricingUnknownCount > 0) {
    return `${displayedStandardLoss ?? formatShareUsd(standardLoss)} (+${integer(pricingUnknownCount)} unpriced failure signals)`;
  }
  return displayedStandardLoss ?? formatShareUsd(standardLoss);
}

function billBoundedStandardLoss(standardLoss: number | null, providerSpend: number | null): number | null {
  if (standardLoss === null || providerSpend === null) return standardLoss;
  // Public share cards follow the bill-bounded receipt promise even for old stored receipts.
  return Math.min(standardLoss, providerSpend);
}

function recognitionGapForBillBoundedStandardLoss(input: {
  readonly rawStandardLoss: number | null;
  readonly standardLoss: number | null;
  readonly providerRecognized: number | null;
  readonly explicitRecognitionGap: number | null;
}): number | null {
  if (
    input.rawStandardLoss !== null &&
    input.standardLoss !== null &&
    input.standardLoss < input.rawStandardLoss
  ) {
    return derivedGap(input.standardLoss, input.providerRecognized);
  }
  return input.explicitRecognitionGap ?? derivedGap(input.standardLoss, input.providerRecognized);
}

function derivedGap(total: number | null, recognized: number | null): number | null {
  if (total === null || recognized === null) return null;
  const gap = total - recognized;
  return gap < 0 ? null : gap;
}

function formatShareUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return formatUsd(value);
}

function selectedModels(
  models: readonly { readonly provider?: string; readonly model?: string }[] | undefined,
): readonly string[] {
  if (!models) return [];
  return models
    .map((model) => [model.provider, model.model].filter(Boolean).join(":"))
    .filter((model) => model.length > 0)
    .map((model) => middleEllipsis(model, 42));
}

function timeLines(model: ShareCardModel): string[] {
  if (!model.timeLoss) return [];
  return [
    `time lost: ${model.timeLoss}`,
    `${ESTIMATED_RECOVERABLE_TIME_LABEL}: ${model.providerRecognizedTime ?? "not in receipt"}`,
    `time gap: ${model.timeGap ?? "not in receipt"}`,
    ...(model.timeTranslation ? [model.timeTranslation] : []),
  ];
}

function runFacts(model: ShareCardModel): string {
  return [
    `${model.measuredCalls} calls`,
    `${model.failures} failure signals`,
    ...(model.keysStayedLocal ? ["keys stayed local"] : []),
  ].join(" · ");
}

function wrapLine(line: string, width: number): string[] {
  if (charLength(line) <= width) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (charLength(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = charLength(word) <= width ? word : middleEllipsis(word, width);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function cardLine(line: string, width: number): string {
  const innerWidth = width - 4;
  return `| ${padRight(line, innerWidth)} |`;
}

function emptyLine(width: number): string {
  return cardLine("", width);
}

function border(width: number): string {
  return `+${"-".repeat(width - 2)}+`;
}

function padRight(value: string, width: number): string {
  const length = charLength(value);
  if (length >= width) return value;
  return `${value}${" ".repeat(width - length)}`;
}

function middleEllipsis(value: string, width: number): string {
  const chars = [...value];
  if (chars.length <= width) return value;
  if (width <= 1) return chars.slice(0, width).join("");
  const left = Math.max(1, Math.floor((width - 1) / 2));
  const right = Math.max(1, width - 1 - left);
  return `${chars.slice(0, left).join("")}…${chars.slice(chars.length - right).join("")}`;
}

function charLength(value: string): number {
  return [...value].length;
}

function integer(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
