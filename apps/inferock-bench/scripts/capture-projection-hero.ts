import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import playwright, { type Page } from "@playwright/test";
import { normalizeCanonicalEvent, type CanonicalEventV2 } from "@inferock/measure/canonical-event";
import { SLA_DEFAULTS } from "@inferock/measure/sla-defaults";
import { estimateCostUsd } from "@inferock/measure/stateless";
import { formatApproxTimeLost } from "@inferock/measure/time-loss";
import { createBenchApp } from "../src/proxy.js";
import type { BenchConfig, BenchPaths } from "../src/config.js";
import { reconciledUsdPartition } from "../src/display-partition.js";
import { createReceiptBundle, renderReceipt, type ReceiptBundle } from "../src/receipt.js";
import { formatUsd, summarizeBenchEvents, type BenchSummary } from "../src/summary.js";
import type { EventStore, StoredBenchEvent } from "../src/storage.js";

const SCRATCHPAD_ROOT = "/tmp/claude-1000/-home-ubuntu-repo-governance-gateway/ff089d77-c5be-4910-9bc2-a8ba64ffb391/scratchpad/projhero";
const benchKey = "ibl_projection_capture_key_1234567890";
const projectionCaptureManagementAccessToken = "projection-hero-capture-management-token";
const runId = "projection-hero-vaudit-50k";
const deviceScaleFactor = 2;

interface CaptureOptions {
  readonly output: string;
  readonly narrowOutput: string;
  readonly metadataOnly: boolean;
}

interface ProjectionPayloads {
  readonly summaryPayload: Record<string, unknown>;
  readonly rowsPayload: Record<string, unknown>;
  readonly callsPayload: Record<string, unknown>;
  readonly receiptPayload: Record<string, unknown>;
  readonly runsPayload: Record<string, unknown>;
  readonly basisMarkdown: string;
  readonly scenario: ScenarioMetadata;
}

interface CaptureClip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

