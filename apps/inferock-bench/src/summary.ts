import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeCanonicalEvent,
  type CanonicalEventAny,
  type CanonicalEventNormalized,
} from "@inferock/measure/canonical-event";
import {
  ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
  ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
  buildAnthropicTokenCrossCheckSignal,
  crossCheckAnthropicOutputTokens,
} from "@inferock/measure/anthropic-token-crosscheck";
import {
  identifyDowntimeWindows,
  type DowntimeWindow,
} from "@inferock/measure/availability";
import {
  buildCacheRateAnomalySignal,
  buildDuplicateRequestIdSignal,
  observedChargeUsdForEvent,
} from "@inferock/measure/billing-integrity";
import {
  defaultLatencySloPolicyForEvent,
  recomputeLatencyTimeLoss,
} from "@inferock/measure/latency";
import {
  evaluateDefaultLatency,
  SLA_DEFAULTS,
} from "@inferock/measure/sla-defaults";
import {
  buildLossSignal,
  hasProviderNativeRefusalOrContentFilter,
  refundableCandidateEconomics,
} from "@inferock/measure/signal";
import {
  applyStandardLossEconomicsToSignals,
  estimateCostUsd,
  runStatelessDetectors,
  type LossSignal,
} from "@inferock/measure/stateless";
import { STANDARD_LOSS_METHOD_VERSION } from "@inferock/measure/standard-loss";
import {
  dollarTranslationForTimeLoss,
  formatApproxTimeLost,
} from "@inferock/measure/time-loss";
import { runContentFilterOmittedOutputDetectors } from "@inferock/measure/refusals";
import {
  runFactualityDetectors,
  type FactualitySignal,
} from "@inferock/measure/factuality";
import { runRetryAmplificationDetectors } from "@inferock/measure/retry-amplification";
import {
  runSecurityDetectors,
  type SecuritySignal,
} from "@inferock/measure/security";
import { runStreamTerminationDetectors } from "@inferock/measure/stream-termination";
import type {
  BenchConfig,
  CoverageTestConfig,
  DriftReplayContractConfig,
} from "./config.js";
import {
  DRIFT_CANARY_BASELINE_RUN_COUNT,
  DRIFT_CANARY_ITEM_COUNT,
  DRIFT_CANARY_WORKLOAD_CLASS,
} from "./drift-canary/manifest.js";
import type { StoredBenchEvent } from "./storage.js";

export interface TimeWindow {
  readonly since?: Date;
  readonly until?: Date;
  readonly runId?: string;
  readonly suiteTaskId?: string;
}

export interface BenchSummaryOptions {
  readonly config?: BenchConfig;
  readonly coverageTest?: CoverageTestConfig;
}

export interface ReportPeriod {
  readonly since: string | null;
  readonly until: string;
}

export interface ReportRow {
  readonly code: string;
  readonly failureClass: string;
  readonly evidenceGrade: string;
  readonly count: number;
  readonly primaryValueKind: "money" | "time_loss";
  readonly standardLossUsd: number;
  readonly providerRecognizedUsd: number;
  readonly recognitionGapUsd: number;
  readonly unrecognizedUsd: number;
  readonly timeLossMs: number;
  readonly providerRecognizedTimeLossMs: number;
  readonly recognitionGapTimeMs: number;
  readonly dollarTranslationUsd: number | null;
  readonly thresholdSnapshot?: Record<string, unknown>;
  readonly rateSnapshot?: Record<string, unknown>;
  readonly timeLossTrace?: Record<string, unknown>;
  readonly providerRecognitionLine?: string;
  readonly legacyCompatibilityLabel?: string;
  readonly pricingUnknownCount: number;
  readonly howComputed: readonly string[];
}

export interface BenchExposure {
  readonly class: "cache_discount_at_risk";
  readonly amount: number;
  readonly count: number;
  readonly guidance: "verify your invoice";
}

export type BenchMeasureVerdict = "signal" | "exercised" | "not_exercised";
export type CoverageSurfaceStatus = "watched_clean" | "signal" | "not_openable" | "not_applicable";

export interface CoverageSurfaceRow {
  readonly surfaceId: string;
  readonly measure: string;
  readonly status: CoverageSurfaceStatus;
  readonly signalCount: number;
  readonly evidenceGrade: string;
  readonly label: string;
  readonly taskIds: readonly string[];
  readonly detectorCodes: readonly string[];
  readonly normalUsageRationale: string;
  readonly watchedEvidence?: Record<string, unknown>;
  readonly notOpenableReason?: string;
  readonly details?: Record<string, unknown>;
}

export interface CoverageSummary {
  readonly suiteVersion: string;
  readonly methodVersion: string;
  readonly runId: string;
  readonly watchedCount: number;
  readonly totalSurfaceCount: number;
  readonly signalCount: number;
  readonly notOpenableCount: number;
  readonly notApplicableCount?: number;
  readonly surfaces: readonly CoverageSurfaceRow[];
}

export interface CoverageSurfaceCounts {
  readonly watchedCount: number;
  readonly totalSurfaceCount: number;
  readonly signalCount: number;
  readonly notOpenableCount: number;
  readonly notApplicableCount: number;
}

const SUMMARY_COVERAGE_SURFACE_COUNT = 13;
const PROVIDER_SPECIFIC_COVERAGE_SURFACES = [
  { provider: "anthropic", surfaceId: "anthropic_token_crosscheck" },
  { provider: "openai", surfaceId: "openai_content_filter" },
] as const;

export function providerScopedCoverageTotalSurfaceCount(
  providers: readonly CanonicalEventNormalized["request"]["provider"][],
): number {
  const selected = new Set(providers);
  const notApplicable = PROVIDER_SPECIFIC_COVERAGE_SURFACES.filter((surface) =>
    !selected.has(surface.provider)
  ).length;
  return SUMMARY_COVERAGE_SURFACE_COUNT - notApplicable;
}

export function coverageCountsFromSurfaces(
  surfaces: readonly CoverageSurfaceRow[],
): CoverageSurfaceCounts {
  const notOpenableCount = surfaces.filter((surface) => surface.status === "not_openable").length;
  const notApplicableCount = surfaces.filter((surface) => surface.status === "not_applicable").length;
  const watchedCount = surfaces.filter((surface) =>
    surface.status === "signal" || surface.status === "watched_clean"
  ).length;
  return {
    watchedCount,
    totalSurfaceCount: surfaces.length - notApplicableCount,
    signalCount: sum(surfaces.map((surface) => surface.signalCount)),
    notOpenableCount,
    notApplicableCount,
  };
}

export function coverageSummaryFromSurfaces(
  coverage: CoverageSummary,
  surfaces: readonly CoverageSurfaceRow[],
): CoverageSummary {
  const { notApplicableCount: _oldNotApplicableCount, ...base } = coverage;
  const counts = coverageCountsFromSurfaces(surfaces);
  return {
    ...base,
    watchedCount: counts.watchedCount,
    totalSurfaceCount: counts.totalSurfaceCount,
    signalCount: counts.signalCount,
    notOpenableCount: counts.notOpenableCount,
    ...(counts.notApplicableCount > 0 ? { notApplicableCount: counts.notApplicableCount } : {}),
    surfaces,
  };
}

export interface BenchMeasureRow extends CoverageSurfaceRow {
  readonly rowKey: string;
  readonly verdict: BenchMeasureVerdict;
  readonly count: number;
  readonly signalCodes: readonly string[];
}

export interface BenchLatencySegmentAssumption {
  readonly segmentId: string;
  readonly label: string;
  readonly selectionReason: string;
  readonly thresholdSummary: string;
  readonly oneLineWhy: string;
  readonly overrideKey: string;
}

export interface BenchSlaAssumptions {
  readonly standardVersion: string;
  readonly timeValueRate: {
    readonly usdPerHour: number;
    readonly currency: string;
    readonly unit: string;
    readonly label: string;
    readonly oneLineWhy: string;
    readonly overrideKey: string;
  };
  readonly activeLatencySegments: readonly BenchLatencySegmentAssumption[];
  readonly impactFooterLines: readonly string[];
}

export interface BenchSummary {
  readonly period: ReportPeriod;
  readonly measuredCalls: number;
  readonly failureCount: number;
  readonly providerSpendUsd: number;
  readonly moneyLossObservedSpendLine: string | null;
  readonly moneyTotals: BenchMoneyTotals;
  readonly durationTotals: BenchDurationTotals;
  readonly standardLossUsd: number;
  readonly providerRecognizedUsd: number;
  readonly recognitionGapUsd: number;
  readonly unrecognizedUsd: number;
  readonly totalLostUsd: number;
  readonly pricingUnknownCount: number;
  readonly exposures: readonly BenchExposure[];
  readonly rows: readonly ReportRow[];
  readonly measures: readonly BenchMeasureRow[];
  readonly coverage: CoverageSummary;
  readonly slaAssumptions: BenchSlaAssumptions;
}

export interface BenchMoneyTotals {
  readonly standardLossUsd: number;
  readonly providerRecognizedUsd: number;
  readonly recognitionGapUsd: number;
  readonly unrecognizedUsd: number;
  readonly providerSpendUsd: number;
}

export interface BenchDurationTotals {
  readonly timeLossMs: number;
  readonly providerRecognizedTimeLossMs: number;
  readonly recognitionGapTimeMs: number;
  readonly dollarTranslationUsd: number;
  readonly rate: BenchSlaAssumptions["timeValueRate"];
  readonly thresholds: readonly BenchLatencySegmentAssumption[];
}

export interface BenchWholeCallStandardFloor {
  readonly tenantId: string;
  readonly requestId: string;
  readonly provider: CanonicalEventNormalized["request"]["provider"];
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly signalCode: string;
  readonly standardLossUsd: number;
  readonly standardLossMethod: "call_cost_floor_v1";
  readonly computationTrace?: Record<string, unknown>;
}

interface EventWithSignals {
  readonly event: CanonicalEventNormalized;
  readonly signals: readonly LossSignal[];
}

interface SummarySignalSource {
  readonly events: readonly CanonicalEventNormalized[];
  readonly suiteTaskIds: readonly string[];
  readonly eventsWithSignals: readonly EventWithSignals[];
  readonly signalEntries: readonly SummarySignalEntry[];
  readonly signals: readonly LossSignal[];
}

interface SummarySignalEntry {
  readonly event: CanonicalEventNormalized;
  readonly signal: LossSignal;
}

type CountedFailureSignal = LossSignal & { readonly failureClass: string };
type ChargeObservationMap = ReadonlyMap<string, BenchChargeObservation>;

interface SummaryContext {
  readonly coverageTest?: CoverageTestConfig;
  readonly chargeObservations: ChargeObservationMap;
  readonly chargeObservationConfigured: boolean;
  readonly chargeObservationConfigState: ChargeObservationConfigState;
  readonly chargeObservationConfigError?: string;
  readonly driftReplayContract?: DriftReplayContractConfig;
}

type ChargeObservationConfigState = "absent" | "loaded" | "malformed" | "unreadable";

interface BenchChargeObservation {
  readonly tenantId?: string;
  readonly provider: CanonicalEventNormalized["request"]["provider"];
  readonly requestId: string;
  readonly chargedUsd: number;
  readonly currency?: string;
  readonly source?: string;
  readonly observedAt?: string;
  readonly dashboardEligible?: boolean;
}

const COVERAGE_SUITE_VERSION = "inferock-coverage-suite-v1";
const COVERAGE_METHOD_VERSION = "inferock-bench-coverage-summary-v1";
export const MONEY_LOSS_OBSERVED_SPEND_SMALL_SAMPLE_FLOOR_USD = 1;
const TOOL_CALL_VALIDITY_SIGNAL_CODES = [
  "MALFORMED_TOOL_CALL",
  "TOOL_CALL_SCHEMA_VIOLATION",
  "UNDECLARED_TOOL_CALL",
  "TOOL_CHOICE_VIOLATION",
  "TOOL_CALL_STOP_REASON_MISMATCH",
] as const;

function buildSummaryContext(options: BenchSummaryOptions): SummaryContext {
  const coverageTest = options.coverageTest ?? options.config?.coverageTest;
  const chargeObservationFile = coverageTest?.chargeObservationFile;
  if (!chargeObservationFile) {
    return {
      ...(coverageTest ? { coverageTest } : {}),
      chargeObservations: new Map(),
      chargeObservationConfigured: false,
      chargeObservationConfigState: "absent",
      ...(coverageTest?.driftReplayContract
        ? { driftReplayContract: coverageTest.driftReplayContract }
        : {}),
    };
  }

  const chargeObservationResult = loadChargeObservationFile(chargeObservationFile);
  return {
    ...(coverageTest ? { coverageTest } : {}),
    chargeObservations: chargeObservationResult.observations,
    chargeObservationConfigured: true,
    chargeObservationConfigState: chargeObservationResult.state,
    ...(chargeObservationResult.error ? { chargeObservationConfigError: chargeObservationResult.error } : {}),
    ...(coverageTest.driftReplayContract ? { driftReplayContract: coverageTest.driftReplayContract } : {}),
  };
}

function loadChargeObservationFile(filePath: string): {
  readonly observations: ChargeObservationMap;
  readonly state: Extract<ChargeObservationConfigState, "loaded" | "malformed" | "unreadable">;
  readonly error?: string;
} {
  let raw: string;
  try {
    raw = readFileSync(resolve(filePath), "utf8");
  } catch (error) {
    return {
      observations: new Map(),
      state: "unreadable",
      error: error instanceof Error && error.message ? error.message : "unreadable charge observation file",
    };
  }

  try {
    return {
      observations: chargeObservationMap(parseChargeObservationPayload(raw)),
      state: "loaded",
    };
  } catch (error) {
    return {
      observations: new Map(),
      state: "malformed",
      error: error instanceof Error && error.message ? error.message : "malformed charge observation file",
    };
  }
}

function parseChargeObservationPayload(raw: string): readonly BenchChargeObservation[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseChargeObservationValue(JSON.parse(trimmed) as unknown);
    } catch (error) {
      if (trimmed.startsWith("[") || !trimmed.includes("\n")) {
        throw new Error(`malformed charge observation JSON: ${errorMessage(error)}`, { cause: error });
      }
    }
  }

  const observations: BenchChargeObservation[] = [];
  const lines = trimmed.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`malformed charge observation JSONL at line ${index + 1}: ${errorMessage(error)}`, { cause: error });
    }
    observations.push(...parseChargeObservationValue(parsed));
  }
  return observations;
}

function parseChargeObservationValue(value: unknown): readonly BenchChargeObservation[] {
  if (Array.isArray(value)) return value.flatMap((entry) => parseChargeObservationRecord(entry));
  if (isRecord(value) && Array.isArray(value.observations)) {
    return value.observations.flatMap((entry) => parseChargeObservationRecord(entry));
  }
  return parseChargeObservationRecord(value);
}

function parseChargeObservationRecord(value: unknown): readonly BenchChargeObservation[] {
  if (!isRecord(value)) return [];
  const provider = providerValue(value.provider);
  const requestId = stringValue(value.requestId);
  const chargedUsd = numericValue(value.chargedUsd) ??
    numericValue(value.observedChargeUsd) ??
    numericValue(value.chargeUsd);
  if (
    !provider ||
    !requestId ||
    chargedUsd === null ||
    chargedUsd < 0
  ) {
    return [];
  }

  const tenantId = stringValue(value.tenantId) ?? undefined;
  const currency = stringValue(value.currency) ?? undefined;
  const source = stringValue(value.source) ?? "bench_charge_observation_file";
  const observedAt = stringValue(value.observedAt) ?? undefined;
  const dashboardEligible = typeof value.dashboardEligible === "boolean" ? value.dashboardEligible : undefined;
  return [{
    ...(tenantId ? { tenantId } : {}),
    provider,
    requestId,
    chargedUsd,
    ...(currency ? { currency } : {}),
    source,
    ...(observedAt ? { observedAt } : {}),
    ...(dashboardEligible !== undefined ? { dashboardEligible } : {}),
  }];
}

function chargeObservationMap(observations: readonly BenchChargeObservation[]): ChargeObservationMap {
  const map = new Map<string, BenchChargeObservation>();
  for (const observation of observations) {
    map.set(chargeObservationKey(observation), observation);
  }
  return map;
}

function cacheObservedChargeForEvent(
  event: CanonicalEventNormalized,
  context: SummaryContext,
): BenchChargeObservation | number | null {
  if (context.chargeObservationConfigState === "malformed" ||
    context.chargeObservationConfigState === "unreadable") {
    return null;
  }

  const exact = context.chargeObservations.get(chargeObservationKey({
    tenantId: event.request.tenantId,
    provider: event.request.provider,
    requestId: event.request.requestId,
  }));
  if (exact) return exact;

  const wildcard = context.chargeObservations.get(chargeObservationKey({
    provider: event.request.provider,
    requestId: event.request.requestId,
  }));
  if (wildcard) return wildcard;

  if (context.chargeObservationConfigured) return null;

  const observedChargeUsd = observedChargeUsdForEvent(event);
  return observedChargeUsd === null ? null : observedChargeUsd;
}