class MemoryStore implements EventStore {
  constructor(private readonly records: StoredBenchEvent[] = []) {}

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

function parseArgs(argv: readonly string[]): CaptureOptions {
  let output = resolve(SCRATCHPAD_ROOT, "snapshot.png");
  let narrowOutput = resolve(SCRATCHPAD_ROOT, "snapshot-narrow.png");
  let metadataOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--output") {
      if (!value) throw new Error("missing value for --output");
      output = resolve(value);
      index += 1;
    } else if (arg === "--narrow-output") {
      if (!value) throw new Error("missing value for --narrow-output");
      narrowOutput = resolve(value);
      index += 1;
    } else if (arg === "--metadata-only") {
      metadataOnly = true;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  return { output, narrowOutput, metadataOnly };
}

interface ChargeObservation {
  readonly tenantId: string;
  readonly provider: "openai";
  readonly requestId: string;
  readonly chargedUsd: number;
  readonly source: "illustrative_scenario_provider_invoice_export";
  readonly observedAt: string;
  readonly dashboardEligible: boolean;
}

interface ScenarioMetadata {
  readonly fixedExampleSpendUsd: number;
  readonly actualProviderSpendUsd: number;
  readonly moneyLossUsd: number;
  readonly providerRecognizedUsd: number;
  readonly recognitionGapUsd: number;
  readonly timeLossMs: number;
  readonly invoiceCheckExposureUsd: number;
  readonly watchedSurfaces: number;
  readonly totalSurfaces: number;
  readonly exampleCalls: number;
  readonly exampleFindings: number;
  readonly moneyExampleCalls: number;
  readonly providerRecognizedBillingErrorCalls: number;
  readonly latencyExampleCalls: number;
  readonly invoiceExposureExampleCalls: number;
  readonly fillerExampleCalls: number;
  readonly cacheReadExposureTokens: number;
  readonly externalAuditRate: number;
  readonly externalAuditReviewedSpendUsd: number;
  readonly externalAuditOverchargeUsd: number;
  readonly historicallyCreditedWhenDisputedRate: number;
  readonly generatedAt: string;
}

interface ScenarioBuild {
  readonly records: readonly StoredBenchEvent[];
  readonly chargeObservations: readonly ChargeObservation[];
  readonly metadata: Omit<
    ScenarioMetadata,
    "actualProviderSpendUsd" | "moneyLossUsd" | "providerRecognizedUsd" | "recognitionGapUsd" | "timeLossMs" | "invoiceCheckExposureUsd" | "watchedSurfaces" | "totalSurfaces" | "exampleFindings"
  >;
}

const scenarioGeneratedAt = "2026-07-20T04:58:22.000Z";
const scenarioPeriodSince = new Date("2026-07-01T00:00:00.000Z");
const scenarioPeriodUntil = new Date("2026-07-31T23:59:59.000Z");
const scenarioTenantId = "tenant-projhero-example";
const scenarioProvider = "openai" as const;
const scenarioModel = "gpt-5.5";
const fixedExampleSpendUsd = 49_673.82;
const exampleCallCount = 1_270;
const moneyExampleCalls = 62;
const latencyExampleCalls = 43;
const invoiceExposureExampleCalls = 24;
const externalAuditReviewedSpendUsd = 34_000_000;
const externalAuditOverchargeUsd = 1_700_000;
const externalAuditRate = externalAuditOverchargeUsd / externalAuditReviewedSpendUsd;
const historicallyCreditedWhenDisputedRate = 0.8;
const providerRecognizedBillingErrorCalls = Math.round(moneyExampleCalls * historicallyCreditedWhenDisputedRate);
const openAiGpt55FullInputUsdPerMillion = 5;
const openAiGpt55CacheReadUsdPerMillion = 0.5;
const millisecondsPerHour = 60 * 60 * 1000;
const defaultTimeValueUsdPerHour = SLA_DEFAULTS.timeValueRate.usdPerHour;

async function projectionPayloads(): Promise<ProjectionPayloads> {
  const scenario = buildIllustrativeScenario();
  const chargeObservationFile = resolve(SCRATCHPAD_ROOT, ".inferock-bench-projection-capture/charge-observations.jsonl");
  await mkdir(dirname(chargeObservationFile), { recursive: true });
  await writeFile(
    chargeObservationFile,
    `${scenario.chargeObservations.map((observation) => JSON.stringify(observation)).join("\n")}\n`,
    "utf8",
  );

  const config: BenchConfig = {
    benchKey,
    coverageTest: { chargeObservationFile },
  };
  const baseSummary = summarizeBenchEvents(scenario.records, {
    since: scenarioPeriodSince,
    until: scenarioPeriodUntil,
    runId,
  }, { config });
  const projection = illustrativeProjection();
  const summary: BenchSummary = {
    ...baseSummary,
    illustrativeProjection: projection,
  };
  const receiptBundle: ReceiptBundle = {
    ...createReceiptBundle(summary),
    title: `Illustrative example - ${formatUsd(summary.providerSpendUsd)}/mo spend`,
    generatedAt: scenarioGeneratedAt,
    illustrativeProjection: projection,
  };
  const metadata: ScenarioMetadata = {
    ...scenario.metadata,
    actualProviderSpendUsd: summary.providerSpendUsd,
    moneyLossUsd: summary.moneyTotals.standardLossUsd,
    providerRecognizedUsd: summary.moneyTotals.providerRecognizedUsd,
    recognitionGapUsd: summary.moneyTotals.recognitionGapUsd,
    timeLossMs: summary.durationTotals.timeLossMs,
    invoiceCheckExposureUsd: invoiceCheckExposureAmount(summary),
    watchedSurfaces: summary.coverage.watchedCount,
    totalSurfaces: summary.coverage.totalSurfaceCount,
    exampleFindings: summary.failureCount,
  };

  assertScenarioShape(metadata, summary);

  const setup = {
    maskedBenchKey: null,
    canRevealBenchKey: false,
    benchKeySource: "missing",
    configPath: null,
    providers: {
      openai: { configured: false, source: null, maskedKey: null, providerApiBaseUrl: "https://api.openai.com/v1" },
      anthropic: { configured: false, source: null, maskedKey: null, providerApiBaseUrl: "https://api.anthropic.com" },
      gemini: { configured: false, source: null, maskedKey: null, providerApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta" },
      openrouter: { configured: false, source: null, maskedKey: null, providerApiBaseUrl: "https://openrouter.ai/api/v1" },
    },
  };

  return {
    summaryPayload: { summary, setup, dashboardState: "calls-flowing" },
    rowsPayload: { rows: summary.rows },
    callsPayload: { limit: 8, calls: [] },
    receiptPayload: { bundle: receiptBundle, compactText: renderReceipt(receiptBundle, true) },
    runsPayload: {
      runs: [{
        runId,
        status: "completed",
        startedAt: scenarioGeneratedAt,
        endedAt: scenarioGeneratedAt,
        receiptReady: true,
        selectedModels: [],
        measuredCalls: summary.measuredCalls,
        standardLossUsd: summary.moneyTotals.standardLossUsd,
      }],
    },
    basisMarkdown: projectionBasisMarkdown(metadata),
    scenario: metadata,
  };
}

function illustrativeProjection(): BenchSummary["illustrativeProjection"] {
  return {
    label: "Illustrative example - synthetic scenario through the real bench pipeline",
    projectionLine: "Scenario-through-pipeline: example calls pass through the standard cache reconciliation, latency, and invoice-exposure detectors.",
    recoverableLine: "Money loss, time loss, and invoice-check exposure come from separate example call classes and are aggregated by the receipt pipeline.",
    sourceLine: "Basis: independent third-party billing-audit inputs plus public latency throughput/SLA thresholds; source links and caveats are one click away.",
    precisionLine: "Cents and seconds are pipeline aggregates from example calls, not hidden source precision.",
    notMeasuredLine: "Not measured by Inferock, not a guarantee, not a bill audit.",
    basisLinkText: "See the basis ->",
    basisHref: "/projection-basis",
    actualRunsLinkText: "See newest measured run ->",
    actualRuns: [
      {
        label: "Public run card: 2026-07-10",
        href: "https://github.com/inferock/inferock-bench/blob/main/docs/public-run-2026-07-10.md",
      },
    ],
  };
}

function buildIllustrativeScenario(): ScenarioBuild {
  const records: StoredBenchEvent[] = [];
  const chargeObservations: ChargeObservation[] = [];
  let eventIndex = 0;

  const addRecord = (event: CanonicalEventV2, suiteTaskId: string): void => {
    records.push(storedScenarioEvent(event, eventIndex, suiteTaskId));
    eventIndex += 1;
  };

  for (let index = 0; index < moneyExampleCalls; index += 1) {
    const requestId = scenarioRequestId("cache-charge", index);
    const cacheCreationTokens = 12_400_000 +
      ((index * 317_111) % 4_700_000) +
      ((index % 6) * 53_219);
    const event = scenarioEvent({
      requestId,
      index: eventIndex,
      cacheCreationTokens,
      latencyMs: 1_200 + (index % 5) * 90,
    });
    const expectedChargeUsd = estimateScenarioCostUsd(event);
    const overchargeRate = 0.445 + (((index * 17) % 9) * 0.011) + ((index % 4) * 0.0027);
    const invoiceSurchargeUsd = ((index % 5) + 1) * 0.013;
    chargeObservations.push({
      tenantId: scenarioTenantId,
      provider: scenarioProvider,
      requestId,
      chargedUsd: roundUsd((expectedChargeUsd * (1 + overchargeRate)) + invoiceSurchargeUsd),
      source: "illustrative_scenario_provider_invoice_export",
      observedAt: scenarioGeneratedAt,
      dashboardEligible: index < providerRecognizedBillingErrorCalls,
    });
    addRecord(event, "shared_prefix_cache");
  }

  let cacheReadTokens = 0;
  for (let index = 0; index < invoiceExposureExampleCalls; index += 1) {
    const tokens = 8_900_000 +
      ((index * 811_009) % 6_700_000) +
      ((index % 5) * 133_337);
    cacheReadTokens += tokens;
    addRecord(scenarioEvent({
      requestId: scenarioRequestId("cache-read", index),
      index: eventIndex,
      cacheReadTokens: tokens,
      latencyMs: 1_400 + (index % 3) * 80,
    }), "shared_prefix_cache");
  }

  for (let index = 0; index < latencyExampleCalls; index += 1) {
    const outputTokens = 110 + ((index * 37) % 280);
    const excessMs = 7_900 + ((index * 2_653) % 17_200) + ((index % 6) * 417);
    const acceptableMs = 10_000 + outputTokens * 23;
    addRecord(scenarioEvent({
      requestId: scenarioRequestId("latency", index),
      index: eventIndex,
      inputTokens: 700 + (index % 6) * 17,
      outputTokens,
      latencyMs: acceptableMs + excessMs,
    }), "provider_latency_slo");
  }

  const fillerExampleCalls = exampleCallCount - records.length;
  if (fillerExampleCalls <= 0) throw new Error(`example call count ${exampleCallCount} leaves no normal traffic calls`);
  let remainingProviderSpendUsd = roundUsd(fixedExampleSpendUsd - providerSpendUsd(records, chargeObservations));
  if (remainingProviderSpendUsd <= 0) {
    throw new Error(`forward money/exposure/latency calls exceeded fixed spend premise by ${formatUsd(Math.abs(remainingProviderSpendUsd))}`);
  }
  for (let index = 0; index < fillerExampleCalls; index += 1) {
    const remainingCalls = fillerExampleCalls - index;
    const eventUsd = remainingCalls === 1
      ? remainingProviderSpendUsd
      : normalTrafficSpendUsd(remainingProviderSpendUsd, remainingCalls, index);
    const cacheCreationTokens = Math.max(1, Math.round(eventUsd / openAiGpt55FullInputUsdPerMillion * 1_000_000));
    const event = scenarioEvent({
      requestId: scenarioRequestId("normal", index),
      index: eventIndex,
      cacheCreationTokens,
      latencyMs: 1_300 + (index % 7) * 35,
    });
    remainingProviderSpendUsd = roundUsd(remainingProviderSpendUsd - estimateScenarioCostUsd(event));
    addRecord(event, "normal_traffic");
  }

  return {
    records,
    chargeObservations,
    metadata: {
      fixedExampleSpendUsd,
      exampleCalls: exampleCallCount,
      moneyExampleCalls,
      providerRecognizedBillingErrorCalls,
      latencyExampleCalls,
      invoiceExposureExampleCalls,
      fillerExampleCalls,
      cacheReadExposureTokens: cacheReadTokens,
      externalAuditRate,
      externalAuditReviewedSpendUsd,
      externalAuditOverchargeUsd,
      historicallyCreditedWhenDisputedRate,
      generatedAt: scenarioGeneratedAt,
    },
  };
}

function normalTrafficSpendUsd(remainingSpendUsd: number, remainingCalls: number, index: number): number {
  const baselineUsd = remainingSpendUsd / remainingCalls;
  const jitterUsd = (((index % 17) - 8) * 0.043) + (((index * 7) % 5) * 0.006);
  const minimumFutureSpendUsd = (remainingCalls - 1) * 0.000005;
  return Math.max(
    0.000005,
    Math.min(remainingSpendUsd - minimumFutureSpendUsd, baselineUsd + jitterUsd),
  );
}

function scenarioEvent(input: {
  readonly requestId: string;
  readonly index: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly latencyMs: number;
}): CanonicalEventV2 {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  const cacheCreationTokens = input.cacheCreationTokens ?? 0;
  const startedAt = addMs("2026-07-01T12:00:00.000Z", input.index * 47_000);
  const endedAt = addMs(startedAt, input.latencyMs);
  const responseContent = outputTokens > 0 ? " ping".repeat(outputTokens).trim() : "completed";
  return {
    schemaVersion: "v2",
    request: {
      tenantId: scenarioTenantId,
      provider: scenarioProvider,
      requestId: input.requestId,
      requestedModel: scenarioModel,
      model: scenarioModel,
      attemptIndex: 0,
      expectCompletion: true,
      route: "responses",
      workloadClass: "interactive",
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: responseContent,
      servedModel: scenarioModel,
    },
    usage: {
      input: inputTokens,
      output: outputTokens,
      cache: {
        read: cacheReadTokens,
        creation: cacheCreationTokens,
      },
      categories: [],
      usageSource: "provider",
    },
    timing: {
      startedAt,
      endedAt,
      latencyMs: input.latencyMs,
      chunkCount: outputTokens > 0 ? 4 : 0,
      terminalStatus: "complete",
    },
    attempts: [{
      attemptNumber: 0,
      provider: scenarioProvider,
      model: scenarioModel,
      status: "success",
      timing: {
        startedAt,
        endedAt,
        latencyMs: input.latencyMs,
      },
      finalSelected: true,
    }],
  };
}

function storedScenarioEvent(event: CanonicalEventV2, index: number, suiteTaskId: string): StoredBenchEvent {
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: addMs(event.timing.endedAt, 50),
    runId,
    suiteTaskId,
    event,
  };
}

function providerSpendUsd(
  records: readonly StoredBenchEvent[],
  chargeObservations: readonly ChargeObservation[],
): number {
  const chargeByRequestId = new Map(chargeObservations.map((observation) => [observation.requestId, observation.chargedUsd]));
  return roundUsd(records.reduce((total, record) => {
    const observedChargeUsd = chargeByRequestId.get(record.event.request.requestId);
    return total + (observedChargeUsd ?? estimateScenarioCostUsd(record.event));
  }, 0));
}

function estimateScenarioCostUsd(event: StoredBenchEvent["event"] | CanonicalEventV2): number {
  return estimateCostUsd(normalizeCanonicalEvent(event));
}

function invoiceCheckExposureAmount(summary: BenchSummary): number {
  return roundUsd(summary.exposures.reduce((total, exposure) => total + exposure.amount, 0));
}

function projectionMoneySplit(metadata: Pick<ScenarioMetadata, "moneyLossUsd" | "providerRecognizedUsd" | "recognitionGapUsd">): {
  readonly total: string;
  readonly providerRecognized: string;
  readonly recognitionGap: string;
  readonly cents: {
    readonly total: number;
    readonly providerRecognized: number;
    readonly recognitionGap: number;
  };
} {
  const split = reconciledUsdPartition({
    total: metadata.moneyLossUsd,
    parts: [
      { key: "providerRecognized", value: metadata.providerRecognizedUsd },
      { key: "recognitionGap", value: metadata.recognitionGapUsd },
    ],
    fractionDigits: 2,
  });
  return {
    total: split.total,
    providerRecognized: split.parts.providerRecognized,
    recognitionGap: split.parts.recognitionGap,
    cents: {
      total: displayCents(split.total),
      providerRecognized: displayCents(split.parts.providerRecognized),
      recognitionGap: displayCents(split.parts.recognitionGap),
    },
  };
}

function displayCents(value: string): number {
  return Math.round(Number(value.replace(/[$,]/gu, "")) * 100);
}

function assertScenarioShape(metadata: ScenarioMetadata, summary: BenchSummary): void {
  if (formatUsd(metadata.actualProviderSpendUsd) !== formatUsd(fixedExampleSpendUsd)) {
    throw new Error(`provider spend ${formatUsd(metadata.actualProviderSpendUsd)} did not match fixed input premise ${formatUsd(fixedExampleSpendUsd)}`);
  }
  if (summary.measuredCalls !== exampleCallCount) {
    throw new Error(`example call count ${summary.measuredCalls} did not match forward scenario count ${exampleCallCount}`);
  }
  if (metadata.moneyLossUsd <= 0 || metadata.invoiceCheckExposureUsd <= 0 || metadata.timeLossMs <= 0) {
    throw new Error(`forward outputs must be positive: ${JSON.stringify({
      moneyLossUsd: metadata.moneyLossUsd,
      invoiceCheckExposureUsd: metadata.invoiceCheckExposureUsd,
      timeLossMs: metadata.timeLossMs,
    })}`);
  }
  const moneyShare = metadata.moneyLossUsd / metadata.actualProviderSpendUsd;
  if (moneyShare < 0.035 || moneyShare > 0.065) {
    throw new Error(`money-loss share ${(moneyShare * 100).toFixed(3)}% is outside the external-audit class guard`);
  }
  if (metadata.providerRecognizedBillingErrorCalls <= 0 || metadata.providerRecognizedBillingErrorCalls >= metadata.moneyExampleCalls) {
    throw new Error(`provider-recognized billing-error calls must be a sub-portion of money example calls: ${JSON.stringify({
      providerRecognizedBillingErrorCalls: metadata.providerRecognizedBillingErrorCalls,
      moneyExampleCalls: metadata.moneyExampleCalls,
    })}`);
  }
  if (metadata.providerRecognizedUsd <= 0 || metadata.providerRecognizedUsd >= metadata.moneyLossUsd) {
    throw new Error(`estimated recoverable must be an organic non-zero sub-portion of money loss: ${JSON.stringify({
      providerRecognizedUsd: metadata.providerRecognizedUsd,
      moneyLossUsd: metadata.moneyLossUsd,
    })}`);
  }
  if (formatUsd(metadata.recognitionGapUsd) !== formatUsd(metadata.moneyLossUsd - metadata.providerRecognizedUsd)) {
    throw new Error(`recognition gap ${formatUsd(metadata.recognitionGapUsd)} should equal money loss minus estimated recoverable ${formatUsd(metadata.moneyLossUsd - metadata.providerRecognizedUsd)}`);
  }
  const displayedMoneySplit = projectionMoneySplit(metadata);
  if (
    displayedMoneySplit.cents.providerRecognized +
      displayedMoneySplit.cents.recognitionGap !==
    displayedMoneySplit.cents.total
  ) {
    throw new Error(`displayed money split does not reconcile: ${JSON.stringify(displayedMoneySplit)}`);
  }
  if (formatUsd(metadata.moneyLossUsd) === formatUsd(metadata.invoiceCheckExposureUsd)) {
    throw new Error(`money loss and invoice exposure should be distinct, both were ${formatUsd(metadata.moneyLossUsd)}`);
  }
  if (
    formatUsd(metadata.moneyLossUsd) === "$2,483.71" ||
    metadata.timeLossMs === 862_137 ||
    formatUsd(metadata.invoiceCheckExposureUsd) === "$1,906.40"
  ) {
    throw new Error("forward outputs still equal the rejected directive example figures");
  }
}

function projectionBasisMarkdown(metadata: ScenarioMetadata): string {
  const moneyShare = metadata.moneyLossUsd / metadata.actualProviderSpendUsd * 100;
  const cacheDelta = openAiGpt55FullInputUsdPerMillion - openAiGpt55CacheReadUsdPerMillion;
  const moneySplit = projectionMoneySplit(metadata);
  return [
    "# Projection Basis",
    "",
    "This page documents the illustrative scenario shown in the hero receipt. It is not a customer account measurement, guarantee, or bill audit.",
    "",
    "## Forward Chain",
    "",
    `- Fixed user-chosen input premise: ${formatUsd(metadata.fixedExampleSpendUsd)}/mo example spend.`,
    `- Scenario call count chosen before aggregation: ${metadata.exampleCalls} total example calls = ${metadata.moneyExampleCalls} billing-error calls + ${metadata.latencyExampleCalls} latency calls + ${metadata.invoiceExposureExampleCalls} cache-read exposure calls + ${metadata.fillerExampleCalls} normal traffic calls.`,
    "- The billing-error, latency, and cache-read exposure calls are generated first from fixed formulas. Their money loss, time loss, and invoice-check exposure outputs are then accepted as pipeline aggregates.",
    "- Normal traffic calls are the only balancing class. They consume the remaining spend so the receipt title matches the fixed spend premise; they do not carry loss or exposure signals.",
    "- No parameter is adjusted toward a loss, time, or exposure output after the real bench pipeline aggregates the scenario.",
    "",
    "## Scenario Output",
    "",
    `- Title-line spend scale: ${formatUsd(metadata.actualProviderSpendUsd)}/mo.`,
    `- Example calls: ${metadata.exampleCalls}. Real customer calls measured by this scenario: 0.`,
    `- Money loss: ${moneySplit.total} aggregated from ${metadata.moneyExampleCalls} cache charge-observation example calls.`,
    `- Estimated recoverable money: ${moneySplit.providerRecognized}; money recognition gap: ${moneySplit.recognitionGap}.`,
    `- Time loss: ${formatSeconds(metadata.timeLossMs)} (${formatApproxMinutes(metadata.timeLossMs)}) aggregated from ${metadata.latencyExampleCalls} latency example calls.`,
    `- Invoice-check exposure: ${formatUsd(metadata.invoiceCheckExposureUsd)} aggregated from ${metadata.invoiceExposureExampleCalls} cache-read example calls.`,
    `- Surfaces watched: ${metadata.watchedSurfaces} / ${metadata.totalSurfaces}; this is the bench coverage summary for this example event set.`,
    `- Approx at your rate: ${formatUsd(metadata.timeLossMs / millisecondsPerHour * defaultTimeValueUsdPerHour)} from ${formatSeconds(metadata.timeLossMs)} at the local default ${formatUsd(defaultTimeValueUsdPerHour)}/hr time-value assumption.`,
    "",
    "## Money-Loss Calibration",
    "",
    `- External audit anchor: public reports cite roughly ${formatUsd(metadata.externalAuditOverchargeUsd)} in overcharges across ${formatUsd(metadata.externalAuditReviewedSpendUsd)} of reviewed AI spend.`,
    `- Derived class-of-spend incidence: ${formatUsd(metadata.externalAuditOverchargeUsd)} / ${formatUsd(metadata.externalAuditReviewedSpendUsd)} = ${(metadata.externalAuditRate * 100).toFixed(1)}%.`,
    "- Forward scenario class: 62 cache-creation invoice rows use cache-write token counts `12,400,000 + ((i * 317,111) mod 4,700,000) + ((i mod 6) * 53,219)` and overcharge multipliers `44.5% + (((i * 17) mod 9) * 1.1pp) + ((i mod 4) * 0.27pp)`, plus a small invoice-line surcharge.",
    `- Pipeline result: ${formatUsd(metadata.moneyLossUsd)} / ${formatUsd(metadata.actualProviderSpendUsd)} = ${moneyShare.toFixed(3)}%, inside the external-audit 5% class.`,
    `- Estimated recoverable calibration: the cited audit reports roughly ${(metadata.historicallyCreditedWhenDisputedRate * 100).toFixed(0)}% credited when customers disputed; ${metadata.moneyExampleCalls} x ${(metadata.historicallyCreditedWhenDisputedRate * 100).toFixed(0)}% = ${metadata.moneyExampleCalls * metadata.historicallyCreditedWhenDisputedRate}, rounded to ${metadata.providerRecognizedBillingErrorCalls} provider-recognized billing-error rows.`,
    `- Estimated recoverable shape: those ${metadata.providerRecognizedBillingErrorCalls} rows set \`dashboardEligible: true\` on their observed invoice charge inputs, so the pipeline books their own overcharge deltas as estimated recoverable. The remaining ${metadata.moneyExampleCalls - metadata.providerRecognizedBillingErrorCalls} billing-error rows stay \`dashboardEligible: false\`, so their deltas remain in the recognition gap.`,
    `- Display split rule: the receipt rounds the total first, then allocates residual cents to split components by largest fractional remainder, so ${moneySplit.providerRecognized} + ${moneySplit.recognitionGap} = ${moneySplit.total}. Raw stored values remain exact: provider-recognized ${metadata.providerRecognizedUsd.toFixed(6)}; raw recognition gap ${metadata.recognitionGapUsd.toFixed(6)}.`,
    "- Pipeline path: synthetic cache-creation calls plus durable charge observations are fed to `summarizeBenchEvents`; the `CACHE_RATE_ANOMALY` row aggregates overcharge deltas. The total is not computed as spend times a rate in the renderer.",
    "",
    "## Time-Loss Calibration",
    "",
    "- No public AI billing audit rate for latency incidence was found. The scenario therefore states its own latency mix instead of claiming an external incidence rate.",
    "- Anchor: public provider materials describe latency/throughput service targets, for example 99% above token-per-second floors and 5-minute interval latency calculations. The local bench default for interactive streaming non-reasoning calls is `10s + outputTokens * 23ms`.",
    "- Forward scenario class: 43 successful latency calls use output tokens `110 + ((i * 37) mod 280)` and excess latency `7,900ms + ((i * 2,653) mod 17,200ms) + ((i mod 6) * 417ms)` above the local default.",
    `- Pipeline path: ${metadata.latencyExampleCalls} successful example calls exceed that local default by a total of ${metadata.timeLossMs.toLocaleString("en-US")}ms. The receipt reports duration loss only; estimated recoverable time stays 0 because no first-party credit basis is configured.`,
    `- Time-value translation visible in the receipt: ${metadata.timeLossMs.toLocaleString("en-US")}ms / ${millisecondsPerHour.toLocaleString("en-US")}ms per hour x ${formatUsd(defaultTimeValueUsdPerHour)}/hr = ${formatUsd(metadata.timeLossMs / millisecondsPerHour * defaultTimeValueUsdPerHour)}.`,
    "- The $92/hr default comes from `SLA_DEFAULTS.timeValueRate`, whose source note references BLS software-developer wage data and BLS private-industry benefit share. It remains editable in the product.",
    "",
    "## Invoice-Check Exposure Calibration",
    "",
    "- Exposure is separate from money loss. It is the cache-discount / billing-interpretation class that says what to verify against an invoice, not what to add to standard-loss dollars.",
    "- Forward scenario class: 24 cache-read calls use token counts `8,900,000 + ((i * 811,009) mod 6,700,000) + ((i mod 5) * 133,337)`.",
    `- Cache-read token total: ${metadata.cacheReadExposureTokens.toLocaleString("en-US")}.`,
    `- Pricing basis from the code-backed registry: ${scenarioModel} full input ${formatUsd(openAiGpt55FullInputUsdPerMillion)}/M tokens and cache read ${formatUsd(openAiGpt55CacheReadUsdPerMillion)}/M tokens, delta ${formatUsd(cacheDelta)}/M.`,
    `- Pipeline path: ${metadata.cacheReadExposureTokens.toLocaleString("en-US")} x ${formatUsd(cacheDelta)}/M = ${formatUsd(metadata.invoiceCheckExposureUsd)} via the native ` + "`CACHE_DISCOUNT_AT_RISK` exposure path.",
    "",
    "## Honesty Guards",
    "",
    "- Synthetic scenario calls are labeled as example calls/findings in the receipt render.",
    "- Real customer calls measured by this scenario: 0.",
    "- The banner and receipt title carry the visible illustrative disclosure. Per-card stamps were intentionally removed.",
    "- Competitor/provider names are omitted from the image; source names live here on the basis page.",
    "- Renderer-mode contract: a shippable illustrative export must carry an explicit illustrative marker in the data payload, not only a UI relabel, so exported JSON cannot masquerade as measured data.",
    "",
    "## Unsourced / Escalation Flags",
    "",
    "- Latency incidence has no public audit-rate source. This is an explicit scenario assumption anchored to public throughput/SLA thresholds and Inferock's local SLA-default method, not an externally measured incidence claim.",
    "- No customer-specific invoice evidence is present. Charge observations in this scenario are synthetic inputs used only to exercise the real bench aggregation path.",
    "",
    "## Citations",
    "",
    "- Business Wire, June 30, 2026: https://www.businesswire.com/news/home/20260630108235/en/Vaudit-Launches-TokenAudit-to-Recover-Millions-in-Enterprise-Token-Spend-Billing-Errors-From-Anthropic-OpenAI-and-AI-Providers",
    "- TechStartups / The Information re-report, June 25, 2026: https://techstartups.com/2026/06/25/anthropic-and-openai-customers-overcharged-by-1-7m-in-billing-errors-startup-audit-finds/",
    "- OpenAI Scale Tier: https://openai.com/api-scale-tier/",
    "- Azure OpenAI Priority processing latency target: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/priority-processing",
    "- Google Gemini Online Inference SLA: https://cloud.google.com/vertex-ai/generative-ai/sla",
    "- Amazon Bedrock service tiers: https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-service-tiers.html",
    "- BLS Occupational Outlook Handbook, Software Developers: https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm",
    "- BLS Employer Costs for Employee Compensation, March 2026: https://www.bls.gov/news.release/archives/ecec_06182026.pdf",
    "",
  ].join("\n");
}

function scenarioRequestId(prefix: string, index: number): string {
  return `projhero-${prefix}-${String(index + 1).padStart(4, "0")}`;
}

function addMs(startedAt: string, ms: number): string {
  return new Date(Date.parse(startedAt) + ms).toISOString();
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatSeconds(ms: number): string {
  const totalSeconds = Math.round(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function formatApproxMinutes(ms: number): string {
  return `~${(ms / 60_000).toFixed(1)} min`;
}

function requestFromIncoming(incoming: IncomingMessage): Request {
  const origin = `http://${incoming.headers.host ?? "127.0.0.1"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return new Request(new URL(incoming.url ?? "/", origin), {
    method: incoming.method ?? "GET",
    headers,
  });
}

function jsonFixture(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function markdownFixture(content: string): Response {
  return new Response(content, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

function fixtureResponse(url: URL, method: string, payloads: ProjectionPayloads): Response | undefined {
  if (method !== "GET") return undefined;
  if (url.pathname === "/projection-basis") return markdownFixture(payloads.basisMarkdown);
  if (url.pathname === "/api/summary") return jsonFixture(payloads.summaryPayload);
  if (url.pathname === "/api/rows") return jsonFixture(payloads.rowsPayload);
  if (url.pathname === "/api/calls") return jsonFixture(payloads.callsPayload);
  if (url.pathname === "/api/receipt") return jsonFixture(payloads.receiptPayload);
  if (url.pathname === "/api/coverage-test/runs") return jsonFixture(payloads.runsPayload);
  if (url.pathname === `/api/coverage-test/runs/${runId}/receipt`) return jsonFixture(payloads.receiptPayload);
  return undefined;
}

async function startProjectionServer(payloads: ProjectionPayloads): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const paths: BenchPaths = {
    homeDir: resolve(SCRATCHPAD_ROOT, ".inferock-bench-projection-capture"),
    configFile: resolve(SCRATCHPAD_ROOT, ".inferock-bench-projection-capture/config"),
    eventsFile: resolve(SCRATCHPAD_ROOT, ".inferock-bench-projection-capture/events.jsonl"),
    receiptsDir: resolve(SCRATCHPAD_ROOT, ".inferock-bench-projection-capture/receipts"),
  };
  const config: BenchConfig = { benchKey };
  const app = createBenchApp({
    config,
    paths,
    store: new MemoryStore(),
    env: { INFEROCK_BENCH_KEY: benchKey },
    log: () => undefined,
    managementAccessToken: projectionCaptureManagementAccessToken,
  });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = requestFromIncoming(incoming);
      const fixture = fixtureResponse(new URL(request.url), request.method, payloads);
      const response = fixture ?? await app.fetch(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : "projection capture server error");
    }
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: closeServer(server),
  };
}

function closeServer(server: Server): () => Promise<void> {
  return async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error?: Error) => error ? rejectClose(error) : resolveClose());
    });
  };
}

async function freezePage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const fixedNow = new Date("2026-07-20T02:24:49.000Z").getTime();
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) super(fixedNow);
        else super(...args);
      }
      static now() {
        return fixedNow;
      }
    }
    globalThis.Date = FixedDate as DateConstructor;
  });
}

async function openProjectionReceipt(page: Page, baseUrl: string, scenario: ScenarioMetadata): Promise<void> {
  const moneySplit = projectionMoneySplit(scenario);
  await freezePage(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("view-previous-results").click();
  await page.waitForSelector('[data-testid="done-state"]', { state: "visible" });
  await page.waitForFunction(() => document.body.dataset.stage === "done");
  await assertTestIdText(page, "illustrative-projection-label", "Illustrative example - synthetic scenario through the real bench pipeline");
  await assertTestIdText(page, "illustrative-projection-not-measured", "Not measured by Inferock, not a guarantee, not a bill audit.");
  await assertTestIdText(page, "spent-headline", formatUsd(scenario.actualProviderSpendUsd));
  await assertTestIdText(page, "money-headline-standard", moneySplit.total);
  await assertTestIdText(page, "time-headline", formatApproxTimeLost(scenario.timeLossMs));
  await assertTestIdText(page, "receipt-provider-recognized", moneySplit.providerRecognized);
  await assertTestIdText(page, "receipt-gap", moneySplit.recognitionGap);
  await assertTestIdText(page, "invoice-check-exposure-headline", formatUsd(scenario.invoiceCheckExposureUsd));
  await assertTestIdText(page, "receipt-invoice-check-exposure", formatUsd(scenario.invoiceCheckExposureUsd));
  await assertTestIdText(page, "receipt-calls", scenario.exampleCalls.toLocaleString("en-US"));
  await assertTestIdText(page, "receipt-provider-spend", formatUsd(scenario.actualProviderSpendUsd));
  await assertTestIdText(page, "projection-basis-link", "See the basis ->");
  await assertTestIdText(page, "actual-measured-runs-link", "See newest measured run ->");
  await page.waitForFunction(
    (expectedTitle) =>
      document.querySelector("#receiptLedgerTitle")?.textContent?.trim() === expectedTitle,
    `Illustrative example - ${formatUsd(scenario.actualProviderSpendUsd)}/mo spend`,
  );
  const visibleReceiptText = await page.locator("#doneStage").innerText();
  for (const forbidden of [
    "Projected",
    "projected",
    "Projection receipt",
    "Projection math",
    "Projection status",
    "Measured calls",
    "Measured failures",
    ["Already recognized by", "provider"].join(" "),
    "Provider recognized time",
  ]) {
    if (visibleReceiptText.includes(forbidden)) throw new Error(`visible receipt still includes forbidden copy: ${forbidden}`);
  }
  for (const requiredLabel of [
    "Estimated recoverable (our arithmetic)",
    "Estimated recoverable time (our arithmetic)",
    "provider spend observed (priced calls only)",
  ]) {
    if (!visibleReceiptText.includes(requiredLabel)) throw new Error(`visible receipt missing display MR label: ${requiredLabel}`);
  }
  const basisHref = await page.getByTestId("projection-basis-link").evaluate((link) => (link as HTMLAnchorElement).href);
  if (!basisHref || !basisHref.endsWith("/projection-basis")) throw new Error(`projection basis href is not local basis page: ${basisHref}`);
  const basisResponse = await page.request.get(basisHref);
  if (!basisResponse || !basisResponse.ok()) throw new Error(`projection basis link failed: ${basisHref}`);
  const basisText = await basisResponse.text();
  for (const expected of [
    formatUsd(scenario.moneyLossUsd),
    formatSeconds(scenario.timeLossMs),
    formatUsd(scenario.invoiceCheckExposureUsd),
    "Real customer calls measured by this scenario: 0",
    `Estimated recoverable money: ${moneySplit.providerRecognized}`,
    "Latency incidence has no public audit-rate source.",
    "No parameter is adjusted toward a loss, time, or exposure output",
  ]) {
    if (!basisText.includes(expected)) throw new Error(`basis page missing expected trace text: ${expected}`);
  }
}

async function applyStaticCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.dataset.staticCapture = "dashboard-real-traffic";
  });
  await page.evaluate(() => new Promise((resolveAnimation) => requestAnimationFrame(() => resolveAnimation(null))));
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.locator(".page").evaluate((element) => {
    const htmlElement = element as HTMLElement;
    return {
      scrollWidth: htmlElement.scrollWidth,
      clientWidth: htmlElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`page content overflowed horizontally: ${JSON.stringify(overflow)}`);
  }
  if (overflow.bodyScrollWidth > overflow.viewportWidth + 1) {
    throw new Error(`body overflowed horizontally: ${JSON.stringify(overflow)}`);
  }
}

async function assertTestIdText(page: Page, testId: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ targetTestId, expectedText }) =>
      document.querySelector(`[data-testid="${targetTestId}"]`)?.textContent?.trim() === expectedText,
    { targetTestId: testId, expectedText: expected },
  );
}

async function projectionClip(page: Page): Promise<CaptureClip> {
  return await page.locator("#doneStage").evaluate((stage) => {
    const stageElement = stage as HTMLElement;
    const actionCards = stageElement.querySelector("#actionCards") as HTMLElement | null;
    if (!actionCards) throw new Error("projection action cards missing");
    const padding = 16;
    const stageRect = stageElement.getBoundingClientRect();
    const actionRect = actionCards.getBoundingClientRect();
    const documentWidth = document.documentElement.scrollWidth;
    const x = Math.max(0, Math.floor(stageRect.left - padding));
    const y = Math.max(0, Math.floor(stageRect.top - padding));
    const right = Math.min(documentWidth, Math.ceil(stageRect.right + padding));
    const bottom = Math.ceil(actionRect.bottom + padding);
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  });
}

async function captureOne(input: {
  readonly baseUrl: string;
  readonly outputPath: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly staticCaptureMode?: boolean;
  readonly scenario: ScenarioMetadata;
}): Promise<Record<string, unknown>> {
  const browser = await playwright.chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({
      viewport: input.viewport,
      deviceScaleFactor,
    });
    await openProjectionReceipt(page, input.baseUrl, input.scenario);
    if (input.staticCaptureMode) await applyStaticCaptureMode(page);
    await assertNoHorizontalOverflow(page);
    const clip = await projectionClip(page);
    if (clip.width <= 0 || clip.height <= 0) throw new Error(`invalid projection clip ${JSON.stringify(clip)}`);
    await mkdir(dirname(input.outputPath), { recursive: true });
    await page.screenshot({ path: input.outputPath, fullPage: false, clip });
    const bytes = (await stat(input.outputPath)).size;
    if (bytes < 20_000) throw new Error(`projection screenshot too small: ${bytes} bytes`);
    const sha256 = createHash("sha256").update(await readFile(input.outputPath)).digest("hex");
    await page.close();
    return {
      outputPath: input.outputPath,
      sha256: `sha256:${sha256}`,
      bytes,
      cssDimensions: `${clip.width} x ${clip.height}`,
      pixelDimensions: `${clip.width * deviceScaleFactor} x ${clip.height * deviceScaleFactor}`,
      viewport: input.viewport,
      deviceScaleFactor,
      captureMethod: "Playwright screenshot of the real inferock-bench dashboard receipt renderer with illustrative scenario records passed through summarizeBenchEvents.",
    };
  } finally {
    await browser.close();
  }
}

async function main(options: CaptureOptions): Promise<void> {
  const payloads = await projectionPayloads();
  if (options.metadataOnly) {
    console.log(JSON.stringify({ scenario: payloads.scenario }, null, 2));
    return;
  }
  const server = await startProjectionServer(payloads);
  try {
    const baseUrl = `http://127.0.0.1:${server.port}/?token=${projectionCaptureManagementAccessToken}`;
    const desktop = await captureOne({
      baseUrl,
      outputPath: options.output,
      viewport: { width: 1280, height: 1900 },
      staticCaptureMode: true,
      scenario: payloads.scenario,
    });
    const narrow = await captureOne({
      baseUrl,
      outputPath: options.narrowOutput,
      viewport: { width: 390, height: 3600 },
      scenario: payloads.scenario,
    });
    console.log(JSON.stringify({ desktop, narrow, scenario: payloads.scenario }, null, 2));
  } finally {
    await server.close();
  }
}

await main(parseArgs(process.argv.slice(2)));