function chargeObservationKey(input: {
  readonly tenantId?: string;
  readonly provider: CanonicalEventNormalized["request"]["provider"];
  readonly requestId: string;
}): string {
  return `${input.tenantId ?? "*"}:${input.provider}:${input.requestId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown parse error";
}

export function summarizeBenchEvents(
  records: readonly StoredBenchEvent[],
  window: TimeWindow = {},
  options: BenchSummaryOptions = {},
): BenchSummary {
  const summaryContext = buildSummaryContext(options);
  const signalSource = summarySignalSource(records, window, summaryContext);
  const events = signalSource.events;
  const signals = signalSource.signals;
  const failureSignals = signals.filter(isCountedFailureSignal);
  const downtimeWindows = identifyDowntimeWindows(events);
  const allRows = reportRows(failureSignals, downtimeWindows);
  const exposures = exposureTotalsForRows(allRows);
  const rows = standardReportRows(allRows);
  const moneyRows = rows.filter(isBillBoundedMoneyNativeRow);
  const providerRecognizedUsd = roundUsd(sum(moneyRows.map((row) => row.providerRecognizedUsd)));
  const standardLossUsd = roundUsd(sum(moneyRows.map((row) => row.standardLossUsd)));
  const recognitionGapUsd = roundUsd(sum(moneyRows.map((row) => row.recognitionGapUsd)));
  const totalLostUsd = roundUsd(providerRecognizedUsd + recognitionGapUsd);
  const slaAssumptions = buildSlaAssumptions(events, rows);
  const providerSpendUsd = observedProviderSpendUsd(events, summaryContext);
  const moneyTotals: BenchMoneyTotals = {
    standardLossUsd,
    providerRecognizedUsd,
    recognitionGapUsd,
    unrecognizedUsd: recognitionGapUsd,
    providerSpendUsd,
  };
  const durationTotals: BenchDurationTotals = {
    timeLossMs: sum(rows.map((row) => row.timeLossMs)),
    providerRecognizedTimeLossMs: sum(rows.map((row) => row.providerRecognizedTimeLossMs)),
    recognitionGapTimeMs: sum(rows.map((row) => row.recognitionGapTimeMs)),
    dollarTranslationUsd: roundUsd(sum(rows.map((row) => row.dollarTranslationUsd ?? 0))),
    rate: slaAssumptions.timeValueRate,
    thresholds: slaAssumptions.activeLatencySegments,
  };
  const measures = measureRows(events, signals, summaryContext, signalSource.suiteTaskIds);
  const coverage = coverageSummary(measures, window.runId);
  const pricingUnknownCount = signals.filter((signal) =>
    signal.code === "PRICING_UNKNOWN" || signal.standardLossStatus === "pricing_unknown"
  ).length;
  const moneyLossSpendLine = pricingUnknownCount > 0 && moneyTotals.standardLossUsd === 0
    ? null
    : moneyLossObservedSpendLine({
        standardLossUsd: moneyTotals.standardLossUsd,
        providerSpendUsd: moneyTotals.providerSpendUsd,
      }, { suppressRoundedZero: true });

  return {
    period: {
      since: window.since ? window.since.toISOString() : null,
      until: (window.until ?? new Date()).toISOString(),
    },
    measuredCalls: events.length,
    failureCount: failureSignals.length,
    providerSpendUsd: moneyTotals.providerSpendUsd,
    moneyLossObservedSpendLine: moneyLossSpendLine,
    moneyTotals,
    durationTotals,
    standardLossUsd,
    providerRecognizedUsd,
    recognitionGapUsd,
    unrecognizedUsd: recognitionGapUsd,
    totalLostUsd,
    pricingUnknownCount,
    exposures,
    rows,
    measures,
    coverage,
    slaAssumptions,
  };
}

export function renderLiveCounter(summary: BenchSummary): string {
  const failures = summary.failureCount === 1 ? "1 failure" : `${summary.failureCount} failures`;
  const lines = [
    `money loss so far: ${formatUsd(summary.moneyTotals.standardLossUsd)}`,
    `time lost so far: ${formatApproxTimeLost(summary.durationTotals.timeLossMs)}`,
    `measured ${summary.measuredCalls} calls, ${failures}`,
    `money recognition gap ${formatUsd(summary.moneyTotals.recognitionGapUsd)}`,
    `time recognition gap ${formatApproxTimeLost(summary.durationTotals.recognitionGapTimeMs)}`,
    renderCoverageSummaryLine(summary.coverage),
  ].join(" | ");
  if (!hasLatencyLoss(summary)) return lines;
  return [
    lines,
    ...latencyAssumptionScreenfulLines(summary),
  ].join("\n");
}

export function firstWholeCallStandardFloorForEvent(
  event: CanonicalEventNormalized,
  options: BenchSummaryOptions = {},
): BenchWholeCallStandardFloor | null {
  const summaryContext = buildSummaryContext(options);
  const signal = eventLossSignals(event, summaryContext).find(isWholeCallStandardFloorSignal);
  return signal ? wholeCallStandardFloorFromSignal(signal, event) : null;
}

export function wholeCallStandardFloorsForBenchEvents(
  records: readonly StoredBenchEvent[],
  window: TimeWindow = {},
  options: BenchSummaryOptions = {},
): ReadonlyMap<string, BenchWholeCallStandardFloor> {
  const summaryContext = buildSummaryContext(options);
  const signalSource = summarySignalSource(records, window, summaryContext);
  const floors = new Map<string, BenchWholeCallStandardFloor>();
  for (const entry of signalSource.signalEntries) {
    const { signal } = entry;
    if (!isWholeCallStandardFloorSignal(signal)) continue;
    const key = wholeCallStandardFloorKeyForEvent(entry.event);
    if (!floors.has(key)) {
      floors.set(key, wholeCallStandardFloorFromSignal(signal, entry.event));
    }
  }
  return floors;
}

export function wholeCallStandardFloorKey(input: {
  readonly tenantId: string;
  readonly provider: CanonicalEventNormalized["request"]["provider"];
  readonly requestId: string;
  readonly startedAt: string;
  readonly endedAt: string;
}): string {
  return [
    input.tenantId,
    input.provider,
    input.requestId,
    input.startedAt,
    input.endedAt,
  ].join("\u001f");
}

function isWholeCallStandardFloorSignal(signal: LossSignal): boolean {
  return signal.standardLossStatus === "computed" &&
    signal.standardLossMethod === "call_cost_floor_v1" &&
    standardLossUsdForSignal(signal) > 0;
}

function wholeCallStandardFloorFromSignal(
  signal: LossSignal,
  event: CanonicalEventNormalized,
): BenchWholeCallStandardFloor {
  return {
    tenantId: signal.tenantId,
    requestId: signal.requestId,
    provider: signal.provider,
    model: signal.model,
    startedAt: event.timing.startedAt,
    endedAt: event.timing.endedAt,
    signalCode: signal.code,
    standardLossUsd: standardLossUsdForSignal(signal),
    standardLossMethod: "call_cost_floor_v1",
    ...(isRecord(signal.computationTrace) ? { computationTrace: signal.computationTrace } : {}),
  };
}

export function renderReport(summary: BenchSummary): string {
  const lines = [
    renderLiveCounter(summary),
    `provider spend observed: ${formatUsd(summary.providerSpendUsd)}`,
    renderCoverageSummaryLine(summary.coverage),
    ...renderExposureLines(summary.exposures),
  ];
  if (summary.rows.length === 0) {
    lines.push(`No loss rows. measured ${summary.measuredCalls} calls, 0 failures.`);
    lines.push(...renderMeasureLines(summary));
    return lines.join("\n");
  }

  lines.push("class | evidence | count | primary impact | provider-recognized | recognition gap");
  for (const row of summary.rows) {
    lines.push([
      `${row.code}/${row.failureClass}`,
      row.evidenceGrade,
      String(row.count),
      primaryImpactDisplay(row),
      providerRecognizedDisplay(row),
      recognitionGapDisplay(row),
    ].join(" | "));
    for (const line of row.howComputed) {
      lines.push(`  how computed: ${line}`);
    }
  }
  lines.push(...renderMeasureLines(summary));
  lines.push(...summary.slaAssumptions.impactFooterLines);
  return lines.join("\n");
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export interface MoneyLossObservedSpendLineInput {
  readonly standardLossUsd: number | null;
  readonly providerSpendUsd: number | null;
}

export interface MoneyLossObservedSpendLineOptions {
  readonly suppressRoundedZero?: boolean;
}

export function moneyLossObservedSpendLine(
  input: MoneyLossObservedSpendLineInput,
  options: MoneyLossObservedSpendLineOptions = {},
): string | null {
  const standardLossUsd = nonnegativeNumberOrNull(input.standardLossUsd);
  const providerSpendUsd = nonnegativeNumberOrNull(input.providerSpendUsd);
  if (standardLossUsd === null || providerSpendUsd === null) return null;
  if (providerSpendUsd <= 0) return "money loss = no priced spend measured";

  const percent = standardLossUsd / providerSpendUsd * 100;
  if (!Number.isFinite(percent) || percent > 100) return null;

  const formatted = percent.toFixed(1);
  if (options.suppressRoundedZero && formatted === "0.0" && standardLossUsd > 0) return null;

  const annotation = providerSpendUsd < MONEY_LOSS_OBSERVED_SPEND_SMALL_SAMPLE_FLOOR_USD
    ? ` (small sample: ${formatMeasuredSpendUsd(providerSpendUsd)} measured)`
    : "";
  return `money loss = ${formatted}% of observed spend${annotation}`;
}

export function moneyLossObservedSpendPercentFromLine(line: string | null): string | null {
  const match = line?.match(/^money loss = ([0-9]+(?:\.[0-9])?)% of observed spend(?:\s|$)/u);
  return match?.[1] ? `${match[1]}%` : null;
}

function nonnegativeNumberOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatMeasuredSpendUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return formatUsd(value);
}

export function repriceLatencyRow(
  row: ReportRow,
  options: {
    readonly threshold?: {
      readonly acceptableStartMs: number;
      readonly acceptableMsPerOutputToken: number;
    };
    readonly rateUsdPerHour?: number;
  },
): ReportRow {
  if (!isRepriceableLatencyRow(row)) return row;
  const threshold = row.thresholdSnapshot ?? {};
  const rate = row.rateSnapshot ?? {};
  const observedMs = numericValue(threshold.observedMs) ?? 0;
  const outputTokens = numericValue(threshold.outputTokens) ?? 0;
  const acceptableStartMs = options.threshold?.acceptableStartMs ??
    numericValue(threshold.acceptableStartMs) ??
    0;
  const acceptableMsPerOutputToken = options.threshold?.acceptableMsPerOutputToken ??
    numericValue(threshold.acceptableMsPerOutputToken) ??
    0;
  const rateUsdPerHour = options.rateUsdPerHour ??
    numericValue(rate.usdPerHour) ??
    SLA_DEFAULTS.timeValueRate.usdPerHour;
  const repriced = recomputeLatencyTimeLoss({
    observedMs,
    outputTokens,
    acceptableStartMs,
    acceptableMsPerOutputToken,
    rateUsdPerHour,
  });
  const providerRecognizedTimeLossMs = 0;
  const recognitionGapTimeMs = Math.max(0, repriced.timeLossMs - providerRecognizedTimeLossMs);
  return {
    ...row,
    timeLossMs: repriced.timeLossMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs,
    dollarTranslationUsd: repriced.dollarTranslationUsd,
    thresholdSnapshot: {
      ...threshold,
      acceptableStartMs,
      acceptableMsPerOutputToken,
      acceptableMs: repriced.acceptableTotalMs,
      observedMs,
      outputTokens,
    },
    rateSnapshot: {
      ...rate,
      usdPerHour: rateUsdPerHour,
    },
    timeLossTrace: {
      ...(row.timeLossTrace ?? {}),
      inputs: {
        ...(recordValue(row.timeLossTrace?.inputs) ?? {}),
        observedTotalMs: observedMs,
        outputTokens,
        acceptableStartMs,
        acceptableMsPerOutputToken,
        rateUsdPerHour,
      },
      outputs: {
        ...(recordValue(row.timeLossTrace?.outputs) ?? {}),
        timeLossMs: repriced.timeLossMs,
        providerRecognizedTimeLossMs,
        recognitionGapTimeMs,
        dollarTranslationUsd: repriced.dollarTranslationUsd,
      },
    },
  };
}

function isRepriceableLatencyRow(row: ReportRow): boolean {
  return row.primaryValueKind === "time_loss" && (
    row.failureClass === "latency" ||
    row.failureClass === "latency_threshold" ||
    row.code === "LATENCY_BILLED" ||
    row.code === "LATENCY_SLOW_RESPONSE"
  );
}

function primaryImpactDisplay(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") {
    const translation = row.dollarTranslationUsd === null
      ? ""
      : ` (approx ${formatUsd(row.dollarTranslationUsd)} at your rate)`;
    return `${formatApproxTimeLost(row.timeLossMs)}${translation}`;
  }
  if (row.pricingUnknownCount > 0 && row.standardLossUsd === 0) {
    return "pricing unknown — add model price";
  }
  if (row.pricingUnknownCount > 0) {
    return `${formatUsd(row.standardLossUsd)} (+ ${row.pricingUnknownCount} pricing unknown — add model price)`;
  }
  return formatUsd(row.standardLossUsd);
}

function providerRecognizedDisplay(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") {
    return `${formatUsd(row.providerRecognizedUsd)} / ${formatApproxTimeLost(row.providerRecognizedTimeLossMs)}`;
  }
  return formatUsd(row.providerRecognizedUsd);
}

function recognitionGapDisplay(row: ReportRow): string {
  if (row.primaryValueKind === "time_loss") {
    return formatApproxTimeLost(row.recognitionGapTimeMs);
  }
  return formatUsd(row.recognitionGapUsd);
}

function renderExposureLines(exposures: readonly BenchExposure[]): readonly string[] {
  return exposures
    .filter((exposure) => exposure.amount > 0 && exposure.count > 0)
    .map((exposure) => {
      const count = `${exposure.count} invoice exposure${exposure.count === 1 ? "" : "s"}`;
      if (exposure.class === "cache_discount_at_risk") {
        return `cache discount at risk — ${exposure.guidance}: ${count}, ${formatExposureUsd(exposure.amount)}`;
      }
      return `${exposure.class} — ${exposure.guidance}: ${count}, ${formatExposureUsd(exposure.amount)}`;
    });
}

function formatExposureUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return formatUsd(value);
}

function reportRows(
  signals: readonly CountedFailureSignal[],
  downtimeWindows: readonly DowntimeWindow[] = [],
): ReportRow[] {
  const rows = new Map<string, ReportRow & { readonly howComputedSet: ReadonlySet<string> }>();
  for (const signal of signals) {
    const key = `${signal.code}\u0000${signal.failureClass}\u0000${signal.evidenceGrade}`;
    const existing = rows.get(key);
    const primaryValueKind = primaryValueKindForSignal(signal);
    const providerRecognized = providerRecognizedUsdForSignal(signal);
    const standardLossUsd = standardLossUsdForSignal(signal);
    const unrecognized = recognitionGapUsdForSignal(signal, standardLossUsd, providerRecognized);
    const timeLoss = timeLossForSignal(signal);
    const dollarTranslation = dollarTranslationForSignal(signal, timeLoss.timeLossMs);
    const howComputed = computationTraceLine(signal);
    const howComputedSet = new Set(existing?.howComputedSet ?? []);
    if (howComputed) howComputedSet.add(howComputed);
    for (const line of sanitizationDeltaLines(signal)) howComputedSet.add(line);
    const thresholdSnapshot = thresholdSnapshotForSignal(signal);
    const rateSnapshot = rateSnapshotForSignal(signal);
    const timeLossTrace = timeLossTraceForSignal(signal);
    rows.set(key, {
      code: signal.code,
      failureClass: signal.failureClass,
      evidenceGrade: signal.evidenceGrade,
      count: (existing?.count ?? 0) + 1,
      primaryValueKind,
      standardLossUsd: roundUsd((existing?.standardLossUsd ?? 0) + standardLossUsd),
      providerRecognizedUsd: roundUsd((existing?.providerRecognizedUsd ?? 0) + providerRecognized),
      recognitionGapUsd: roundUsd((existing?.recognitionGapUsd ?? 0) + unrecognized),
      unrecognizedUsd: roundUsd((existing?.unrecognizedUsd ?? 0) + unrecognized),
      timeLossMs: (existing?.timeLossMs ?? 0) + timeLoss.timeLossMs,
      providerRecognizedTimeLossMs: (existing?.providerRecognizedTimeLossMs ?? 0) +
        timeLoss.providerRecognizedTimeLossMs,
      recognitionGapTimeMs: (existing?.recognitionGapTimeMs ?? 0) + timeLoss.recognitionGapTimeMs,
      dollarTranslationUsd: nullableRoundUsd(
        (existing?.dollarTranslationUsd ?? 0) + (dollarTranslation ?? 0),
        existing?.dollarTranslationUsd !== undefined || dollarTranslation !== null,
      ),
      ...(thresholdSnapshot ?? existing?.thresholdSnapshot
        ? { thresholdSnapshot: thresholdSnapshot ?? existing?.thresholdSnapshot }
        : {}),
      ...(rateSnapshot ?? existing?.rateSnapshot
        ? { rateSnapshot: rateSnapshot ?? existing?.rateSnapshot }
        : {}),
      ...(timeLossTrace ?? existing?.timeLossTrace
        ? { timeLossTrace: mergeTimeLossTrace(existing?.timeLossTrace, timeLossTrace) }
        : {}),
      ...(providerRecognitionLineForSignal(signal)
        ? { providerRecognitionLine: providerRecognitionLineForSignal(signal) as string }
        : existing?.providerRecognitionLine
          ? { providerRecognitionLine: existing.providerRecognitionLine }
          : {}),
      pricingUnknownCount: (existing?.pricingUnknownCount ?? 0) +
        (signal.standardLossStatus === "pricing_unknown" ? 1 : 0),
      howComputed: [...howComputedSet],
      howComputedSet,
    });
  }
  applyDowntimeWindowsToRows(rows, downtimeWindows);
  return [...rows.values()].map(toReportRow).sort(compareRows);
}

function toReportRow(row: ReportRow & { readonly howComputedSet: ReadonlySet<string> }): ReportRow {
  return {
    code: row.code,
    failureClass: row.failureClass,
    evidenceGrade: row.evidenceGrade,
    count: row.count,
    primaryValueKind: row.primaryValueKind,
    standardLossUsd: row.standardLossUsd,
    providerRecognizedUsd: row.providerRecognizedUsd,
    recognitionGapUsd: row.recognitionGapUsd,
    unrecognizedUsd: row.unrecognizedUsd,
    timeLossMs: row.timeLossMs,
    providerRecognizedTimeLossMs: row.providerRecognizedTimeLossMs,
    recognitionGapTimeMs: row.recognitionGapTimeMs,
    dollarTranslationUsd: row.dollarTranslationUsd,
    ...(row.thresholdSnapshot ? { thresholdSnapshot: row.thresholdSnapshot } : {}),
    ...(row.rateSnapshot ? { rateSnapshot: row.rateSnapshot } : {}),
    ...(row.timeLossTrace ? { timeLossTrace: row.timeLossTrace } : {}),
    ...(row.providerRecognitionLine ? { providerRecognitionLine: row.providerRecognitionLine } : {}),
    ...(row.legacyCompatibilityLabel ? { legacyCompatibilityLabel: row.legacyCompatibilityLabel } : {}),
    pricingUnknownCount: row.pricingUnknownCount,
    howComputed: row.howComputed,
  };
}

function isCountedFailureSignal(signal: LossSignal): signal is CountedFailureSignal {
  return signal.severity === "loss" && signal.failureClass !== null;
}

function withinWindow(event: CanonicalEventAny, window: TimeWindow): boolean {
  const normalized = normalizeCanonicalEvent(event);
  const startedAt = new Date(normalized.timing.startedAt).getTime();
  if (window.since && startedAt < window.since.getTime()) return false;
  if (window.until && startedAt > window.until.getTime()) return false;
  return true;
}

function withinStoredRecordScope(record: StoredBenchEvent, window: TimeWindow): boolean {
  if (window.runId && record.runId !== window.runId) return false;
  if (window.suiteTaskId && record.suiteTaskId !== window.suiteTaskId) return false;
  return true;
}

function compareRows(left: ReportRow, right: ReportRow): number {
  const leftTotal = left.primaryValueKind === "time_loss" ? left.timeLossMs : left.standardLossUsd;
  const rightTotal = right.primaryValueKind === "time_loss" ? right.timeLossMs : right.standardLossUsd;
  if (leftTotal !== rightTotal) return rightTotal - leftTotal;
  return left.code.localeCompare(right.code);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function nullableRoundUsd(value: number, hasValue: boolean): number | null {
  return hasValue ? roundUsd(value) : null;
}

function primaryValueKindForSignal(signal: LossSignal): ReportRow["primaryValueKind"] {
  if (signal.valueJson?.timeLossPrimary === true) return "time_loss";
  if (signal.failureClass === "latency") return "time_loss";
  if (
    signal.failureClass === "downtime" &&
    signal.valueJson?.timeLossKind === "downtime_unavailable_window"
  ) return "time_loss";
  return "money";
}

function isBillBoundedMoneyNativeRow(row: ReportRow): boolean {
  return row.primaryValueKind === "money" &&
    row.failureClass !== "latency" &&
    !isExposureReportRow(row);
}

export function isExposureReportRow(row: Pick<ReportRow, "code" | "failureClass">): boolean {
  return row.code === "CACHE_DISCOUNT_AT_RISK" ||
    row.failureClass === "cache_discount_at_risk";
}

function standardReportRows(rows: readonly ReportRow[]): ReportRow[] {
  return rows.filter((row) => !isExposureReportRow(row));
}

function exposureTotalsForRows(rows: readonly ReportRow[]): readonly BenchExposure[] {
  const cacheRows = rows.filter(isExposureReportRow);
  const amount = roundUsd(sum(cacheRows.map((row) => row.standardLossUsd)));
  const count = sum(cacheRows.map((row) => row.count));
  if (amount <= 0 || count <= 0) return [];
  return [{
    class: "cache_discount_at_risk",
    amount,
    count,
    guidance: "verify your invoice",
  }];
}

function observedProviderSpendUsd(
  events: readonly CanonicalEventNormalized[],
  context: SummaryContext,
): number {
  return roundUsd(sum(events.map((event) => providerSpendUsdForEvent(event, context))));
}

function providerSpendUsdForEvent(
  event: CanonicalEventNormalized,
  context: SummaryContext,
): number {
  const observedCharge = cacheObservedChargeForEvent(event, context);
  if (typeof observedCharge === "number") return observedCharge;
  if (observedCharge) return observedCharge.chargedUsd;
  return estimateCostUsd(event);
}

function timeLossForSignal(signal: LossSignal): {
  readonly timeLossMs: number;
  readonly providerRecognizedTimeLossMs: number;
  readonly recognitionGapTimeMs: number;
} {
  if (primaryValueKindForSignal(signal) !== "time_loss") {
    return {
      timeLossMs: 0,
      providerRecognizedTimeLossMs: 0,
      recognitionGapTimeMs: 0,
    };
  }
  const timeLossMs = numericValue(signal.valueJson?.timeLossMs) ??
    numericValue(signal.valueJson?.excessMs) ??
    numericValue(signal.valueJson?.excessWaitMs) ??
    numericValue(traceOutput(signal, "timeLossMs")) ??
    0;
  const providerRecognizedTimeLossMs = numericValue(signal.valueJson?.providerRecognizedTimeLossMs) ??
    numericValue(traceOutput(signal, "providerRecognizedTimeLossMs")) ??
    0;
  const recognitionGapTimeMs = numericValue(signal.valueJson?.recognitionGapTimeMs) ??
    numericValue(traceOutput(signal, "recognitionGapTimeMs")) ??
    Math.max(0, timeLossMs - providerRecognizedTimeLossMs);
  return {
    timeLossMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs,
  };
}

function dollarTranslationForSignal(
  signal: LossSignal,
  timeLossMs: number,
): number | null {
  if (primaryValueKindForSignal(signal) !== "time_loss") return null;
  return numericValue(signal.valueJson?.dollarTranslationUsd) ??
    numericValue(traceOutput(signal, "dollarTranslationUsd")) ??
    (signal.failureClass === "latency" ? standardLossUsdForSignal(signal) : null) ??
    (timeLossMs > 0
      ? dollarTranslationForTimeLoss(timeLossMs, SLA_DEFAULTS.timeValueRate.usdPerHour)
      : null);
}

function thresholdSnapshotForSignal(signal: LossSignal): Record<string, unknown> | undefined {
  if (signal.failureClass !== "latency") return undefined;
  const trace = timeLossTraceForSignal(signal);
  const inputs = recordValue(trace?.inputs);
  return {
    thresholdProposalId: signal.valueJson?.thresholdProposalId ?? inputs?.thresholdProposalId ?? null,
    thresholdSourceLabel: signal.valueJson?.thresholdSourceLabel ??
      "The Inferock Standard default threshold proposal",
    thresholdConfirmed: signal.valueJson?.thresholdConfirmed ?? false,
    acceptableStartMs: signal.valueJson?.acceptableStartMs ??
      inputs?.acceptableStartMs ??
      recordValue(signal.evidence.latencyThresholds)?.acceptableStartMs ??
      null,
    acceptableMsPerOutputToken: signal.valueJson?.acceptableMsPerOutputToken ??
      inputs?.acceptableMsPerOutputToken ??
      recordValue(signal.evidence.latencyThresholds)?.acceptableMsPerOutputToken ??
      null,
    acceptableMs: signal.valueJson?.acceptableMs ?? inputs?.acceptableTotalMs ?? null,
    observedMs: signal.valueJson?.observedMs ?? inputs?.observedTotalMs ?? null,
    outputTokens: inputs?.outputTokens ?? null,
    effectiveFrom: signal.valueJson?.thresholdEffectiveFrom ?? null,
    effectiveTo: signal.valueJson?.thresholdEffectiveTo ?? null,
  };
}

function rateSnapshotForSignal(signal: LossSignal): Record<string, unknown> | undefined {
  if (primaryValueKindForSignal(signal) !== "time_loss") return undefined;
  return {
    rateId: signal.valueJson?.dollarTranslationRateId ?? "inferock-default-time-value-rate",
    usdPerHour: signal.valueJson?.dollarTranslationRateUsdPerHour ??
      SLA_DEFAULTS.timeValueRate.usdPerHour,
    confirmed: signal.valueJson?.dollarTranslationConfirmed ?? false,
    sourceLabel: SLA_DEFAULTS.timeValueRate.label,
  };
}

function timeLossTraceForSignal(signal: LossSignal): Record<string, unknown> | undefined {
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
  return recordValue(signal.valueJson?.timeLossTrace) ??
    recordValue(signal.evidence.timeLossTrace) ??
    recordValue(trace?.timeLossTrace) ??
    undefined;
}

function mergeTimeLossTrace(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return existing ?? next;
}

function providerRecognitionLineForSignal(signal: LossSignal): string | null {
  const explicit = stringValue(signal.valueJson?.providerRecognitionLine) ??
    stringValue(signal.evidence.providerRecognitionLine);
  if (explicit) return explicit;
  if (signal.failureClass === "latency") {
    return latencyProviderRecognitionLine(signal);
  }
  if (signal.failureClass === "downtime") {
    return "Provider-recognized: $0 / 0s - first-party credit terms unverified";
  }
  return null;
}

function latencyProviderRecognitionLine(signal: LossSignal): string {
  const serviceTier = stringValue(signal.valueJson?.serviceTier) ??
    stringValue(signal.evidence.serviceTier) ??
    stringValue(signal.evidence.creditBasis);
  const sloSource = stringValue(signal.valueJson?.sloSource) ?? stringValue(signal.evidence.sloSource);
  const standardTier = serviceTier === "default" ||
    serviceTier === "standard" ||
    serviceTier === "auto";
  if (
    signal.provider === "openai" ||
    signal.provider === "anthropic"
  ) {
    if (standardTier && (!sloSource || sloSource.startsWith("inferock-standard://"))) {
      return "Provider-recognized: $0 / 0s without a first-party latency SLA";
    }
    return "Provider-recognized: no configured provider latency credit basis for this receipt";
  }
  return "Provider-recognized: no configured provider latency credit basis for this receipt";
}

function applyDowntimeWindowsToRows(
  rows: Map<string, ReportRow & { readonly howComputedSet: ReadonlySet<string> }>,
  downtimeWindows: readonly DowntimeWindow[],
): void {
  if (downtimeWindows.length === 0) return;
  const key = "PROVIDER_DOWNTIME\u0000downtime\u0000downtime_window";
  const existing = rows.get(key);
  const unionedWindows = unionDowntimeWindowsByProviderTenant(downtimeWindows);
  const timeLossMs = sum(unionedWindows.map((window) => window.durationMs));
  const providerRecognizedTimeLossMs = 0;
  const recognitionGapTimeMs = timeLossMs;
  const howComputedSet = new Set(existing?.howComputedSet ?? []);
  howComputedSet.add(
    `downtime window floor ${formatApproxTimeLost(timeLossMs)} from clustered provider-owned failures; envelope stored separately`,
  );
  const thresholdSnapshot = downtimeThresholdSnapshot(downtimeWindows);
  rows.set(key, {
    code: "PROVIDER_DOWNTIME",
    failureClass: "downtime",
    evidenceGrade: downtimeWindowRowEvidenceGrade(downtimeWindows),
    count: downtimeWindows.length,
    primaryValueKind: "time_loss",
    standardLossUsd: 0,
    providerRecognizedUsd: 0,
    recognitionGapUsd: 0,
    unrecognizedUsd: 0,
    timeLossMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs,
    dollarTranslationUsd: dollarTranslationForTimeLoss(
      timeLossMs,
      SLA_DEFAULTS.timeValueRate.usdPerHour,
    ),
    thresholdSnapshot,
    providerRecognitionLine: downtimeProviderRecognitionLine(downtimeWindows),
    rateSnapshot: {
      rateId: "inferock-default-time-value-rate",
      usdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
      confirmed: false,
      sourceLabel: SLA_DEFAULTS.timeValueRate.label,
    },
    timeLossTrace: {
      methodId: "downtime_window_v1",
      methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
      standardVersion: SLA_DEFAULTS.standardVersion,
      formula: "union_duration(clustered provider-owned unavailable windows)",
      windows: downtimeWindows,
      unionWindows: unionedWindows,
      outputs: {
        timeLossMs,
        providerRecognizedTimeLossMs,
        recognitionGapTimeMs,
      },
    },
    pricingUnknownCount: 0,
    howComputed: [...howComputedSet],
    howComputedSet,
  });
}

function unionDowntimeWindowsByProviderTenant(
  windows: readonly DowntimeWindow[],
): readonly {
  readonly tenantId: string;
  readonly provider: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly durationMs: number;
}[] {
  const groups = new Map<string, { tenantId: string; provider: string; startMs: number; endMs: number }[]>();
  for (const window of windows) {
    const startMs = Date.parse(window.windowStart);
    const endMs = Date.parse(window.windowEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const key = `${window.tenantId}\u0000${window.provider}`;
    groups.set(key, [
      ...(groups.get(key) ?? []),
      {
        tenantId: window.tenantId,
        provider: window.provider,
        startMs,
        endMs: Math.max(startMs, endMs),
      },
    ]);
  }

  const unioned: {
    tenantId: string;
    provider: string;
    startMs: number;
    endMs: number;
  }[] = [];
  for (const intervals of groups.values()) {
    const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs);
    for (const interval of sorted) {
      const previous = unioned.at(-1);
      if (
        !previous ||
        previous.tenantId !== interval.tenantId ||
        previous.provider !== interval.provider ||
        interval.startMs > previous.endMs
      ) {
        unioned.push({ ...interval });
      } else {
        previous.endMs = Math.max(previous.endMs, interval.endMs);
      }
    }
  }

  return unioned.map((window) => ({
    tenantId: window.tenantId,
    provider: window.provider,
    windowStart: new Date(window.startMs).toISOString(),
    windowEnd: new Date(window.endMs).toISOString(),
    durationMs: Math.max(0, window.endMs - window.startMs),
  }));
}

function downtimeThresholdSnapshot(windows: readonly DowntimeWindow[]): Record<string, unknown> {
  const first = windows[0];
  return {
    thresholdProposalId: "inferock-downtime-window-v1",
    thresholdSourceLabel: first?.thresholdSourceLabel ??
      "Inferock default >5% over 5 minutes, aligned with Gemini's published downtime definition; standard-defined, not credit proof",
    thresholdConfirmed: false,
    rollingWindowMs: 300_000,
    minimumProviderOwnedFailureOperations: 2,
    threshold: first?.threshold ?? 0.05,
    thresholdSource: first?.thresholdSource ?? "inferock-default-provider-fault-rate-gemini-aligned",
    thresholdSourceRefs: first?.thresholdSourceRefs ?? [],
    creditTermsVerified: windows.some((window) => window.creditTermsVerified),
    windows: windows.map((window) => ({
      provider: window.provider,
      tenantId: window.tenantId,
      threshold: window.threshold,
      thresholdSource: window.thresholdSource,
      thresholdSourceLabel: window.thresholdSourceLabel,
      providerFaultRate: window.providerFaultRate,
    })),
  };
}

function downtimeWindowRowEvidenceGrade(windows: readonly DowntimeWindow[]): string {
  if (windows.some((window) => window.evidenceGrade === "claim_grade_provider_sla")) {
    return "claim_grade_provider_sla";
  }
  if (windows.some((window) => window.evidenceGrade === "status_corroborated_observed")) {
    return "status_corroborated_observed";
  }
  if (windows.some((window) => window.evidenceGrade === "organic_strong")) {
    return "organic_strong";
  }
  return "organic_sparse";
}

function downtimeProviderRecognitionLine(windows: readonly DowntimeWindow[]): string {
  if (windows.some((window) => window.creditTermsVerified)) {
    return "Credit path: service credit may be capped at eligible spend under verified cloud SLA provenance";
  }
  return "Provider-recognized: $0 / 0s - first-party credit terms unverified";
}

function summarySignalSource(
  records: readonly StoredBenchEvent[],
  window: TimeWindow,
  context: SummaryContext,
): SummarySignalSource {
  const scopedRecords = records
    .filter((record) => withinStoredRecordScope(record, window))
    .filter((record) => withinWindow(record.event, window));
  const events = scopedRecords.map((record) => normalizeCanonicalEvent(record.event));
  const suiteTaskIds = scopedRecords.flatMap((record) => record.suiteTaskId ? [record.suiteTaskId] : []);
  const eventsWithSignals = events.map((event): EventWithSignals => ({
    event,
    signals: eventLossSignals(event, context),
  }));
  const eventEntries = eventsWithSignals.flatMap((entry) =>
    entry.signals.map((signal): SummarySignalEntry => ({ event: entry.event, signal }))
  );
  const groupEntries = groupDerivedLossSignalEntries(events);
  const signalEntries = applyCrossSourceWholeCallFloorSupersession([
    ...eventEntries,
    ...groupEntries,
  ]);
  return {
    events,
    suiteTaskIds,
    eventsWithSignals,
    signalEntries,
    signals: signalEntries.map((entry) => entry.signal),
  };
}

function applyCrossSourceWholeCallFloorSupersession(
  entries: readonly SummarySignalEntry[],
): SummarySignalEntry[] {
  const floorWinnerByCall = new Map<string, LossSignal>();
  return entries.map((entry): SummarySignalEntry => {
    const { signal } = entry;
    if (!isWholeCallStandardFloorSignal(signal)) return entry;

    const key = wholeCallStandardFloorKeyForEvent(entry.event);
    const winner = floorWinnerByCall.get(key);
    if (!winner) {
      floorWinnerByCall.set(key, signal);
      return entry;
    }

    return {
      ...entry,
      signal: supersededWholeCallFloorSignal(signal, winner),
    };
  });
}

function wholeCallStandardFloorKeyForEvent(event: CanonicalEventNormalized): string {
  return wholeCallStandardFloorKey({
    tenantId: event.request.tenantId,
    provider: event.request.provider,
    requestId: event.request.requestId,
    startedAt: event.timing.startedAt,
    endedAt: event.timing.endedAt,
  });
}

function supersededWholeCallFloorSignal(signal: LossSignal, winner: LossSignal): LossSignal {
  const priorTrace = isRecord(signal.computationTrace) ? signal.computationTrace : {};
  return {
    ...signal,
    standardLossUsd: 0,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: 0,
    standardLossStatus: "computed",
    standardLossMethod: "call_cost_floor_superseded_v1",
    standardLossGrade: signal.standardLossGrade ?? signal.evidenceGrade,
    computationTrace: {
      ...priorTrace,
      method: "call_cost_floor_superseded_v1",
      methodId: "call_cost_floor_superseded_v1",
      methodVersion: STANDARD_LOSS_METHOD_VERSION,
      standardVersion: SLA_DEFAULTS.standardVersion,
      confidence: "floor_attributed_to_peer_signal",
      inputs: {
        ...(isRecord(priorTrace.inputs) ? priorTrace.inputs : {}),
        floorAttributedToSignalCode: winner.code,
        floorAttributedToStandardLossMethod: winner.standardLossMethod ?? null,
        floorSupersessionReason: "one_call_cost_floor_per_call",
        supersededSignalCode: signal.code,
      },
      formulas: {
        standardLossUsd: "0 for this signal because this call's floor is attributed to one peer signal",
        recognitionGapUsd: "0 for this signal; see peer call_cost_floor_v1 trace",
      },
      outputs: {
        standardLossUsd: 0,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0,
      },
      oneLine: "call-cost floor already attributed once for this call",
    },
  };
}

function eventLossSignals(event: CanonicalEventNormalized, context: SummaryContext): LossSignal[] {
  const signals = [
    ...runStatelessDetectors(event, {
      latencySloPolicy: defaultLatencySloPolicyForEvent(event),
    }),
    ...optionalSignal(detectBenchJsonModeBrokenOutput(event)),
    ...optionalSignal(detectBenchAnthropicTokenCrosscheck(event)),
    ...optionalSignal(detectBenchCacheRateAnomaly(event, context)),
    ...runSecurityDetectors(event).flatMap((signal) => optionalSignal(securityLossSignal(event, signal))),
    ...benchFactualitySignals(event).map((signal) => factualityLossSignal(event, signal)),
  ];
  return applyStandardLossEconomicsToSignals(event, dedupeSignals(signals));
}

function detectBenchJsonModeBrokenOutput(event: CanonicalEventNormalized): LossSignal | null {
  if (!jsonModeRequested(event)) return null;
  if (event.meta.outputSchemaVersion) return null;
  if (hasProviderNativeRefusalOrContentFilter(event)) return null;
  if (event.response.content.trim().length === 0) return null;
  if (parseJson(event.response.content)) return null;

  const economics = refundableCandidateEconomics(event);
  const schemaSanitization = geminiSchemaSanitizationForEvent(event);
  return buildLossSignal({
    code: "BROKEN_OUTPUT",
    detector: "broken-output",
    event,
    failureClass: "broken_output",
    ...economics,
    evidence: {
      reason: "json_mode_invalid_json",
      outputContract: "must_be_parseable_json",
      defaultPolicy: SLA_DEFAULTS.measureDefaultPolicies.brokenOutputJsonMode,
      ...(schemaSanitization ? { schemaSanitization } : {}),
    },
  });
}

function detectBenchAnthropicTokenCrosscheck(event: CanonicalEventNormalized): LossSignal | null {
  if (event.request.provider !== "anthropic") return null;
  const crossCheck = crossCheckAnthropicOutputTokens(event, {
    fallbackReason: "bench_default_count_tokens_unavailable",
  });
  const signal = buildAnthropicTokenCrossCheckSignal(event, crossCheck);
  if (!signal) return null;
  return signal;
}

function detectBenchCacheRateAnomaly(
  event: CanonicalEventNormalized,
  context: SummaryContext,
): LossSignal | null {
  const observedCharge = cacheObservedChargeForEvent(event, context);
  if (observedCharge === null) return null;
  return buildCacheRateAnomalySignal(event, observedCharge);
}

function factualityLossSignal(
  event: CanonicalEventNormalized,
  signal: FactualitySignal,
): LossSignal {
  return buildLossSignal({
    code: signal.code,
    detector: signal.detectorName,
    detectorVersion: signal.detectorVersion,
    event,
    domain: "factuality",
    failureClass: "factuality_contradiction",
    status: "triage_only",
    evidenceGrade: "triage_only",
    dispute: false,
    liabilityParty: "unknown",
    creditCandidate: false,
    valueKind: "money",
    recoverableBasis: "whole_call",
    providerRecoverableLossUsd: 0,
    valueJson: signal.valueJson,
    evidence: signal.evidence,
  });
}

function securityLossSignal(
  event: CanonicalEventNormalized,
  signal: SecuritySignal,
): LossSignal | null {
  if (!isRealLossSecuritySignal(signal)) return null;
  return buildLossSignal({
    code: signal.code,
    detector: signal.detectorName,
    detectorVersion: signal.detectorVersion,
    event,
    domain: "security",
    failureClass: "security_secret_leak",
    status: "triage_only",
    evidenceGrade: "triage_only",
    dispute: false,
    liabilityParty: "unknown",
    creditCandidate: false,
    valueKind: "money",
    recoverableBasis: "whole_call",
    providerRecoverableLossUsd: 0,
    valueJson: signal.valueJson,
    evidence: signal.evidence,
  });
}

function isRealLossSecuritySignal(signal: SecuritySignal): boolean {
  if (signal.code !== "SECURITY_SECRET_EXACT_MATCH") return false;
  const attribution = recordValue(signal.valueJson.attribution) ?? recordValue(signal.evidence.attribution);
  return attribution?.result !== "carried_in_request_context";
}

function groupDerivedLossSignalEntries(events: readonly CanonicalEventNormalized[]): SummarySignalEntry[] {
  return [
    ...duplicateRequestIdSignalEntries(events),
  ];
}

function duplicateRequestIdSignalEntries(events: readonly CanonicalEventNormalized[]): SummarySignalEntry[] {
  const groups = new Map<string, CanonicalEventNormalized[]>();
  for (const event of events) {
    const key = [
      event.request.tenantId,
      event.request.provider,
      event.request.requestId,
    ].join("\u001f");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const entries: SummarySignalEntry[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) =>
      new Date(left.timing.startedAt).getTime() - new Date(right.timing.startedAt).getTime()
    );
    const [original] = sorted;
    for (const [index, duplicate] of sorted.slice(1).entries()) {
      const signals = applyStandardLossEconomicsToSignals(duplicate, [buildDuplicateRequestIdSignal(duplicate, {
        originalEventTime: original?.timing.startedAt,
        duplicateEventTime: duplicate.timing.startedAt,
        duplicateRank: index + 2,
        duplicateCount: sorted.length,
      })]);
      entries.push(...signals.map((signal): SummarySignalEntry => ({ event: duplicate, signal })));
    }
  }
  return entries;
}

function measureRows(
  events: readonly CanonicalEventNormalized[],
  signals: readonly LossSignal[],
  context: SummaryContext,
  suiteTaskIds: readonly string[],
): BenchMeasureRow[] {
  const securitySignals = events.flatMap((event) => runSecurityDetectors(event));
  const contentFilterSignals = events.flatMap((event) => runContentFilterOmittedOutputDetectors(event));
  const streamSignals = events.flatMap((event) => runStreamTerminationDetectors(event));
  const retrySignals = events.flatMap((event) => runRetryAmplificationDetectors(event));
  const factualitySignals = signals.filter((signal) =>
    signal.code === "FACTUALITY_KNOWN_ANSWER_FAIL" ||
    signal.code === "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT"
  );
  const driftOpenability = driftRegressionOpenability(events, context);
  return [
    signalBackedMeasureRow({
      rowKey: "broken_output",
      measure: "Broken output: bad JSON/schema",
      signals,
      signalCodes: ["BROKEN_OUTPUT"],
      openability: jsonSchemaOpenability(events),
      cleanLabel: "watched-clean: JSON/schema contract completed with no finding",
      normalUsageRationale: "Schema or JSON mode was requested by normal task traffic.",
    }),
    signalBackedMeasureRow({
      rowKey: "anthropic_token_crosscheck",
      measure: "Anthropic output-token recount",
      signals,
      signalCodes: ["ANTHROPIC_TOKEN_CROSSCHECK"],
      openability: anthropicCrosscheckOpenability(events),
      cleanLabel: "watched-clean: Anthropic output-token traffic cross-checked with no finding",
      normalUsageRationale: "Anthropic output-token traffic is present for calibrated recount or gross-bound fallback cross-checking.",
      details: {
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        evidenceGradeCap: "B",
        caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
      },
    }),
    signalBackedMeasureRow({
      rowKey: "duplicate_request_id",
      measure: "Duplicate request-ID events",
      signals,
      signalCodes: ["DUPLICATE_REQUEST_ID"],
      openability: duplicateRequestIdOpenability(events),
      cleanLabel: "watched-clean: operation/idempotency evidence observed with no duplicate group",
      normalUsageRationale: "Normal traffic carried operation or idempotency evidence.",
    }),
    latencyMeasureRow(events, signals),
    toolCallValidityMeasureRow(events, signals),
    signalBackedMeasureRow({
      rowKey: "security_governance",
      measure: "Security/governance overlay",
      signals: securityMeasureSignals(securitySignals, signals),
      signalCodes: ["SECURITY_SECRET_EXACT_MATCH", "SECURITY_PROVIDER_SAFETY_FIELD"],
      openability: securityOpenability(events, suiteTaskIds),
      cleanLabel: "watched-clean: passive security inspection completed with no provider safety/security evidence",
      normalUsageRationale: "Normal traffic carried passive security-inspection evidence.",
    }),
    overlayCoverageMeasureRow({
      rowKey: "openai_content_filter",
      measure: "Content-filter overlay",
      count: contentFilterSignals.length,
      signalCodes: ["OPENAI_CONTENT_FILTER_OMITTED_OUTPUT"],
      openability: contentFilterOpenability(events),
      cleanLabel: "watched-clean: OpenAI traffic inspected with no content-filter evidence",
      normalUsageRationale: "Normal OpenAI completion traffic was passively inspected.",
    }),
    overlayCoverageMeasureRow({
      rowKey: "stream_termination_evidence",
      measure: "Stream-termination overlay",
      count: streamSignals.length,
      signalCodes: [
        "STREAM_UNCONFIRMED_TERMINATION",
        "STREAM_CLIENT_ABORTED",
        "OPENAI_STREAM_MISSING_DONE_MARKER",
        "ANTHROPIC_STREAM_ERROR_EVENT",
        "GEMINI_STREAM_ERROR_EVENT",
        "STREAM_TERMINAL_STATUS_GAP",
      ],
      openability: streamTerminationOpenability(events),
      cleanLabel: "watched-clean: stream timing carried terminal evidence with no stream anomaly",
      normalUsageRationale: "Normal streaming traffic carried terminal timing evidence.",
    }),
    overlayCoverageMeasureRow({
      rowKey: "retry_amplification",
      measure: "Retry amplification",
      count: retrySignals.length,
      signalCodes: ["RETRY_AMPLIFICATION_IN_CALL", "RETRY_AMPLIFICATION_CHAIN"],
      openability: retryAmplificationOpenability(events),
      cleanLabel: "watched-clean: SDK retry surface observed with no retry amplification evidence",
      normalUsageRationale: "Normal traffic carried SDK/native retry-observation evidence.",
    }),
    signalBackedMeasureRow({
      rowKey: "served_model_mismatch",
      measure: "Served model mismatch",
      signals,
      signalCodes: ["SERVED_MODEL_MISMATCH"],
      openability: servedModelOpenability(events),
      cleanLabel: "watched-clean: served-model identity evidence present with no mismatch",
      normalUsageRationale: "Normal traffic naturally carries requested and served model identity.",
    }),
    signalBackedMeasureRow({
      rowKey: "cache_integrity",
      measure: "Cache integrity",
      signals,
      signalCodes: ["CACHE_RATE_ANOMALY", "CACHE_DISCOUNT_AT_RISK"],
      openability: cacheIntegrityOpenability(events, context, suiteTaskIds),
      cleanLabel: "watched-clean: cache usage reconciled with no overcharge anomaly or discount-at-risk signal",
      normalUsageRationale: "Normal traffic carried cache-token usage, pricing evidence, and optional provider charge observation.",
    }),
    staticCoverageMeasureRow({
      rowKey: "drift_regression",
      measure: "Drift / regression",
      signalCodes: [],
      openability: driftOpenability,
      cleanLabel: driftRegressionCleanLabel(driftOpenability),
      cleanEvidenceGrade: "triage_only",
      normalUsageRationale: "Normal known-answer canary or replay traffic carried drift provenance.",
      details: driftOpenability.openable ? driftRegressionMethodDetails(driftOpenability) : undefined,
    }),
    signalBackedMeasureRow({
      rowKey: "factuality",
      measure: "Factuality overlay",
      signals: factualitySignals,
      signalCodes: [
        "FACTUALITY_KNOWN_ANSWER_FAIL",
        "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT",
      ],
      openability: factualityOpenability(events),
      cleanLabel: "watched-clean: factuality contract or citation-support evidence checked with no contradiction",
      normalUsageRationale: "Normal traffic carried a captured known-answer contract or provider citation-support evidence.",
    }),
  ];
}

interface SurfaceOpenability {
  readonly openable: boolean;
  readonly applicable?: boolean;
  readonly reason?: string;
  readonly watchedEvidence?: Record<string, unknown>;
}

interface SignalLike {
  readonly code: string;
  readonly evidenceGrade: string;
  readonly tenantId?: string;
  readonly requestId?: string;
  readonly provider?: string;
  readonly evidence?: Record<string, unknown>;
}

function signalBackedMeasureRow(input: {
  readonly rowKey: string;
  readonly measure: string;
  readonly signals: readonly SignalLike[];
  readonly signalCodes: readonly string[];
  readonly openability: SurfaceOpenability;
  readonly cleanLabel: string;
  readonly normalUsageRationale: string;
  readonly details?: Record<string, unknown>;
}): BenchMeasureRow {
  const matching = input.signals.filter((signal) => input.signalCodes.includes(signal.code));
  return coverageMeasureRow({
    rowKey: input.rowKey,
    measure: input.measure,
    signalCodes: input.signalCodes,
    signalCount: matching.length,
    signalEvidenceGrade: matching.length > 0 ? dominantSignalEvidenceGrade(matching) : "not_applicable",
    signalLabel: `${matching.length} signal${matching.length === 1 ? "" : "s"} emitted`,
    openability: input.openability,
    cleanLabel: input.cleanLabel,
    normalUsageRationale: input.normalUsageRationale,
    details: input.details,
  });
}

function securityMeasureSignals(
  securitySignals: readonly SecuritySignal[],
  lossSignals: readonly LossSignal[],
): readonly SignalLike[] {
  const byKey = new Map<string, SignalLike>();
  for (const signal of securitySignals) {
    byKey.set(securitySignalKey(signal), {
      code: signal.code,
      evidenceGrade: signal.evidenceGrade,
      tenantId: signal.tenantId,
      requestId: signal.requestId,
      provider: signal.provider,
      evidence: signal.evidence,
    });
  }
  for (const signal of lossSignals) {
    if (signal.code !== "SECURITY_SECRET_EXACT_MATCH" &&
      signal.code !== "SECURITY_PROVIDER_SAFETY_FIELD") {
      continue;
    }
    byKey.set(securitySignalKey(signal), signal);
  }
  return [...byKey.values()];
}

function securitySignalKey(signal: Pick<SignalLike, "code" | "tenantId" | "requestId" | "provider">): string {
  return [
    signal.code,
    signal.tenantId ?? "",
    signal.provider ?? "",
    signal.requestId ?? "",
  ].join("\u001f");
}

function toolCallValidityMeasureRow(
  events: readonly CanonicalEventNormalized[],
  signals: readonly SignalLike[],
): BenchMeasureRow {
  const matching = signals.filter((signal) => TOOL_CALL_VALIDITY_SIGNAL_CODES.includes(signal.code as typeof TOOL_CALL_VALIDITY_SIGNAL_CODES[number]));
  const signalCount = distinctToolCallValidityCount(matching);
  const openability = toolCallValidityOpenability(events);
  return coverageMeasureRow({
    rowKey: "tool_call_validity",
    measure: "Tool-call validity",
    signalCodes: TOOL_CALL_VALIDITY_SIGNAL_CODES,
    signalCount,
    signalEvidenceGrade: signalCount > 0 ? dominantSignalEvidenceGrade(matching) : "not_applicable",
    signalLabel: `${signalCount} invalid tool call${signalCount === 1 ? "" : "s"} observed`,
    openability,
    cleanLabel: "watched-clean: tool declarations and response tool evidence validated with no finding",
    normalUsageRationale: "Normal tool-call traffic carried declarations and response tool evidence.",
    details: {
      providerSurfaces: toolCallValiditySurfaceStatus(events),
    },
  });
}

function latencyMeasureRow(
  events: readonly CanonicalEventNormalized[],
  signals: readonly LossSignal[],
): BenchMeasureRow {
  const latencySignals = signals.filter((signal) => signal.code === "LATENCY_BILLED");
  const latestEvaluation = events.length > 0 ? evaluateDefaultLatency(events.at(-1) as CanonicalEventNormalized) : null;
  const activeSegments = activeLatencySegmentAssumptions(events);
  if (latencySignals.length > 0) {
    return coverageMeasureRow({
      rowKey: "provider_latency_slo",
      measure: "Provider latency (Inferock default SLA)",
      signalCodes: ["LATENCY_BILLED"],
      signalCount: latencySignals.length,
      signalEvidenceGrade: dominantSignalEvidenceGrade(latencySignals),
      signalLabel: "standard-defined latency loss emitted",
      openability: latencyOpenability(events),
      cleanLabel: "watched-clean: timing and usage observed with no latency/token signal",
      normalUsageRationale: "Normal calls carried timing and usage evidence.",
      details: latestEvaluation
        ? {
            segment: latestEvaluation.segment,
            thresholds: latestEvaluation.thresholds,
            rate: SLA_DEFAULTS.timeValueRate,
            activeSegments,
          }
        : undefined,
    });
  }
  return coverageMeasureRow({
    rowKey: "provider_latency_slo",
    measure: "Provider latency (Inferock default SLA)",
    signalCodes: ["LATENCY_BILLED"],
    signalCount: 0,
    signalEvidenceGrade: "not_applicable",
    signalLabel: "standard-defined latency loss emitted",
    openability: latencyOpenability(events),
    cleanLabel: "watched-clean: timing and usage observed with no latency/token signal",
    normalUsageRationale: "Normal calls carried timing and usage evidence.",
    details: latestEvaluation
      ? {
          segment: latestEvaluation.segment,
          thresholds: latestEvaluation.thresholds,
          rate: SLA_DEFAULTS.timeValueRate,
          activeSegments,
        }
      : undefined,
  });
}

function hasProviderResponseServedModelEvidence(event: CanonicalEventNormalized): boolean {
  return event.response.servedModelSource === "provider_response";
}

function buildSlaAssumptions(
  events: readonly CanonicalEventNormalized[],
  rows: readonly ReportRow[],
): BenchSlaAssumptions {
  const activeLatencySegments = activeLatencySegmentAssumptions(events);
  const impactFooterLines = rows.length === 0
    ? ["Impact assumptions: no impact figures computed for this period."]
    : [
        "Impact assumptions: money loss and time loss are separate; latency and downtime time translations are not added to money loss.",
        ...latencyFooterLines(rows, activeLatencySegments),
      ];
  return {
    standardVersion: SLA_DEFAULTS.standardVersion,
    timeValueRate: {
      usdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
      currency: SLA_DEFAULTS.timeValueRate.currency,
      unit: SLA_DEFAULTS.timeValueRate.unit,
      label: SLA_DEFAULTS.timeValueRate.label,
      oneLineWhy: SLA_DEFAULTS.timeValueRate.oneLineWhy,
      overrideKey: SLA_DEFAULTS.timeValueRate.overrideKey,
    },
    activeLatencySegments,
    impactFooterLines,
  };
}

function activeLatencySegmentAssumptions(
  events: readonly CanonicalEventNormalized[],
): readonly BenchLatencySegmentAssumption[] {
  const segments = new Map<string, BenchLatencySegmentAssumption>();
  for (const event of events) {
    const evaluation = evaluateDefaultLatency(event);
    const segmentDefaults = SLA_DEFAULTS.latencySegments[evaluation.segment.segmentId];
    if (segments.has(evaluation.segment.segmentId)) continue;
    segments.set(evaluation.segment.segmentId, {
      segmentId: evaluation.segment.segmentId,
      label: evaluation.segment.label,
      selectionReason: evaluation.segment.selectionReason,
      thresholdSummary: latencyThresholdSummary(segmentDefaults.thresholds),
      oneLineWhy: segmentDefaults.oneLineWhy,
      overrideKey: segmentDefaults.overrideKey,
    });
  }
  return [...segments.values()].sort((left, right) => left.segmentId.localeCompare(right.segmentId));
}

function latencyFooterLines(
  rows: readonly ReportRow[],
  activeLatencySegments: readonly BenchLatencySegmentAssumption[],
): readonly string[] {
  if (!rows.some((row) => row.failureClass === "latency")) return [];
  const rate = SLA_DEFAULTS.timeValueRate;
  return [
    `Latency dollar translation: approx at ${formatUsd(rate.usdPerHour)}/${rate.unit} ${rate.label}; why: ${rate.oneLineWhy}; edit: ${rate.overrideKey}.`,
    ...activeLatencySegments.map((segment) =>
      `Latency threshold proposal: ${segment.label}; ${segment.thresholdSummary}; default proposed by The Inferock Standard; edit or confirm: ${segment.overrideKey}.`
        + ` why: ${segment.oneLineWhy}.`
    ),
  ];
}

function latencyAssumptionScreenfulLines(summary: BenchSummary): readonly string[] {
  const rate = summary.slaAssumptions.timeValueRate;
  return [
    `Latency dollar translation: ${formatUsd(rate.usdPerHour)}/${rate.unit} ${rate.label}; why: ${rate.oneLineWhy}; edit: ${rate.overrideKey}.`,
    ...summary.slaAssumptions.activeLatencySegments.map((segment) =>
      `Latency threshold proposal: ${segment.label}; ${segment.thresholdSummary}; default proposed by The Inferock Standard; edit or confirm: ${segment.overrideKey}.`
        + ` why: ${segment.oneLineWhy}.`
    ),
  ];
}

function renderMeasureLines(summary: BenchSummary): readonly string[] {
  return [
    "surface | status | count | label",
    ...summary.coverage.surfaces.map((surface) => [
      surface.measure,
      formatCoverageStatus(surface.status),
      String(surface.signalCount),
      surface.label,
    ].join(" | ")),
  ];
}

export function renderCoverageSummaryLine(coverage: CoverageSummary): string {
  return [
    `surfaces watched ${coverage.watchedCount}/${coverage.totalSurfaceCount}`,
    `signals ${coverage.signalCount}`,
    `not-openable ${coverage.notOpenableCount}`,
  ].join(" | ");
}

export function formatCoverageStatus(status: CoverageSurfaceStatus): string {
  return status.replace("_", "-");
}

function coverageSummary(measures: readonly BenchMeasureRow[], runId: string | undefined): CoverageSummary {
  const surfaces = measures.map(toCoverageSurfaceRow);
  return coverageSummaryFromSurfaces({
    suiteVersion: COVERAGE_SUITE_VERSION,
    methodVersion: COVERAGE_METHOD_VERSION,
    runId: runId ?? "local-summary",
    watchedCount: 0,
    totalSurfaceCount: 0,
    signalCount: 0,
    notOpenableCount: 0,
    surfaces: [],
  }, surfaces);
}

function toCoverageSurfaceRow(row: BenchMeasureRow): CoverageSurfaceRow {
  return {
    surfaceId: row.surfaceId,
    measure: row.measure,
    status: row.status,
    signalCount: row.signalCount,
    evidenceGrade: row.evidenceGrade,
    label: row.label,
    taskIds: row.taskIds,
    detectorCodes: row.detectorCodes,
    normalUsageRationale: row.normalUsageRationale,
    ...(row.watchedEvidence ? { watchedEvidence: row.watchedEvidence } : {}),
    ...(row.notOpenableReason ? { notOpenableReason: row.notOpenableReason } : {}),
    ...(row.details ? { details: row.details } : {}),
  };
}

function coverageMeasureRow(input: {
  readonly rowKey: string;
  readonly measure: string;
  readonly signalCodes: readonly string[];
  readonly signalCount: number;
  readonly signalEvidenceGrade: string;
  readonly signalLabel: string;
  readonly openability: SurfaceOpenability;
  readonly cleanLabel: string;
  readonly cleanEvidenceGrade?: string;
  readonly normalUsageRationale: string;
  readonly details?: Record<string, unknown>;
}): BenchMeasureRow {
  const status = input.signalCount > 0
    ? "signal"
    : input.openability.applicable === false
      ? "not_applicable"
      : input.openability.openable
      ? "watched_clean"
      : "not_openable";
  const notOpenableReason = status === "not_openable" || status === "not_applicable"
    ? input.openability.reason ?? "surface precondition not carried"
    : undefined;
  const watchedEvidence = input.openability.watchedEvidence;
  const signalCodes = uniqueStrings(input.signalCodes);
  return {
    rowKey: input.rowKey,
    surfaceId: input.rowKey,
    measure: input.measure,
    status,
    verdict: compatVerdictForCoverageStatus(status),
    count: input.signalCount,
    signalCount: input.signalCount,
    evidenceGrade: status === "signal"
      ? input.signalEvidenceGrade
      : status === "watched_clean"
        ? input.cleanEvidenceGrade ?? "not_applicable"
        : "not_applicable",
    label: status === "signal"
      ? input.signalLabel
      : status === "watched_clean"
        ? input.cleanLabel
        : status === "not_applicable"
          ? `not-applicable: ${notOpenableReason}`
          : `not-openable: ${notOpenableReason}`,
    signalCodes,
    taskIds: [],
    detectorCodes: signalCodes,
    normalUsageRationale: input.normalUsageRationale,
    ...(watchedEvidence ? { watchedEvidence } : {}),
    ...(notOpenableReason ? { notOpenableReason } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
}

function compatVerdictForCoverageStatus(status: CoverageSurfaceStatus): BenchMeasureVerdict {
  switch (status) {
    case "signal":
      return "signal";
    case "watched_clean":
      return "exercised";
    case "not_openable":
      return "not_exercised";
    case "not_applicable":
      return "not_exercised";
  }
}

function overlayCoverageMeasureRow(input: {
  readonly rowKey: string;
  readonly measure: string;
  readonly count: number;
  readonly signalCodes: readonly string[];
  readonly openability: SurfaceOpenability;
  readonly cleanLabel: string;
  readonly normalUsageRationale: string;
}): BenchMeasureRow {
  return coverageMeasureRow({
    rowKey: input.rowKey,
    measure: input.measure,
    signalCodes: input.signalCodes,
    signalCount: input.count,
    signalEvidenceGrade: input.count > 0 ? "triage_only" : "not_applicable",
    signalLabel: `${input.count} evidence-only overlay${input.count === 1 ? "" : "s"} emitted`,
    openability: input.openability,
    cleanLabel: input.cleanLabel,
    normalUsageRationale: input.normalUsageRationale,
    details: input.count > 0
      ? { computationTrace: zeroDollarComputationTrace(`${input.rowKey}_overlay_v1`, "evidence-only overlay; no standard-dollar computation") }
      : undefined,
  });
}

function staticCoverageMeasureRow(input: {
  readonly rowKey: string;
  readonly measure: string;
  readonly signalCodes: readonly string[];
  readonly openability: SurfaceOpenability;
  readonly cleanLabel: string;
  readonly cleanEvidenceGrade?: string;
  readonly normalUsageRationale: string;
  readonly details?: Record<string, unknown>;
}): BenchMeasureRow {
  return coverageMeasureRow({
    rowKey: input.rowKey,
    measure: input.measure,
    signalCodes: input.signalCodes,
    signalCount: 0,
    signalEvidenceGrade: "not_applicable",
    signalLabel: "0 signals emitted",
    openability: input.openability,
    cleanLabel: input.cleanLabel,
    ...(input.cleanEvidenceGrade ? { cleanEvidenceGrade: input.cleanEvidenceGrade } : {}),
    normalUsageRationale: input.normalUsageRationale,
    ...(input.details ? { details: input.details } : {}),
  });
}

function jsonSchemaOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const openable = events.some(jsonModeRequested);
  return {
    openable,
    reason: openable ? undefined : "no JSON/schema output contract",
    watchedEvidence: { jsonModeRequested: openable },
  };
}

function anthropicCrosscheckOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  if (events.length > 0 && events.every((event) => event.request.provider !== "anthropic")) {
    return {
      openable: false,
      applicable: false,
      reason: "not applicable to non-Anthropic provider traffic",
      watchedEvidence: { anthropicTrafficObserved: false },
    };
  }
  const openable = events.some((event) => event.request.provider === "anthropic");
  return {
    openable,
    reason: openable ? undefined : "no Anthropic output-token traffic for recount cross-check",
    watchedEvidence: { anthropicTrafficObserved: openable },
  };
}

function duplicateRequestIdOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const openable = events.some((event) =>
    Boolean(event.request.operationId) ||
    Boolean(event.request.bodyHash) ||
    Boolean(event.request.retryCorrelationId)
  );
  return {
    openable,
    reason: openable ? undefined : "no operation/idempotency evidence captured",
    watchedEvidence: {
      operationIdObserved: events.some((event) => Boolean(event.request.operationId)),
      bodyHashObserved: events.some((event) => Boolean(event.request.bodyHash)),
      retryCorrelationIdObserved: events.some((event) => Boolean(event.request.retryCorrelationId)),
    },
  };
}

function latencyOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const openable = events.some(hasTimingAndUsageEvidence);
  const providerElapsedObserved = events.some(hasProviderElapsedTimingEvidence);
  return {
    openable,
    reason: openable ? undefined : "no latency timing captured",
    watchedEvidence: {
      timingAndUsageObserved: openable,
      gatewayTotalLatencyObserved: openable,
      providerElapsedObserved,
      gatewayTotalTimingEventCount: events.filter(hasTimingAndUsageEvidence).length,
      providerElapsedTimingEventCount: events.filter(hasProviderElapsedTimingEvidence).length,
    },
  };
}

function toolCallValidityOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const toolDeclarationsObserved = events.some((event) => (event.request.toolDeclarations?.length ?? 0) > 0);
  const responseToolEvidenceObserved = events.some(hasResponseToolEvidence);
  const surfaces = toolCallValiditySurfaceObserved(events);
  const openable = Object.values(surfaces).some(Boolean);
  return {
    openable,
    reason: openable
      ? undefined
      : toolDeclarationsObserved && responseToolEvidenceObserved
      ? "no supported tool-call validity surface with declarations and response tool evidence"
      : "no tool declarations and response tool evidence",
    watchedEvidence: {
      toolDeclarationsObserved,
      responseToolEvidenceObserved,
      openAiChatCompletionsObserved: surfaces.openAiChatCompletions,
      openAiResponsesObserved: surfaces.openAiResponses,
      anthropicMessagesObserved: surfaces.anthropicMessages,
      geminiGenerateContentObserved: surfaces.geminiGenerateContent,
      openAiCompatibleChatObserved: surfaces.openAiCompatibleChat,
    },
  };
}

function securityOpenability(
  events: readonly CanonicalEventNormalized[],
  suiteTaskIds: readonly string[],
): SurfaceOpenability {
  const captureComplete = events.some((event) => event.request.securityContext?.captureComplete === true);
  const providerSafetyObserved = events.some((event) => (event.response.providerSafety?.length ?? 0) > 0);
  const passiveSecurityTaskObserved = suiteTaskIds.includes("organic_safety_overlays");
  const openable = passiveSecurityTaskObserved || captureComplete || providerSafetyObserved;
  return {
    openable,
    reason: openable ? undefined : "no passive security inspection evidence",
    watchedEvidence: {
      passiveSecurityTaskObserved,
      requestSecurityCaptureComplete: captureComplete,
      providerSafetyObserved,
    },
  };
}

function contentFilterOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  if (events.length > 0 && events.every((event) => event.request.provider !== "openai")) {
    return {
      openable: false,
      applicable: false,
      reason: "not applicable to non-OpenAI provider traffic",
      watchedEvidence: { openAiTrafficObserved: false },
    };
  }
  const openAiTrafficObserved = events.some((event) =>
    event.request.provider === "openai" &&
    event.request.expectCompletion !== false &&
    event.response.statusCode < 500
  );
  return {
    openable: openAiTrafficObserved,
    reason: openAiTrafficObserved ? undefined : "no OpenAI completion traffic inspected",
    watchedEvidence: { openAiTrafficObserved },
  };
}

function streamTerminationOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const streamObserved = events.some(hasStreamEvidence);
  const terminalEvidenceObserved = events.some(hasStreamTerminalEvidence);
  return {
    openable: terminalEvidenceObserved,
    reason: terminalEvidenceObserved
      ? undefined
      : streamObserved
        ? "stream request without terminal evidence"
        : "not a streaming request",
    watchedEvidence: {
      streamEvidenceObserved: streamObserved,
      terminalEvidenceObserved,
    },
  };
}

function servedModelOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const identityEvidence = events.some(hasProviderResponseServedModelEvidence);
  return {
    openable: identityEvidence,
    reason: identityEvidence ? undefined : "no provider-response served-model evidence",
    watchedEvidence: { identityEvidence },
  };
}

function retryAmplificationOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const sdkRetryObservation = events.some(hasSdkRetryObservation);
  return {
    openable: sdkRetryObservation,
    reason: sdkRetryObservation ? undefined : "no SDK/native retry evidence can be observed",
    watchedEvidence: { sdkRetryObservation },
  };
}

function cacheIntegrityOpenability(
  events: readonly CanonicalEventNormalized[],
  context: SummaryContext,
  suiteTaskIds: readonly string[],
): SurfaceOpenability {
  const cacheEvents = events.filter(hasCacheTokenEvidence);
  const sharedPrefixCallCount = sharedPrefixCacheCallCount(events, suiteTaskIds);
  const sharedPrefixPreconditionObserved = sharedPrefixCallCount >= 2;
  const cacheTokensObserved = cacheEvents.length > 0;
  const chargeObserved = cacheEvents.some((event) => cacheObservedChargeForEvent(event, context) !== null);
  return {
    openable: sharedPrefixPreconditionObserved && cacheTokensObserved && chargeObserved,
    reason: context.chargeObservationConfigState === "malformed"
      ? "provider charge observation file is malformed"
      : context.chargeObservationConfigState === "unreadable"
        ? "provider charge observation file could not be read"
        : !sharedPrefixPreconditionObserved
          ? "shared-prefix cache precondition not observed"
        : !cacheTokensObserved
          ? "no cache-token evidence"
          : chargeObserved
            ? undefined
            : context.chargeObservationConfigured
              ? "no matching provider charge observation for cache event"
              : "shared-prefix cache tokens observed but provider charge observation is unavailable; cache charge reconciliation requires hosted or imported provider billing data",
    watchedEvidence: {
      sharedPrefixCallCount,
      requiredSharedPrefixCallCount: 2,
      sharedPrefixPreconditionObserved,
      cacheTokensObserved,
      chargeObserved,
      chargeObservationConfigured: context.chargeObservationConfigured,
      chargeObservationConfigState: context.chargeObservationConfigState,
    },
  };
}

function sharedPrefixCacheCallCount(
  events: readonly CanonicalEventNormalized[],
  suiteTaskIds: readonly string[],
): number {
  const suiteTaskCount = suiteTaskIds.filter((taskId) => taskId === "shared_prefix_cache").length;
  const metadataCount = events.filter(hasSharedPrefixCacheMetadata).length;
  return Math.max(suiteTaskCount, metadataCount);
}

function driftRegressionOpenability(
  events: readonly CanonicalEventNormalized[],
  context: SummaryContext,
): SurfaceOpenability {
  const canaryEvents = events.filter(isDriftCanaryEvent);
  const completedCanaryCalls = canaryEvents.filter(isCompletedCall).length;
  if (completedCanaryCalls > 0) {
    return {
      openable: false,
      reason: `drift canary baseline collecting (0/${DRIFT_CANARY_BASELINE_RUN_COUNT})`,
      watchedEvidence: {
        driftCanaryEvents: canaryEvents.length,
        completedCanaryCalls,
        fullCanaryItemCountRequired: DRIFT_CANARY_ITEM_COUNT,
        baselineRunCountRequired: DRIFT_CANARY_BASELINE_RUN_COUNT,
        baselineRunsCompletedBeforeCurrent: 0,
        baselineEstablished: false,
        methodId: "per_model_known_answer_canary_v1",
      },
    };
  }

  const replayEvents = events.filter(isDriftReplayEvent);
  const completedReplayCalls = replayEvents.filter(isCompletedCall).length;
  const contract = declaredDriftReplayContract(replayEvents, context);
  const completedContractCalls = contract
    ? replayEvents.filter((event) =>
      eventBelongsToDriftContract(event, contract, context) &&
      isCompletedCall(event)
    ).length
    : 0;
  const repeatWindowSatisfied = completedContractCalls >= 3 && completedContractCalls <= 5;
  const matcherWithinThreshold = contract
    ? driftMatcherWithinThreshold(replayEvents.filter((event) =>
      eventBelongsToDriftContract(event, contract, context) && isCompletedCall(event)
    ), contract)
    : false;
  const openable = Boolean(contract && repeatWindowSatisfied && matcherWithinThreshold);
  return {
    openable,
    reason: openable
      ? undefined
      : !contract
        ? "no drift replay contract configured"
        : !repeatWindowSatisfied
          ? "drift replay contract requires 3-5 completed same-window repeats"
          : "drift matcher did not run within threshold",
    watchedEvidence: {
      driftReplayEvents: replayEvents.length,
      completedReplayCalls,
      driftContractConfigured: Boolean(contract),
      ...(contract
        ? {
          repeatGroupId: contract.repeatGroupId,
          matcher: contract.matcher,
          threshold: contract.threshold,
          completedContractCalls,
          matcherWithinThreshold,
        }
        : {}),
    },
  };
}

function driftRegressionCleanLabel(openability: SurfaceOpenability): string {
  const canaryCount = numericValue(openability.watchedEvidence?.completedCanaryCalls) ?? 0;
  if (canaryCount > 0) {
    return `watched-clean: per-model known-answer drift canary ran (${canaryCount} calls)`;
  }
  const repeatCount = numericValue(openability.watchedEvidence?.completedContractCalls) ?? 0;
  return `watched-clean: single-window repeat method (weaker than scheduled drift) - ${repeatCount} repeats within threshold`;
}

function driftRegressionMethodDetails(openability: SurfaceOpenability): Record<string, unknown> {
  const evidence = openability.watchedEvidence ?? {};
  const canaryCount = numericValue(evidence.completedCanaryCalls) ?? 0;
  if (canaryCount > 0) {
    return {
      methodId: "per_model_known_answer_canary_v1",
      methodVersion: "drift-canary-method-v1-2026-07-04",
      evidenceGrade: "triage_only",
      completedCanaryCalls: canaryCount,
    };
  }
  return {
    methodId: "identical_rerun_drift",
    methodVersion: "single_window_repeat_v1",
    evidenceGrade: "triage_only",
    weakerGrade: true,
    weakerThan: "scheduled_drift_replay",
    repeatCount: numericValue(evidence.completedContractCalls) ?? 0,
    ...(stringValue(evidence.matcher) ? { matcher: stringValue(evidence.matcher) } : {}),
    ...(numericValue(evidence.threshold) !== null ? { threshold: numericValue(evidence.threshold) } : {}),
  };
}

interface DriftReplayContractEvidence {
  readonly contractId: string;
  readonly matcher: "exact" | "semantic" | "known_answer";
  readonly repeatGroupId: string;
  readonly threshold: number;
}

function declaredDriftReplayContract(
  replayEvents: readonly CanonicalEventNormalized[],
  context: SummaryContext,
): DriftReplayContractEvidence | null {
  if (context.driftReplayContract) return context.driftReplayContract;
  for (const event of replayEvents) {
    const contract = driftReplayContractForEvent(event);
    if (contract) return contract;
  }
  return null;
}

function eventBelongsToDriftContract(
  event: CanonicalEventNormalized,
  contract: DriftReplayContractEvidence,
  context: SummaryContext,
): boolean {
  const eventContract = driftReplayContractForEvent(event);
  if (!eventContract) return Boolean(context.driftReplayContract);
  return eventContract.contractId === contract.contractId &&
    eventContract.repeatGroupId === contract.repeatGroupId;
}

function driftReplayContractForEvent(event: CanonicalEventNormalized): DriftReplayContractEvidence | null {
  const contract = firstRecord([
    recordAt(event.request.generation, "driftContract"),
    recordAt(event.request.generation, "driftReplayContract"),
    recordAt(event.request.generation, "drift", "contract"),
    recordAt(event.rawOriginalEvent, "driftContract"),
    recordAt(event.rawOriginalEvent, "driftReplayContract"),
    recordAt(event.rawOriginalEvent, "meta", "driftContract"),
    recordAt(event.rawOriginalEvent, "meta", "driftReplayContract"),
  ]);
  if (!contract) return null;

  const contractId = stringValue(contract.contractId);
  const repeatGroupId = stringValue(contract.repeatGroupId);
  const matcher = stringValue(contract.matcher);
  const threshold = numericValue(contract.threshold);
  if (
    !contractId ||
    !repeatGroupId ||
    (matcher !== "exact" && matcher !== "semantic" && matcher !== "known_answer") ||
    threshold === null ||
    threshold < 0
  ) {
    return null;
  }
  return { contractId, repeatGroupId, matcher, threshold };
}

function driftMatcherRanWithinThreshold(event: CanonicalEventNormalized, threshold: number): boolean {
  const evaluation = firstRecord([
    recordAt(event.request.generation, "driftEvaluation"),
    recordAt(event.request.generation, "driftMatcher"),
    recordAt(event.request.generation, "drift", "evaluation"),
    recordAt(event.rawOriginalEvent, "driftEvaluation"),
    recordAt(event.rawOriginalEvent, "driftMatcher"),
    recordAt(event.rawOriginalEvent, "meta", "driftEvaluation"),
    recordAt(event.rawOriginalEvent, "meta", "driftMatcher"),
  ]);
  if (!evaluation) return false;
  if (evaluation.withinThreshold === true || evaluation.matcherWithinThreshold === true) return true;
  const drifted = evaluation.drifted;
  if (drifted === false && evaluation.matcherRan === true) return true;
  const observedDistance = numericValue(evaluation.distance) ??
    numericValue(evaluation.score) ??
    numericValue(evaluation.cosineDistance) ??
    numericValue(evaluation.delta);
  return observedDistance !== null && observedDistance <= threshold;
}

function driftMatcherWithinThreshold(
  replayEvents: readonly CanonicalEventNormalized[],
  contract: DriftReplayContractEvidence,
): boolean {
  if (replayEvents.some((event) => driftMatcherRanWithinThreshold(event, contract.threshold))) return true;
  return repeatedOutputsWithinThreshold(replayEvents, contract.threshold);
}

function repeatedOutputsWithinThreshold(
  replayEvents: readonly CanonicalEventNormalized[],
  threshold: number,
): boolean {
  const outputs = replayEvents
    .map((event) => normalizedDriftOutput(event.response.content))
    .filter((output) => output.length > 0);
  if (outputs.length < 3) return false;
  const reference = outputs[0];
  if (reference === undefined) return false;
  return outputs.every((output) => normalizedEditDistance(reference, output) <= threshold);
}

function normalizedDriftOutput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedEditDistance(left: string, right: string): number {
  if (left === right) return 0;
  const distance = editDistance(left, right);
  return distance / Math.max(left.length, right.length, 1);
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return previous[right.length] ?? 0;
}

function factualityOpenability(events: readonly CanonicalEventNormalized[]): SurfaceOpenability {
  const factualityContractObserved = events.some(hasCapturedFactualityContract);
  const citationSupportObserved = events.some(hasCitationSupportEvidence);
  return {
    openable: factualityContractObserved || citationSupportObserved,
    reason: factualityContractObserved || citationSupportObserved
      ? undefined
      : "no factuality contract or citation-support evidence captured",
    watchedEvidence: {
      factualityContractObserved,
      citationSupportObserved,
    },
  };
}

function benchFactualitySignals(event: CanonicalEventNormalized): FactualitySignal[] {
  return runFactualityDetectors(event);
}

function hasCapturedFactualityContract(event: CanonicalEventNormalized): boolean {
  return isRecord(event.request.factualityContract);
}

function hasCitationSupportEvidence(event: CanonicalEventNormalized): boolean {
  return (event.response.citations?.length ?? 0) > 0;
}

function hasLatencyLoss(summary: BenchSummary): boolean {
  return summary.rows.some((row) => row.failureClass === "latency" && row.timeLossMs > 0);
}

function latencyThresholdSummary(thresholds: {
  readonly goodStartMs: number;
  readonly acceptableStartMs: number;
  readonly goodOutputTokensPerSecond: number;
  readonly acceptableOutputTokensPerSecond: number;
  readonly goodMsPerOutputToken: number;
  readonly acceptableMsPerOutputToken: number;
}): string {
  return [
    `good start ${formatDuration(thresholds.goodStartMs)}`,
    `acceptable start ${formatDuration(thresholds.acceptableStartMs)}`,
    `good output ${thresholds.goodOutputTokensPerSecond} tokens/sec`,
    `acceptable output ${thresholds.acceptableOutputTokensPerSecond} tokens/sec`,
    `good total adds ${formatDuration(thresholds.goodMsPerOutputToken)}/output token`,
    `acceptable total adds ${formatDuration(thresholds.acceptableMsPerOutputToken)}/output token`,
  ].join("; ");
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function computationTraceLine(signal: LossSignal): string | null {
  const trace = signal.computationTrace ?? signal.evidence.computationTrace;
  if (!isRecord(trace)) return null;
  const oneLine = trace.oneLine;
  if (typeof oneLine !== "string" || oneLine.trim().length === 0) return null;
  if (signal.code === "DUPLICATE_REQUEST_ID" && (signal.standardLossUsd ?? 0) > 0) {
    return `${oneLine} — verify against your invoice`;
  }
  return oneLine;
}

function sanitizationDeltaLines(signal: LossSignal): readonly string[] {
  const sanitization = recordValue(signal.evidence.schemaSanitization) ??
    recordValue(signal.valueJson?.schemaSanitization);
  if (!sanitization) return [];
  if (stringValue(sanitization.provider) !== "gemini") return [];

  const changes = recordArray(sanitization.changes);
  if (changes.length === 0) {
    return [
      "schema delta: Gemini adapter sanitized requested schema before dispatch; dollars judged against sent schema",
    ];
  }

  const changeSummaries = uniqueStrings(changes.map(sanitizationChangeSummary).filter((line): line is string =>
    line !== null
  ));
  const rendered = changeSummaries.length > 0
    ? changeSummaries.slice(0, 4).join("; ")
    : "requested schema changed";
  const suffix = changeSummaries.length > 4 ? `; +${changeSummaries.length - 4} more` : "";
  return [
    `schema delta: Gemini adapter sanitized unsupported OpenAPI subset keywords before dispatch (${rendered}${suffix}); dollars judged against sent schema`,
  ];
}

function sanitizationChangeSummary(change: Record<string, unknown>): string | null {
  const keyword = stringValue(change.keyword);
  const action = stringValue(change.action);
  const path = stringValue(change.path);
  if (!keyword && !action && !path) return null;
  const verb = action ?? "changed";
  if (keyword && path) return `${verb} ${keyword} at ${path}`;
  if (keyword) return `${verb} ${keyword}`;
  return path ? `${verb} ${path}` : verb;
}

function geminiSchemaSanitizationForEvent(event: CanonicalEventNormalized): Record<string, unknown> | null {
  return recordValue(event.request.generation?.geminiSchemaSanitization);
}

function zeroDollarComputationTrace(methodId: string, whyZero: string): Record<string, unknown> {
  return {
    methodId,
    methodVersion: SLA_DEFAULTS.signoff.signedOffAt,
    standardVersion: SLA_DEFAULTS.standardVersion,
    whyZero,
    outputs: {
      standardLossUsd: 0,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0,
    },
  };
}

function standardLossUsdForSignal(signal: LossSignal): number {
  const standardLossUsd = signal.standardLossUsd ??
    numericValue(signal.valueJson?.standardLossUsd) ??
    numericValue(traceOutput(signal, "standardLossUsd"));
  if (standardLossUsd !== null) return standardLossUsd;
  return 0;
}

function providerRecognizedUsdForSignal(signal: LossSignal): number {
  return signal.providerRecognizedLossUsd ??
    numericValue(signal.valueJson?.providerRecognizedLossUsd) ??
    numericValue(traceOutput(signal, "providerRecognizedLossUsd")) ??
    signal.providerRecoverableLossUsd ??
    0;
}

function recognitionGapUsdForSignal(
  signal: LossSignal,
  standardLossUsd: number,
  providerRecognizedUsd: number,
): number {
  const explicit = signal.recognitionGapUsd ??
    numericValue(signal.valueJson?.recognitionGapUsd) ??
    numericValue(traceOutput(signal, "recognitionGapUsd"));
  if (explicit !== null) return explicit;
  return standardLossUsd - providerRecognizedUsd;
}

function traceOutput(signal: LossSignal, key: string): unknown {
  const trace = signal.computationTrace ?? signal.evidence.computationTrace;
  if (!isRecord(trace)) return null;
  const outputs = trace.outputs;
  if (!isRecord(outputs)) return null;
  return outputs[key];
}

function jsonModeRequested(event: CanonicalEventNormalized): boolean {
  const generation = event.request.generation;
  const responseFormat = generation?.responseFormat ?? generation?.response_format;
  if (typeof responseFormat === "string") return responseFormat.toLowerCase().includes("json");
  if (!isRecord(responseFormat)) return false;
  const type = responseFormat.type;
  return type === "json_object" || type === "json_schema";
}

function parseJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function optionalSignal(signal: LossSignal | null): readonly LossSignal[] {
  return signal ? [signal] : [];
}

function dedupeSignals(signals: readonly LossSignal[]): LossSignal[] {
  const seen = new Set<string>();
  const output: LossSignal[] = [];
  for (const signal of signals) {
    const key = `${signal.requestId}\u0000${signal.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(signal);
  }
  return output;
}

function hasStreamEvidence(event: CanonicalEventNormalized): boolean {
  return (event.timing.chunkCount ?? 0) > 0 ||
    Boolean(event.timing.firstEventAt) ||
    Boolean(event.timing.firstContentDeltaAt) ||
    Boolean(event.timing.lastChunkAt);
}

function hasStreamTerminalEvidence(event: CanonicalEventNormalized): boolean {
  return hasStreamEvidence(event) && event.timing.terminalStatus !== "unknown";
}

function hasTimingAndUsageEvidence(event: CanonicalEventNormalized): boolean {
  return Number.isFinite(event.timing.latencyMs) &&
    event.timing.latencyMs >= 0 &&
    (event.usage.input > 0 ||
      event.usage.output > 0 ||
      (event.usage.cache?.read ?? 0) > 0 ||
      (event.usage.cache?.creation ?? 0) > 0 ||
      event.usage.categories.length > 0);
}

function hasProviderElapsedTimingEvidence(event: CanonicalEventNormalized): boolean {
  return Number.isFinite(event.timing.providerElapsedMs) &&
    event.timing.providerElapsedMs !== undefined &&
    event.timing.providerElapsedMs >= 0 &&
    Boolean(event.timing.providerRequestStartedAt) &&
    Boolean(event.timing.providerResponseEndedAt);
}

function hasResponseToolEvidence(event: CanonicalEventNormalized): boolean {
  return (event.response.rawToolCalls?.length ?? 0) > 0 ||
    (event.response.toolCalls?.length ?? 0) > 0;
}

function toolCallValiditySurfaceObserved(events: readonly CanonicalEventNormalized[]): Record<string, boolean> {
  return {
    openAiChatCompletions: events.some((event) =>
      hasToolDeclarationSurface(event, "chat_completions") && hasOpenAiChatToolEvidence(event)
    ),
    openAiResponses: events.some((event) =>
      hasToolDeclarationSurface(event, "openai_responses") && hasOpenAiResponsesToolEvidence(event)
    ),
    anthropicMessages: events.some((event) =>
      hasToolDeclarationSurface(event, "anthropic_messages") && hasAnthropicToolEvidence(event)
    ),
    geminiGenerateContent: events.some((event) =>
      hasToolDeclarationSurface(event, "gemini_generate_content") && hasGeminiToolEvidence(event)
    ),
    openAiCompatibleChat: events.some((event) =>
      hasToolDeclarationSurface(event, "openai_compatible_chat") && hasOpenAiChatToolEvidence(event)
    ),
  };
}

function toolCallValiditySurfaceStatus(events: readonly CanonicalEventNormalized[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(toolCallValiditySurfaceObserved(events)).map(([surface, observed]) => [
      surface,
      observed ? "watched_clean" : "not_openable",
    ]),
  );
}

function hasToolDeclarationSurface(
  event: CanonicalEventNormalized,
  providerSurface: string,
): boolean {
  return (event.request.toolDeclarations ?? []).some((declaration) =>
    declaration.providerSurface === providerSurface
  );
}

function hasOpenAiChatToolEvidence(event: CanonicalEventNormalized): boolean {
  return toolEvidenceRecords(event).some((toolCall) => isRecord(toolCall.function));
}

function hasOpenAiResponsesToolEvidence(event: CanonicalEventNormalized): boolean {
  return toolEvidenceRecords(event).some((toolCall) =>
    toolCall.type === "function_call" &&
    (typeof toolCall.name === "string" ||
      typeof toolCall.arguments === "string" ||
      typeof toolCall.call_id === "string")
  );
}

function hasAnthropicToolEvidence(event: CanonicalEventNormalized): boolean {
  return toolEvidenceRecords(event).some((toolCall) =>
    toolCall.type === "tool_use" ||
    Object.prototype.hasOwnProperty.call(toolCall, "input") ||
    Object.prototype.hasOwnProperty.call(toolCall, "inputJson")
  );
}

function hasGeminiToolEvidence(event: CanonicalEventNormalized): boolean {
  return toolEvidenceRecords(event).some((toolCall) =>
    toolCall.type === "function_call" ||
    isRecord(toolCall.functionCall)
  );
}

function toolEvidenceRecords(event: CanonicalEventNormalized): readonly Record<string, unknown>[] {
  const rawToolCalls = (event.response.rawToolCalls ?? []).filter(isRecord);
  if (rawToolCalls.length > 0) return rawToolCalls;
  return (event.response.toolCalls ?? []).filter(isRecord);
}

function distinctToolCallValidityCount(signals: readonly SignalLike[]): number {
  const entriesBySignal = signals.map((signal) => {
    const eventKey = [
      signal.tenantId ?? "tenant",
      signal.provider ?? "provider",
      signal.requestId ?? "request",
    ].join(":");
    return {
      signal,
      eventKey,
      callEvidence: [
        ...recordArray(signal.evidence?.invalidCalls),
        ...recordArray(signal.evidence?.violations),
      ],
    };
  });

  const knownCallKeysByEvent = new Map<string, Set<string>>();
  for (const entry of entriesBySignal) {
    for (const evidence of entry.callEvidence) {
      const key = directToolCallEvidenceKey(entry.eventKey, evidence);
      if (!key) continue;
      const knownKeys = knownCallKeysByEvent.get(entry.eventKey) ?? new Set<string>();
      knownKeys.add(key);
      knownCallKeysByEvent.set(entry.eventKey, knownKeys);
    }
  }

  const distinctCalls = new Set<string>();
  for (const entry of entriesBySignal) {
    if (entry.callEvidence.length === 0) {
      distinctCalls.add(`${entry.eventKey}:${entry.signal.code}`);
      continue;
    }
    for (const evidence of entry.callEvidence) {
      const key = directToolCallEvidenceKey(entry.eventKey, evidence) ??
        singleKnownCallKeyForEvent(entry.eventKey, evidence, knownCallKeysByEvent) ??
        `${entry.eventKey}:${entry.signal.code}:event`;
      distinctCalls.add(key);
    }
  }
  return distinctCalls.size;
}

function directToolCallEvidenceKey(eventKey: string, evidence: Record<string, unknown>): string | null {
  const rawHash = stringValue(evidence.rawToolCallHash);
  if (rawHash) return `${eventKey}:hash:${rawHash}`;
  const toolId = stringValue(evidence.toolId);
  if (toolId) return `${eventKey}:id:${toolId}`;
  const providerPath = stringValue(evidence.providerPath);
  if (providerPath) return `${eventKey}:path:${providerPath}`;
  const toolIndex = numericValue(evidence.toolIndex);
  if (toolIndex !== null) return `${eventKey}:index:${toolIndex}`;
  return null;
}

function singleKnownCallKeyForEvent(
  eventKey: string,
  evidence: Record<string, unknown>,
  knownCallKeysByEvent: ReadonlyMap<string, ReadonlySet<string>>,
): string | null {
  if (numericValue(evidence.toolBlockCount) !== 1) return null;
  const knownKeys = knownCallKeysByEvent.get(eventKey);
  if (!knownKeys || knownKeys.size !== 1) return null;
  return [...knownKeys][0] ?? null;
}

function hasSdkRetryObservation(event: CanonicalEventNormalized): boolean {
  if (headerValue(event.request.sanitizedHeaders, "x-stainless-retry-count") !== undefined) return true;
  if (headerValue(event.response.sanitizedHeaders, "x-stainless-retry-count") !== undefined) return true;
  return event.attempts.some((attempt) =>
    attempt.status === "retry" ||
    attempt.retryReason !== undefined ||
    attempt.finalSelected === false ||
    headerValue(attempt.sanitizedHeaders, "x-stainless-retry-count") !== undefined
  );
}

function hasCacheTokenEvidence(event: CanonicalEventNormalized): boolean {
  return (event.usage.cache?.read ?? 0) > 0 ||
    (event.usage.cache?.creation ?? 0) > 0 ||
    event.usage.categories.some((category) => category.category.toLowerCase().includes("cache"));
}

function hasSharedPrefixCacheMetadata(event: CanonicalEventNormalized): boolean {
  const generation = event.request.generation;
  return Boolean(
    stringValue(recordAt(generation, "metadata")?.sharedPrefixGroup) ||
    stringValue(recordAt(generation, "metadata")?.shared_prefix_group) ||
    stringValue(recordAt(generation, "cache")?.sharedPrefixGroup) ||
    stringValue(recordAt(event.rawOriginalEvent, "metadata")?.sharedPrefixGroup) ||
    stringValue(recordAt(event.rawOriginalEvent, "body", "metadata")?.sharedPrefixGroup),
  );
}

function isDriftReplayEvent(event: CanonicalEventNormalized): boolean {
  return event.meta.source === "drift_replay" ||
    event.request.workloadClass === "drift_replay" ||
    (event.rawOriginalEvent && "meta" in event.rawOriginalEvent &&
      event.rawOriginalEvent.meta?.source === "drift_replay");
}

function isDriftCanaryEvent(event: CanonicalEventNormalized): boolean {
  return event.request.workloadClass === DRIFT_CANARY_WORKLOAD_CLASS;
}

function isCompletedCall(event: CanonicalEventNormalized): boolean {
  return event.response.statusCode < 400 &&
    event.timing.endedAt.length > 0 &&
    event.response.errorClass === undefined;
}

function headerValue(record: Record<string, string> | undefined, headerName: string): string | undefined {
  if (!record) return undefined;
  const expected = headerName.toLowerCase();
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === expected) return value;
  }
  return undefined;
}

function dominantSignalEvidenceGrade(signals: readonly SignalLike[]): string {
  if (signals.some((signal) => signal.evidenceGrade === "refundable_candidate")) return "refundable_candidate";
  if (signals.some((signal) => signal.evidenceGrade === "unrecognized_standard_loss")) {
    return "unrecognized_standard_loss";
  }
  if (signals.some((signal) => signal.evidenceGrade === "triage_only")) return "triage_only";
  return "not_applicable";
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerValue(value: unknown): CanonicalEventNormalized["request"]["provider"] | null {
  return value === "openai" || value === "anthropic" || value === "gemini" || value === "openrouter"
    ? value
    : null;
}

function recordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstRecord(values: readonly unknown[]): Record<string, unknown> | null {
  return values.find(isRecord) ?? null;
}

function recordAt(value: unknown, ...path: readonly string[]): Record<string, unknown> | null {
  let cursor: unknown = value;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  return isRecord(cursor) ? cursor : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
