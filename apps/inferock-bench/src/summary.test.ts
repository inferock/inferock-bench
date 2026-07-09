import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalEventAny, CanonicalEventV2 } from "@inferock/measure/canonical-event";
import { registerObservedCharge, resetBillingIntegrityState } from "@inferock/measure/billing-integrity";
import { SLA_DEFAULTS } from "@inferock/measure/sla-defaults";
import {
  createReceiptBundle,
  migrateReceiptBundle,
  renderReceipt,
} from "./receipt.js";
import { BENCH_RECEIPT_SCHEMA_VERSION, LEGACY_BENCH_RECEIPT_SCHEMA_VERSION } from "./receipt-schema.js";
import { buildReliabilityIndexPayload } from "./telemetry.js";
import {
  formatUsd,
  providerScopedCoverageTotalSurfaceCount,
  repriceLatencyRow,
  renderReport,
  summarizeBenchEvents,
  type BenchSummary,
} from "./summary.js";
import type { StoredBenchEvent } from "./storage.js";

const FAKE_OPENAI_SECRET =
  ["sk-proj", "aB3dE5gH7jK9mN2pQ4sT6vW8xY0zC1rD3fG5hJ7kL9mN2pQ4sT6vW8xY0zC1rD"].join("-");

describe("summary and receipt", () => {
  it("renders honest zero with no seeded rows", () => {
    const summary = summarizeBenchEvents([]);
    expect(summary.totalLostUsd).toBe(0);
    expect(summary.measuredCalls).toBe(0);
    expect(summary.rows).toEqual([]);
    expect(renderReport(summary)).toContain("measured 0 calls, 0 failures");

    const receipt = createReceiptBundle(summary);
    const rendered = renderReceipt(receipt, true);
    expect(rendered.split("\n")[0]).toBe("Money loss: $0.00");
    expect(rendered.split("\n")[1]).toBe("Time lost: ~0s");
    expect(rendered).toContain("failures observed are calls with problems");
    expect(rendered).toContain("loss signals are the rows below");
    expect(rendered).toContain("provider-recognized is what your provider already reported or credited");
    expect(rendered).toContain("Inferock Bench - https://inferock.opiusai.com");
  });

  it("standard-loss-summary-invariant: has no silent Math.max cost fallback", () => {
    const source = readFileSync(new URL("./summary.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Math.max(signal.costUsd");
    expect(source).not.toContain("return Math.max(signal.costUsd");
    expect(source).not.toMatch(/gap\s*>\s*0\s*\?/);
  });

  it("renders pricing unknown as add-model-price work, not zero-dollar no-loss", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-pricing-unknown-json",
          model: "missing-model-price",
          requestedModel: "missing-model-price",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
    ]);

    const report = renderReport(summary);
    expect(report).toContain("pricing unknown — add model price");
    expect(report).not.toContain("BROKEN_OUTPUT/broken_output | refundable_candidate | 1 | $0.00");
  });

  it("renders Gemini schema sanitization delta on broken-output receipts", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          provider: "gemini",
          providerPlane: "gemini_developer_api",
          requestId: "req-gemini-schema-delta",
          model: "gemini-2.5-flash-lite",
          requestedModel: "gemini-2.5-flash-lite",
          generation: {
            responseFormat: { type: "json_object" },
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
            },
            geminiSchemaSanitization: {
              provider: "gemini",
              source: "adapter_boundary",
              schemaDialect: "gemini_openapi_subset",
              sentSchemaIsCanonical: true,
              changes: [{
                path: "tools[0].functionDeclarations[0].parameters.additionalProperties",
                keyword: "additionalProperties",
                action: "removed",
                reason: "Gemini Developer API schema is a limited OpenAPI subset, not full JSON Schema.",
              }],
            },
          },
        },
        response: {
          content: "not json",
          servedModel: "gemini-2.5-flash-lite",
        },
        usage: {
          categories: [
            { category: "input", tokens: 100, provider: "gemini" },
            { category: "output", tokens: 10, provider: "gemini" },
          ],
          serviceTier: "standard",
        },
      })),
    ]);

    const brokenOutput = reportRow(summary, "BROKEN_OUTPUT");
    const deltaLine = brokenOutput?.howComputed.find((line) => line.startsWith("schema delta:"));
    expect(deltaLine).toContain("removed additionalProperties");
    expect(deltaLine).toContain("dollars judged against sent schema");

    const renderedReceipt = renderReceipt(createReceiptBundle(summary), true);
    expect(renderedReceipt).toContain("schema delta: Gemini adapter sanitized");
    expect(renderedReceipt).toContain("dollars judged against sent schema");
    expect(renderedReceipt).not.toContain("responseJsonSchema");
    expect(renderedReceipt).not.toContain("Review the short deployment note");
  });

  it("counts one published whole-call floor when an event-floor call is also a duplicate", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-broken-duplicate",
        },
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:00:01.000Z",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-broken-duplicate",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
        timing: {
          startedAt: "2026-06-14T12:01:00.000Z",
          endedAt: "2026-06-14T12:01:01.000Z",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-duplicate-only",
        },
        timing: {
          startedAt: "2026-06-14T12:02:00.000Z",
          endedAt: "2026-06-14T12:02:01.000Z",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-duplicate-only",
        },
        timing: {
          startedAt: "2026-06-14T12:03:00.000Z",
          endedAt: "2026-06-14T12:03:01.000Z",
        },
      })),
    ]);
    const receipt = createReceiptBundle(summary);
    const brokenOutput = reportRow(summary, "BROKEN_OUTPUT");
    const duplicate = reportRow(summary, "DUPLICATE_REQUEST_ID");

    expect(brokenOutput?.standardLossUsd).toBeGreaterThan(0);
    expect(duplicate?.count).toBe(2);
    expect(duplicate?.standardLossUsd).toBe(brokenOutput?.standardLossUsd);
    expect(duplicate?.recognitionGapUsd).toBe(duplicate?.standardLossUsd);
    expect(duplicate?.howComputed).toEqual(expect.arrayContaining([
      "call-cost floor already attributed once for this call",
    ]));
    expect(duplicate?.howComputed.some((line) =>
      line.includes("verify against your invoice")
    )).toBe(true);
    const otherRows = summary.rows.filter((row) =>
      row.code !== "BROKEN_OUTPUT" && row.code !== "DUPLICATE_REQUEST_ID"
    );
    const otherStandardLossUsd = roundUsd(sum(otherRows.map((row) => row.standardLossUsd)));
    const otherRecognitionGapUsd = roundUsd(sum(otherRows.map((row) => row.recognitionGapUsd)));
    expect(receipt.totals.money.standardLossUsd).toBe(roundUsd(
      otherStandardLossUsd + (brokenOutput?.standardLossUsd ?? 0) + (duplicate?.standardLossUsd ?? 0),
    ));
    expect(receipt.totals.money.recognitionGapUsd).toBe(roundUsd(
      otherRecognitionGapUsd + (brokenOutput?.recognitionGapUsd ?? 0) + (duplicate?.recognitionGapUsd ?? 0),
    ));
  });

  it("builds reliability-index payload with aggregate counts only", () => {
    const payload = buildReliabilityIndexPayload(summarizeBenchEvents([]));
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("failureCounts");
    expect(serialized).not.toContain("requestId");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("output");
    expect(serialized).not.toContain("key");
    expect(serialized).not.toContain("trace");
  });

  it("counts default latency breach as unrecognized standard loss", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-latency-standard-loss",
        },
        response: {
          content: "completed",
        },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          endedAt: "2026-06-14T12:01:27.700Z",
          latencyMs: 87_700,
        },
      })),
    ]);

    const row = reportRow(summary, "LATENCY_BILLED");
    const latencyDefaults = SLA_DEFAULTS.latencySegments.interactive_streaming_non_reasoning;
    expect(row).toMatchObject({
      failureClass: "latency",
      evidenceGrade: "unrecognized_standard_loss",
      count: 1,
      primaryValueKind: "time_loss",
      standardLossUsd: expect.any(Number),
      timeLossMs: 77_700,
      dollarTranslationUsd: expect.any(Number),
      providerRecognizedUsd: 0,
      recognitionGapUsd: expect.any(Number),
    });
    expect(row?.howComputed[0]).toContain("observed");
    expect(row?.howComputed[0]).toContain("provider-recognized $0.00");
    expect(row?.dollarTranslationUsd).toBeCloseTo(1.985667, 6);
    expect(row?.standardLossUsd).toBeCloseTo(1.985667, 6);
    expect(row?.recognitionGapUsd).toBeCloseTo(1.985667, 6);
    expect(row?.recognitionGapTimeMs).toBe(77_700);
    expect(summary.standardLossUsd).toBe(0);
    expect(summary.providerRecognizedUsd).toBe(0);
    expect(summary.recognitionGapUsd).toBe(0);
    expect(summary.unrecognizedUsd).toBe(0);
    expect(summary.totalLostUsd).toBe(0);
    expect(summary.durationTotals.timeLossMs).toBe(77_700);
    expect(summary.durationTotals.dollarTranslationUsd).toBeCloseTo(1.985667, 6);
    expect(summary.slaAssumptions.timeValueRate.usdPerHour)
      .toBe(SLA_DEFAULTS.timeValueRate.usdPerHour);
    expect(summary.slaAssumptions.activeLatencySegments).toMatchObject([{
      segmentId: "interactive_streaming_non_reasoning",
      thresholdSummary: expect.stringContaining(
        `${latencyDefaults.thresholds.acceptableStartMs / 1000}s`,
      ),
      oneLineWhy: latencyDefaults.oneLineWhy,
      overrideKey: latencyDefaults.overrideKey,
    }]);

    const latency = measure(summary, "provider_latency_slo");
    expect(latency).toMatchObject({
      verdict: "signal",
      evidenceGrade: "unrecognized_standard_loss",
      details: {
        segment: {
          segmentId: "interactive_streaming_non_reasoning",
        },
        thresholds: {
          acceptableStartMs: latencyDefaults.thresholds.acceptableStartMs,
          acceptableMsPerOutputToken: latencyDefaults.thresholds.acceptableMsPerOutputToken,
        },
        rate: {
          usdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
        },
      },
    });

    const report = renderReport(summary);
    expect(report).toContain("money loss so far");
    expect(report).toContain("time lost so far");
    expect(report).toContain("how computed: observed");
    expect(report).toContain(SLA_DEFAULTS.timeValueRate.oneLineWhy);
    expect(report).toContain(latencyDefaults.oneLineWhy);

    const renderedReceipt = renderReceipt(createReceiptBundle(summary), true);
    expect(renderedReceipt).toContain("duration loss");
    expect(renderedReceipt).toContain("surfaces watched");
    expect(renderedReceipt).toContain("surface | status | count | label");
    expect(renderedReceipt).toContain("Impact assumptions:");
    expect(renderedReceipt).toContain(latencyDefaults.overrideKey);
  });

  it("timequant-dual-ledger: keeps latency time out of money headline and renders dollar translation separately", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-latency-time-primary",
        },
        response: {
          content: "completed",
        },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          endedAt: "2026-06-14T12:01:30.000Z",
          latencyMs: 90_000,
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-money-native-json",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
    ]);

    const latency = reportRow(summary, "LATENCY_BILLED");
    const broken = reportRow(summary, "BROKEN_OUTPUT");
    expect(latency).toMatchObject({
      primaryValueKind: "time_loss",
      timeLossMs: 80_000,
      providerRecognizedTimeLossMs: 0,
      recognitionGapTimeMs: 80_000,
      dollarTranslationUsd: expect.any(Number),
      providerRecognitionLine:
        "Provider-recognized: no configured provider latency credit basis for this receipt",
      thresholdSnapshot: {
        acceptableStartMs: 10_000,
        acceptableMsPerOutputToken: 23,
        observedMs: 90_000,
        outputTokens: 0,
      },
      rateSnapshot: {
        usdPerHour: SLA_DEFAULTS.timeValueRate.usdPerHour,
      },
    });
    const repricedLatency = repriceLatencyRow(latency!, {
      threshold: { acceptableStartMs: 60_000, acceptableMsPerOutputToken: 0 },
    });
    expect(repricedLatency.timeLossMs).toBe(30_000);
    expect(repricedLatency.recognitionGapTimeMs).toBe(30_000);
    expect(repricedLatency.dollarTranslationUsd).toBeCloseTo(0.766667, 6);
    expect(broken).toMatchObject({
      primaryValueKind: "money",
      timeLossMs: 0,
      dollarTranslationUsd: null,
    });
    expect(summary.durationTotals.timeLossMs).toBe(80_000);
    expect(summary.durationTotals.dollarTranslationUsd).toBeCloseTo(latency?.dollarTranslationUsd ?? -1, 6);
    const moneyRows = summary.rows.filter((row) => row.primaryValueKind === "money");
    expect(summary.moneyTotals.standardLossUsd).toBeCloseTo(
      roundUsd(sum(moneyRows.map((row) => row.standardLossUsd))),
      6,
    );
    expect(summary.standardLossUsd).toBe(summary.moneyTotals.standardLossUsd);
    expect(summary.standardLossUsd).not.toBeCloseTo(
      (broken?.standardLossUsd ?? 0) + (latency?.dollarTranslationUsd ?? 0),
      6,
    );

    const receipt = createReceiptBundle(summary);
    expect(receipt.schemaVersion).toBe(BENCH_RECEIPT_SCHEMA_VERSION);
    expect(receipt.totals.money.standardLossUsd).toBe(summary.moneyTotals.standardLossUsd);
    expect(receipt.totals.duration.timeLossMs).toBe(80_000);
    expect(receipt.totals).not.toHaveProperty("totalLossUsd");
    const rendered = renderReceipt(receipt, true);
    expect(rendered.split("\n")[0]).toBe(`Money loss: ${formatUsd(summary.moneyTotals.standardLossUsd)}`);
    expect(rendered.split("\n")[1]).toBe("Time lost: ~1.3 min");
    expect(rendered).toContain("approx $");
    expect(rendered).not.toMatch(/total\s*=\s*money\s*\+\s*time/i);
  });

  it("timequant-downtime-cluster: reports clustered downtime duration and not single-call elapsed sums", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: { requestId: "req-good-before", operationId: "op-good-before" },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          startedAt: "2026-06-14T11:59:30.000Z",
          endedAt: "2026-06-14T11:59:31.000Z",
          latencyMs: 1_000,
        },
      })),
      stored(v2Event({
        request: { requestId: "req-down-1", operationId: "op-down-1" },
        response: {
          statusCode: 503,
          finishReason: "error",
          content: "provider unavailable",
          errorClass: "http_503:server_error",
          providerRequestId: "provider-req-down-1",
        },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:00:02.000Z",
          latencyMs: 2_000,
        },
      })),
      stored(v2Event({
        request: { requestId: "req-down-2", operationId: "op-down-2" },
        response: {
          statusCode: 503,
          finishReason: "error",
          content: "provider unavailable",
          errorClass: "http_503:server_error",
          providerRequestId: "provider-req-down-2",
        },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          startedAt: "2026-06-14T12:01:00.000Z",
          endedAt: "2026-06-14T12:01:03.000Z",
          latencyMs: 3_000,
        },
      })),
      stored(v2Event({
        request: { requestId: "req-good-after", operationId: "op-good-after" },
        usage: {
          input: 100,
          output: 0,
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
        timing: {
          startedAt: "2026-06-14T12:02:00.000Z",
          endedAt: "2026-06-14T12:02:01.000Z",
          latencyMs: 1_000,
        },
      })),
    ]);
    const row = summary.rows.find((entry) =>
      entry.code === "PROVIDER_DOWNTIME" && entry.primaryValueKind === "time_loss"
    );
    const moneyRow = summary.rows.find((entry) =>
      entry.code === "PROVIDER_DOWNTIME" && entry.primaryValueKind === "money"
    );

    expect(row).toMatchObject({
      primaryValueKind: "time_loss",
      timeLossMs: 63_000,
      providerRecognizedTimeLossMs: 0,
      recognitionGapTimeMs: 63_000,
      dollarTranslationUsd: expect.any(Number),
      providerRecognitionLine: "Provider-recognized: $0 / 0s - first-party credit terms unverified",
      thresholdSnapshot: {
        threshold: 0.05,
        thresholdSource: "inferock-default-provider-fault-rate-gemini-aligned",
        creditTermsVerified: false,
      },
      timeLossTrace: {
        methodId: "downtime_window_v1",
        windows: [{
          windowDurationMs: 63_000,
          evidenceGrade: "organic_sparse",
          lastGoodBefore: "2026-06-14T11:59:31.000Z",
          firstGoodAfter: "2026-06-14T12:02:00.000Z",
          uncertaintyEnvelopeMs: 149_000,
        }],
        unionWindows: [{
          durationMs: 63_000,
          provider: "openai",
          tenantId: "tenant-bench",
        }],
      },
    });
    expect(moneyRow).toMatchObject({
      primaryValueKind: "money",
      standardLossUsd: expect.any(Number),
      providerRecognizedUsd: 0,
    });
    expect(summary.durationTotals.timeLossMs).toBe(63_000);
    expect(summary.moneyTotals.standardLossUsd).toBeGreaterThan(0);
    expect(summary.standardLossUsd).toBe(summary.moneyTotals.standardLossUsd);
  });

  it("timequant-downtime-overlapping-provider-windows: unions wall-clock duration per provider and tenant", () => {
    const summary = summarizeBenchEvents([
      stored(downtimeV2Event("req-a-1", "op-a-1", "model-a", "2026-06-14T12:00:00.000Z", 1_000)),
      stored(downtimeV2Event("req-a-2", "op-a-2", "model-a", "2026-06-14T12:02:00.000Z", 1_000)),
      stored(downtimeV2Event("req-b-1", "op-b-1", "model-b", "2026-06-14T12:01:00.000Z", 1_000)),
      stored(downtimeV2Event("req-b-2", "op-b-2", "model-b", "2026-06-14T12:03:00.000Z", 1_000)),
    ]);

    const row = summary.rows.find((entry) =>
      entry.code === "PROVIDER_DOWNTIME" && entry.primaryValueKind === "time_loss"
    );
    expect(row?.timeLossTrace).toMatchObject({
      formula: "union_duration(clustered provider-owned unavailable windows)",
      windows: [
        { model: "model-a", windowDurationMs: 121_000 },
        { model: "model-b", windowDurationMs: 121_000 },
      ],
      unionWindows: [{
        tenantId: "tenant-bench",
        provider: "openai",
        windowStart: "2026-06-14T12:00:00.000Z",
        windowEnd: "2026-06-14T12:03:01.000Z",
        durationMs: 181_000,
      }],
    });
    expect(row?.timeLossMs).toBe(181_000);
    expect(summary.durationTotals.timeLossMs).toBe(181_000);
  });

  it("timequant-threshold-and-rate-edit-contract: threshold changes time and translation; rate changes translation only", () => {
    const row = {
      code: "LATENCY_BILLED",
      failureClass: "latency",
      evidenceGrade: "unrecognized_standard_loss",
      count: 1,
      standardLossUsd: 0,
      providerRecognizedUsd: 0,
      recognitionGapUsd: 0,
      unrecognizedUsd: 0,
      pricingUnknownCount: 0,
      howComputed: [],
      primaryValueKind: "time_loss" as const,
      timeLossMs: 110_000,
      providerRecognizedTimeLossMs: 0,
      recognitionGapTimeMs: 110_000,
      dollarTranslationUsd: 2.811111,
      thresholdSnapshot: {
        acceptableStartMs: 10_000,
        acceptableMsPerOutputToken: 23,
        outputTokens: 0,
        observedMs: 120_000,
      },
      rateSnapshot: {
        usdPerHour: 92,
      },
      timeLossTrace: {},
      providerRecognitionLine: "Provider-recognized: no configured provider latency credit basis for this receipt",
    };

    const thresholdEdited = repriceLatencyRow(row, {
      threshold: { acceptableStartMs: 90_000, acceptableMsPerOutputToken: 23 },
    });
    const rateEdited = repriceLatencyRow(row, {
      rateUsdPerHour: 184,
    });

    expect(thresholdEdited.timeLossMs).toBe(30_000);
    expect(thresholdEdited.recognitionGapTimeMs).toBe(30_000);
    expect(thresholdEdited.dollarTranslationUsd).toBeLessThan(row.dollarTranslationUsd ?? 0);
    expect(rateEdited.timeLossMs).toBe(row.timeLossMs);
    expect(rateEdited.recognitionGapTimeMs).toBe(row.recognitionGapTimeMs);
    expect(rateEdited.dollarTranslationUsd).toBeCloseTo((row.dollarTranslationUsd ?? 0) * 2, 6);

    const equalThreshold = repriceLatencyRow(row, {
      threshold: { acceptableStartMs: 120_000, acceptableMsPerOutputToken: 0 },
    });
    const belowThreshold = repriceLatencyRow(row, {
      threshold: { acceptableStartMs: 121_000, acceptableMsPerOutputToken: 0 },
    });
    expect(equalThreshold.timeLossMs).toBe(0);
    expect(equalThreshold.recognitionGapTimeMs).toBe(0);
    expect(equalThreshold.dollarTranslationUsd).toBe(0);
    expect(belowThreshold.timeLossMs).toBe(0);
    expect(belowThreshold.recognitionGapTimeMs).toBe(0);
    expect(belowThreshold.dollarTranslationUsd).toBe(0);
  });

  it("receipt-v2-migration-backcompat: loads v1 without treating legacy latency dollars as money headline", () => {
    const migrated = migrateReceiptBundle({
      schemaVersion: LEGACY_BENCH_RECEIPT_SCHEMA_VERSION,
      title: "legacy receipt",
      generatedAt: "2026-06-14T12:00:00.000Z",
      period: { since: null, until: "2026-06-14T12:00:00.000Z" },
      totals: {
        measuredCalls: 1,
        failures: 1,
        standardLossUsd: 2.3,
        totalLostUsd: 2.3,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 2.3,
        unrecognizedUsd: 2.3,
        providerSpendUsd: 0.01,
      },
      coverage: { surfaces: [], watchedCount: 0, totalSurfaceCount: 0, signalCount: 0, notOpenableCount: 0 },
      rows: [{
        code: "LATENCY_BILLED",
        failureClass: "latency",
        evidenceGrade: "unrecognized_standard_loss",
        count: 1,
        standardLossUsd: 2.3,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 2.3,
        unrecognizedUsd: 2.3,
        pricingUnknownCount: 0,
        howComputed: ["legacy latency dollarized under v1"],
      }],
      measures: [],
      assumptions: { standardVersion: "legacy", timeValueRate: { usdPerHour: 92, currency: "USD", unit: "hour", label: "legacy", oneLineWhy: "legacy", overrideKey: "legacy" }, activeLatencySegments: [], impactFooterLines: [] },
      watermark: { name: "Inferock Bench", url: "https://inferock.opiusai.com" },
    });

    expect(migrated.schemaVersion).toBe(BENCH_RECEIPT_SCHEMA_VERSION);
    expect(migrated.totals.legacyCombinedStandardLossUsd).toBe(2.3);
    expect(migrated.totals.money.standardLossUsd).toBe(0);
    expect(migrated.rows[0]).toMatchObject({
      primaryValueKind: "time_loss",
      dollarTranslationUsd: 2.3,
      legacyCompatibilityLabel: "legacy dollarized latency",
    });
    expect(renderReceipt(migrated, false)).toContain("compatibility: legacy dollarized latency");
  });

  it("receipt-v2-migration-legacy-downtime: labels legacy downtime dollars outside money headline", () => {
    const migrated = migrateReceiptBundle({
      schemaVersion: LEGACY_BENCH_RECEIPT_SCHEMA_VERSION,
      title: "legacy downtime receipt",
      generatedAt: "2026-06-14T12:00:00.000Z",
      period: { since: null, until: "2026-06-14T12:00:00.000Z" },
      totals: {
        measuredCalls: 2,
        failures: 1,
        standardLossUsd: 4.4,
        totalLostUsd: 4.4,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 4.4,
        unrecognizedUsd: 4.4,
        providerSpendUsd: 0.02,
      },
      coverage: { surfaces: [], watchedCount: 0, totalSurfaceCount: 0, signalCount: 0, notOpenableCount: 0 },
      rows: [{
        code: "PROVIDER_DOWNTIME",
        failureClass: "downtime",
        evidenceGrade: "organic_sparse",
        count: 1,
        standardLossUsd: 4.4,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 4.4,
        unrecognizedUsd: 4.4,
        pricingUnknownCount: 0,
        howComputed: ["legacy downtime dollarized under v1"],
      }],
      measures: [],
      assumptions: { standardVersion: "legacy", timeValueRate: { usdPerHour: 92, currency: "USD", unit: "hour", label: "legacy", oneLineWhy: "legacy", overrideKey: "legacy" }, activeLatencySegments: [], impactFooterLines: [] },
      watermark: { name: "Inferock Bench", url: "https://inferock.opiusai.com" },
    });

    expect(migrated.rows[0]).toMatchObject({
      primaryValueKind: "time_loss",
      standardLossUsd: 0,
      dollarTranslationUsd: 4.4,
      legacyCompatibilityLabel: "legacy dollarized downtime",
    });
    expect(migrated.totals.money.standardLossUsd).toBe(0);
    expect(migrated.totals.legacyCombinedStandardLossUsd).toBe(4.4);
    expect(renderReceipt(migrated, false)).toContain("compatibility: legacy dollarized downtime");
  });

  it("models coverage states and keeps legacy verdict compatibility", () => {
    resetBillingIntegrityState();
    const clean = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-clean",
        },
      })),
    ]);

    expect(measure(clean, "broken_output")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no JSON/schema output contract",
    });
    expect(measure(clean, "anthropic_token_crosscheck")).toMatchObject({
      status: "not_applicable",
      verdict: "not_exercised",
      notOpenableReason: "not applicable to non-Anthropic provider traffic",
    });
    expect(measure(clean, "duplicate_request_id")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no operation/idempotency evidence captured",
    });
    expect(measure(clean, "provider_latency_slo")).toMatchObject({
      status: "watched_clean",
      verdict: "exercised",
      label: "watched-clean: timing and usage observed with no latency/token signal",
      watchedEvidence: {
        timingAndUsageObserved: true,
        gatewayTotalLatencyObserved: true,
        providerElapsedObserved: false,
        gatewayTotalTimingEventCount: 1,
        providerElapsedTimingEventCount: 0,
      },
    });
    expect(measure(clean, "tool_call_validity")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no tool declarations and response tool evidence",
    });
    expect(measure(clean, "security_governance")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no passive security inspection evidence",
    });
    expect(measure(clean, "openai_content_filter")).toMatchObject({
      status: "watched_clean",
      verdict: "exercised",
      label: "watched-clean: OpenAI traffic inspected with no content-filter evidence",
    });
    expect(measure(clean, "stream_termination_evidence")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "not a streaming request",
    });
    expect(measure(clean, "retry_amplification")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no SDK/native retry evidence can be observed",
    });
    expect(measure(clean, "served_model_mismatch")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no provider-response served-model evidence",
    });
    expect(measure(clean, "cache_integrity")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "shared-prefix cache precondition not observed",
    });
    expect(measure(clean, "drift_regression")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no drift replay contract configured",
    });
    expect(measure(clean, "factuality")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no factuality contract or citation-support evidence captured",
    });
    expect(clean.coverage).toMatchObject({
      watchedCount: 2,
      totalSurfaceCount: 12,
      notOpenableCount: 10,
      notApplicableCount: 1,
    });

    const splitTiming = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-provider-elapsed",
        },
        timing: {
          providerRequestStartedAt: "2026-06-14T12:00:00.050Z",
          providerResponseEndedAt: "2026-06-14T12:00:00.950Z",
          providerElapsedMs: 900,
          gatewayOverheadMs: 100,
        },
      })),
    ]);
    expect(measure(splitTiming, "provider_latency_slo")).toMatchObject({
      status: "watched_clean",
      watchedEvidence: {
        gatewayTotalLatencyObserved: true,
        providerElapsedObserved: true,
        gatewayTotalTimingEventCount: 1,
        providerElapsedTimingEventCount: 1,
      },
    });
  });

  it("derives watched-clean coverage from carried preconditions", () => {
    resetBillingIntegrityState();
    registerObservedCharge({
      tenantId: "tenant-bench",
      provider: "openai",
      requestId: "req-cache",
      chargedUsd: 0.00001,
    });
    const watched = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-json-clean",
          generation: { response_format: { type: "json_object" } },
          outputSchemaVersion: "schema-json-clean",
        },
        response: { content: "{\"ok\":true}" },
      })),
      stored(v2Event({
        request: {
          requestId: "req-duplicate-clean",
          operationId: "bench-op-1",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-tool-clean",
          toolDeclarations: [toolDeclaration()],
        },
        response: {
          finishReason: "tool_calls",
          content: "",
          toolCalls: [openAiToolCall("{\"invoiceId\":\"inv-123\"}")],
          rawToolCalls: [openAiToolCall("{\"invoiceId\":\"inv-123\"}")],
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-security-clean",
          securityContext: requestSecurityContext(),
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-stream-clean",
          generation: { stream: true },
        },
        timing: {
          firstEventAt: "2026-06-14T12:00:00.100Z",
          firstContentDeltaAt: "2026-06-14T12:00:00.200Z",
          lastChunkAt: "2026-06-14T12:00:00.900Z",
          chunkCount: 3,
          terminalStatus: "complete",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-retry-clean",
          sanitizedHeaders: {
            "x-stainless-retry-count": "0",
          },
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-cache-shared-prefix",
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
      stored(v2Event({
        request: {
          requestId: "req-cache",
        },
        usage: {
          input: 0,
          output: 0,
          cache: { read: 20_000, creation: 0 },
          categories: [
            { category: "cached", tokens: 20_000, provider: "openai" },
          ],
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
      stored(driftReplayEvent("req-drift-clean")),
      stored(driftReplayEvent("req-drift-clean-repeat")),
      stored(v2Event({
        request: {
          requestId: "req-factuality-clean",
          factualityContract: knownAnswerContract(),
        },
        response: {
          content: "Paris",
        },
      })),
    ]);

    for (const rowKey of [
      "broken_output",
      "duplicate_request_id",
      "tool_call_validity",
      "security_governance",
      "openai_content_filter",
      "stream_termination_evidence",
      "retry_amplification",
      "factuality",
    ]) {
      expect(measure(watched, rowKey)).toMatchObject({
        status: "watched_clean",
        verdict: "exercised",
        count: 0,
      });
    }
    expect(measure(watched, "cache_integrity")).toMatchObject({
      status: "signal",
      verdict: "signal",
      count: 1,
      evidenceGrade: "unrecognized_standard_loss",
      signalCodes: expect.arrayContaining(["CACHE_DISCOUNT_AT_RISK"]),
    });
    expect(measure(watched, "drift_regression")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      notOpenableReason: "no drift replay contract configured",
      watchedEvidence: {
        driftReplayEvents: 2,
        completedReplayCalls: 2,
        driftContractConfigured: false,
      },
    });
    expect(watched.coverage.watchedCount).toBe(10);
    expect(renderReport(watched)).toContain("surfaces watched 10/12");
    expect(renderReport(watched)).toContain("Tool-call validity | watched-clean | 0");
    expect(renderReceipt(createReceiptBundle(watched), true)).toContain("surfaces watched 10/12");
  });

  it("opens drift coverage only with a declared replay contract and matcher threshold", () => {
    const watched = summarizeBenchEvents([
      stored(driftContractReplayEvent("req-drift-contract-1")),
      stored(driftContractReplayEvent("req-drift-contract-2")),
      stored(driftContractReplayEvent("req-drift-contract-3")),
    ]);

    expect(measure(watched, "drift_regression")).toMatchObject({
      status: "watched_clean",
      verdict: "exercised",
      evidenceGrade: "triage_only",
      label: "watched-clean: single-window repeat method (weaker than scheduled drift) - 3 repeats within threshold",
      details: {
        methodId: "identical_rerun_drift",
        methodVersion: "single_window_repeat_v1",
        evidenceGrade: "triage_only",
        weakerGrade: true,
        weakerThan: "scheduled_drift_replay",
        repeatCount: 3,
        matcher: "exact",
        threshold: 0,
      },
      watchedEvidence: {
        driftReplayEvents: 3,
        completedReplayCalls: 3,
        driftContractConfigured: true,
        repeatGroupId: "drift-repeat-group-1",
        matcher: "exact",
        threshold: 0,
        completedContractCalls: 3,
        matcherWithinThreshold: true,
      },
    });
  });

  it("does not open drift coverage from a partial or pre-baseline canary workload", () => {
    const watched = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-drift-canary",
          workloadClass: "drift_canary",
        },
        response: {
          content: "18",
        },
      })),
    ]);

    expect(measure(watched, "drift_regression")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      evidenceGrade: "not_applicable",
      label: "not-openable: drift canary baseline collecting (0/3)",
      notOpenableReason: "drift canary baseline collecting (0/3)",
      watchedEvidence: {
        driftCanaryEvents: 1,
        completedCanaryCalls: 1,
        fullCanaryItemCountRequired: 50,
        baselineRunCountRequired: 3,
        baselineRunsCompletedBeforeCurrent: 0,
        baselineEstablished: false,
        methodId: "per_model_known_answer_canary_v1",
      },
    });
  });

  it("opens drift coverage from bench config only with 3-5 same-window repeats within threshold", () => {
    const summary = summarizeBenchEvents([
      stored(driftReplayEvent("req-drift-config-1")),
      stored(driftReplayEvent("req-drift-config-2")),
      stored(driftReplayEvent("req-drift-config-3")),
      stored(driftReplayEvent("req-drift-config-4")),
      stored(driftReplayEvent("req-drift-config-5")),
    ], {}, {
      coverageTest: {
        driftReplayContract: {
          contractId: "bench-config-drift-contract",
          matcher: "exact",
          repeatGroupId: "bench-config-repeat-group",
          threshold: 0,
        },
      },
    });

    expect(measure(summary, "drift_regression")).toMatchObject({
      status: "watched_clean",
      verdict: "exercised",
      evidenceGrade: "triage_only",
      label: "watched-clean: single-window repeat method (weaker than scheduled drift) - 5 repeats within threshold",
      watchedEvidence: {
        driftReplayEvents: 5,
        completedReplayCalls: 5,
        driftContractConfigured: true,
        repeatGroupId: "bench-config-repeat-group",
        matcher: "exact",
        threshold: 0,
        completedContractCalls: 5,
        matcherWithinThreshold: true,
      },
    });

    const tooFewRepeats = summarizeBenchEvents([
      stored(driftReplayEvent("req-drift-config-1")),
      stored(driftReplayEvent("req-drift-config-2")),
    ], {}, {
      coverageTest: {
        driftReplayContract: {
          contractId: "bench-config-drift-contract",
          matcher: "exact",
          repeatGroupId: "bench-config-repeat-group",
          threshold: 0,
        },
      },
    });

    expect(measure(tooFewRepeats, "drift_regression")).toMatchObject({
      status: "not_openable",
      notOpenableReason: "drift replay contract requires 3-5 completed same-window repeats",
      watchedEvidence: {
        completedContractCalls: 2,
        matcherWithinThreshold: false,
      },
    });
  });

  it("reports signals for every shipped summary surface with detector evidence", () => {
    resetBillingIntegrityState();
    const wired = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-json-mode",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-tool-signal",
          toolDeclarations: [toolDeclaration()],
        },
        response: {
          finishReason: "tool_calls",
          content: "",
          toolCalls: [openAiToolCall("{\"status\":\"paid\"}")],
          rawToolCalls: [openAiToolCall("{\"status\":\"paid\"}")],
        },
      })),
      stored(v2Event({
        request: {
          provider: "anthropic",
          requestId: "req-anthropic-crosscheck",
          requestedModel: "claude-3-5-sonnet-20241022",
          model: "claude-3-5-sonnet-20241022",
        },
        response: {
          content: "ok",
          servedModel: "claude-3-5-sonnet-20241022",
        },
        usage: {
          input: 10,
          output: 100,
          categories: [
            { category: "input", tokens: 10, provider: "anthropic" },
            { category: "output", tokens: 100, provider: "anthropic" },
          ],
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-duplicate",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-duplicate",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-security",
        },
        response: {
          content: `The rotated provider credential is ${FAKE_OPENAI_SECRET}.`,
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-content-filter",
        },
        response: {
          finishReason: "content_filter",
          content: "",
        },
        usage: {
          input: 10,
          output: 0,
          categories: [
            { category: "input", tokens: 10, provider: "openai" },
            { category: "output", tokens: 0, provider: "openai" },
          ],
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-stream-gap",
          generation: { stream: true },
        },
        timing: {
          firstEventAt: "2026-06-14T12:00:00.100Z",
          firstContentDeltaAt: "2026-06-14T12:00:00.200Z",
          lastChunkAt: "2026-06-14T12:00:00.900Z",
          chunkCount: 2,
          terminalStatus: "unknown",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-retry",
          sanitizedHeaders: {
            "x-stainless-retry-count": "1",
          },
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-factuality-signal",
          factualityContract: knownAnswerContract(),
        },
        response: {
          content: "Lyon",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-served-model-mismatch",
          requestedModel: "gpt-5.4",
          model: "gpt-5.4",
        },
        response: {
          servedModel: "gpt-5.4-mini",
          servedModelSource: "provider_response",
        },
      })),
    ]);

    expect(measure(wired, "broken_output")).toMatchObject({ status: "signal", verdict: "signal", count: 1 });
    expect(measure(wired, "tool_call_validity")).toMatchObject({ status: "signal", verdict: "signal", count: 1 });
    expect(measure(wired, "anthropic_token_crosscheck"))
      .toMatchObject({ status: "signal", verdict: "signal", count: 1, evidenceGrade: "triage_only" });
    expect(measure(wired, "duplicate_request_id"))
      .toMatchObject({
        status: "signal",
        verdict: "signal",
        count: 1,
        evidenceGrade: "unrecognized_standard_loss",
      });
    expect(measure(wired, "security_governance"))
      .toMatchObject({
        status: "signal",
        verdict: "signal",
        count: 1,
        evidenceGrade: "unrecognized_standard_loss",
        signalCodes: expect.arrayContaining(["SECURITY_SECRET_EXACT_MATCH"]),
      });
    expect(measure(wired, "openai_content_filter"))
      .toMatchObject({ status: "signal", verdict: "signal", count: 1, evidenceGrade: "triage_only" });
    expect(measure(wired, "stream_termination_evidence"))
      .toMatchObject({ status: "signal", verdict: "signal", count: 1, evidenceGrade: "triage_only" });
    expect(measure(wired, "retry_amplification"))
      .toMatchObject({ status: "signal", verdict: "signal", count: 1, evidenceGrade: "triage_only" });
    expect(measure(wired, "factuality"))
      .toMatchObject({ status: "signal", verdict: "signal", count: 1, evidenceGrade: "unrecognized_standard_loss" });
    expect(measure(wired, "served_model_mismatch"))
      .toMatchObject({
        status: "signal",
        verdict: "signal",
        count: 1,
        evidenceGrade: "unrecognized_standard_loss",
      });
    expect(wired.coverage).toMatchObject({
      totalSurfaceCount: 13,
      notOpenableCount: 2,
    });
  });

  it("excludes cross-provider-only surfaces from per-provider denominators while listing them as not applicable", () => {
    const openai = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-openai-json",
          generation: { response_format: { type: "json_object" } },
        },
      })),
    ]);
    const anthropic = summarizeBenchEvents([
      stored(v2Event({
        request: {
          provider: "anthropic",
          requestId: "req-anthropic-json",
          requestedModel: "claude-haiku-4-5-20251001",
          model: "claude-haiku-4-5-20251001",
          generation: { response_format: { type: "json_schema" } },
          outputSchemaVersion: "coverage-suite-v1.config-facts",
        },
        response: {
          servedModel: "claude-haiku-4-5-20251001",
          content: "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}",
        },
      })),
    ]);
    const gemini = summarizeBenchEvents([
      stored(v2Event({
        request: {
          provider: "gemini",
          requestId: "req-gemini-json",
          requestedModel: "gemini-2.5-flash",
          model: "gemini-2.5-flash",
          route: "gemini.generateContent",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          servedModel: "gemini-2.5-flash",
          content: "{\"ok\":true}",
        },
      })),
    ]);

    expect(measure(openai, "anthropic_token_crosscheck")).toMatchObject({
      status: "not_applicable",
      label: "not-applicable: not applicable to non-Anthropic provider traffic",
    });
    expect(openai.coverage.totalSurfaceCount).toBe(12);
    expect(providerScopedCoverageTotalSurfaceCount(["openai"])).toBe(openai.coverage.totalSurfaceCount);
    expect(openai.coverage.surfaces).toHaveLength(13);
    expect(measure(anthropic, "openai_content_filter")).toMatchObject({
      status: "not_applicable",
      label: "not-applicable: not applicable to non-OpenAI provider traffic",
    });
    expect(measure(anthropic, "broken_output")).toMatchObject({
      status: "watched_clean",
      label: "watched-clean: JSON/schema contract completed with no finding",
    });
    expect(anthropic.coverage.totalSurfaceCount).toBe(12);
    expect(providerScopedCoverageTotalSurfaceCount(["anthropic"])).toBe(anthropic.coverage.totalSurfaceCount);
    expect(anthropic.coverage.surfaces).toHaveLength(13);
    expect(measure(gemini, "anthropic_token_crosscheck")).toMatchObject({ status: "not_applicable" });
    expect(measure(gemini, "openai_content_filter")).toMatchObject({ status: "not_applicable" });
    expect(gemini.coverage.totalSurfaceCount).toBe(11);
    expect(providerScopedCoverageTotalSurfaceCount(["gemini"])).toBe(gemini.coverage.totalSurfaceCount);
    expect(providerScopedCoverageTotalSurfaceCount(["openai", "anthropic"])).toBe(13);
  });

  it("dollarizes Anthropic citation contradictions from citation-support evidence", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          provider: "anthropic",
          requestedModel: "claude-3-5-sonnet-latest",
          model: "claude-3-5-sonnet-latest",
          generation: { citationsEnabled: true },
        },
        response: {
          content: "The answer is 41.",
          citations: [{
            provider: "anthropic",
            requested: true,
            returned: true,
            structuredOutputIncompatible: false,
            contentBlocks: [{
              index: 0,
              type: "text",
              text: "The answer is 41.",
              citations: [{
                type: "char_location",
                cited_text: "The answer is 42.",
                document_index: 0,
                document_title: "Recorded Citation Fixture",
                start_char_index: 0,
                end_char_index: 17,
              }],
            }],
          }],
        },
      })),
    ]);

    const row = reportRow(summary, "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT");
    expect(row).toMatchObject({
      failureClass: "factuality_contradiction",
      evidenceGrade: "unrecognized_standard_loss",
      count: 1,
      standardLossUsd: expect.any(Number),
      providerRecognizedUsd: 0,
      recognitionGapUsd: row?.standardLossUsd,
    });
    expect(measure(summary, "factuality")).toMatchObject({
      status: "signal",
      verdict: "signal",
      count: 1,
      evidenceGrade: "unrecognized_standard_loss",
      watchedEvidence: {
        factualityContractObserved: false,
        citationSupportObserved: true,
      },
    });
    expect(renderReceipt(createReceiptBundle(summary), true)).toContain(
      "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT/factuality_contradiction",
    );
  });

  it("ignores factuality contracts carried in the provider request body", () => {
    const bodyBorneContractEvent = {
      ...v2Event({
        request: { requestId: "req-factuality-body-borne" },
        response: { content: "Lyon" },
      }),
      body: {
        model: "gpt-4o-mini",
        factualityContract: knownAnswerContract(),
        messages: [{ role: "user", content: "What is the capital of France?" }],
      },
    } as unknown as CanonicalEventAny;

    const summary = summarizeBenchEvents([stored(bodyBorneContractEvent)]);

    expect(measure(summary, "factuality")).toMatchObject({
      status: "not_openable",
      verdict: "not_exercised",
      count: 0,
      signalCount: 0,
      notOpenableReason: "no factuality contract or citation-support evidence captured",
      watchedEvidence: { factualityContractObserved: false, citationSupportObserved: false },
    });
  });

  it("counts tool-call validity signals by distinct calls rather than signal codes", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-tool-one-call-two-codes",
          toolDeclarations: [
            toolDeclaration({
              toolChoice: { type: "function", function: { name: "lookup_invoice" } },
            }),
          ],
        },
        response: {
          finishReason: "tool_calls",
          content: "",
          toolCalls: [openAiToolCall("{\"status\":\"paid\"}", "lookup_customer")],
          rawToolCalls: [openAiToolCall("{\"status\":\"paid\"}", "lookup_customer")],
        },
      })),
    ]);

    expect(measure(summary, "tool_call_validity")).toMatchObject({
      status: "signal",
      verdict: "signal",
      count: 1,
      signalCount: 1,
      label: "1 invalid tool call observed",
    });
  });

  it("identifies OpenAI Responses tool-call validity separately from Chat openability", () => {
    const chatSummary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-tool-chat-clean",
          toolDeclarations: [toolDeclaration()],
        },
        response: {
          finishReason: "tool_calls",
          content: "",
          toolCalls: [openAiToolCall("{\"invoiceId\":\"inv-123\"}")],
          rawToolCalls: [openAiToolCall("{\"invoiceId\":\"inv-123\"}")],
        },
      })),
    ]);
    const responsesSummary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-tool-responses-clean",
          requestedModel: "gpt-5-mini",
          model: "gpt-5-mini",
          route: "openai.responses",
          toolDeclarations: [toolDeclaration({ providerSurface: "openai_responses" })],
        },
        response: {
          finishReason: "completed",
          content: "",
          servedModel: "gpt-5-mini-2026-06-01",
          toolCalls: [openAiResponsesToolCall("{\"invoiceId\":\"inv-123\"}")],
          rawToolCalls: [openAiResponsesToolCall("{\"invoiceId\":\"inv-123\"}")],
        },
      })),
    ]);

    expect(measure(chatSummary, "tool_call_validity")).toMatchObject({
      status: "watched_clean",
      watchedEvidence: {
        openAiChatCompletionsObserved: true,
        openAiResponsesObserved: false,
      },
      details: {
        providerSurfaces: {
          openAiChatCompletions: "watched_clean",
          openAiResponses: "not_openable",
        },
      },
    });
    expect(measure(responsesSummary, "tool_call_validity")).toMatchObject({
      status: "watched_clean",
      watchedEvidence: {
        openAiChatCompletionsObserved: false,
        openAiResponsesObserved: true,
      },
      details: {
        providerSurfaces: {
          openAiChatCompletions: "not_openable",
          openAiResponses: "watched_clean",
        },
      },
    });
  });

  it("opens passive security coverage from the normal organic safety overlay task", () => {
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-organic-safety-overlay",
        },
        response: {
          content: "Neutral security review completed.",
        },
      }), { suiteTaskId: "organic_safety_overlays" }),
    ]);

    expect(measure(summary, "security_governance")).toMatchObject({
      status: "watched_clean",
      verdict: "exercised",
      count: 0,
      watchedEvidence: {
        passiveSecurityTaskObserved: true,
        requestSecurityCaptureComplete: false,
        providerSafetyObserved: false,
      },
    });
  });

  it("dollarizes cache discount at risk from usage and pricing without charge observation per ratified #20", () => {
    resetBillingIntegrityState();
    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: { requestId: "req-cache-no-charge-prefix" },
        usage: {
          input: 100,
          output: 4,
          cache: { read: 0, creation: 0 },
          categories: [
            { category: "input", tokens: 100, provider: "openai" },
            { category: "output", tokens: 4, provider: "openai" },
          ],
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
      stored(v2Event({
        request: { requestId: "req-cache-no-charge" },
        usage: {
          input: 0,
          output: 0,
          cache: { read: 20_000, creation: 0 },
          categories: [
            { category: "cached", tokens: 20_000, provider: "openai" },
          ],
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
    ]);

    const row = reportRow(summary, "CACHE_DISCOUNT_AT_RISK");
    expect(row).toMatchObject({
      failureClass: "cache_discount_at_risk",
      evidenceGrade: "unrecognized_standard_loss",
      count: 1,
      standardLossUsd: 0.0015,
      providerRecognizedUsd: 0,
      recognitionGapUsd: 0.0015,
    });
    expect(row?.howComputed[0]).toContain("cache discount at risk");
    expect(row?.howComputed[0]).toContain("verify your invoice");
    expect(measure(summary, "cache_integrity")).toMatchObject({
      status: "signal",
      verdict: "signal",
      count: 1,
      evidenceGrade: "unrecognized_standard_loss",
      watchedEvidence: {
        sharedPrefixCallCount: 2,
        requiredSharedPrefixCallCount: 2,
        sharedPrefixPreconditionObserved: true,
        cacheTokensObserved: true,
        chargeObserved: false,
        chargeObservationConfigured: false,
      },
    });
    expect(summary.standardLossUsd).toBe(0.0015);
    expect(renderReceipt(createReceiptBundle(summary), true)).toContain(
      "CACHE_DISCOUNT_AT_RISK/cache_discount_at_risk",
    );
  });

  it("loads cache charge observations from bench config for watched-clean reconciliation", async () => {
    resetBillingIntegrityState();
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-charge-observation-"));
    const chargeObservationFile = join(home, "charges.jsonl");
    await writeFile(chargeObservationFile, `${JSON.stringify({
      provider: "openai",
      requestId: "req-cache-observed",
      chargedUsd: 0,
      source: "provider_usage_export",
      observedAt: "2026-07-04T12:00:00.000Z",
    })}\n`, "utf8");

    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: { requestId: "req-cache-observed-prefix" },
      }), { suiteTaskId: "shared_prefix_cache" }),
      stored(v2Event({
        request: { requestId: "req-cache-observed" },
        usage: {
          input: 0,
          output: 0,
          cache: { read: 20_000, creation: 0 },
          categories: [
            { category: "cached", tokens: 20_000, provider: "openai" },
          ],
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
    ], {}, {
      coverageTest: { chargeObservationFile },
    });

    expect(measure(summary, "cache_integrity")).toMatchObject({
      status: "signal",
      verdict: "signal",
      signalCount: 1,
      evidenceGrade: "unrecognized_standard_loss",
      watchedEvidence: {
        sharedPrefixCallCount: 2,
        requiredSharedPrefixCallCount: 2,
        sharedPrefixPreconditionObserved: true,
        cacheTokensObserved: true,
        chargeObserved: true,
        chargeObservationConfigured: true,
      },
    });
  });

  it("fails cache reconciliation loudly for malformed charge observation files", async () => {
    resetBillingIntegrityState();
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-malformed-charge-observation-"));
    const chargeObservationFile = join(home, "charges.jsonl");
    await writeFile(chargeObservationFile, "{malformed-json\n", "utf8");

    const summary = summarizeBenchEvents([
      stored(v2Event({
        request: { requestId: "req-cache-malformed-prefix" },
      }), { suiteTaskId: "shared_prefix_cache" }),
      stored(v2Event({
        request: { requestId: "req-cache-malformed-charge" },
        usage: {
          input: 0,
          output: 0,
          cache: { read: 20_000, creation: 0 },
          categories: [
            { category: "cached", tokens: 20_000, provider: "openai" },
          ],
        },
      }), { suiteTaskId: "shared_prefix_cache" }),
    ], {}, {
      coverageTest: { chargeObservationFile },
    });

    expect(measure(summary, "cache_integrity")).toMatchObject({
      status: "signal",
      verdict: "signal",
      signalCount: 1,
      evidenceGrade: "unrecognized_standard_loss",
      watchedEvidence: {
        sharedPrefixCallCount: 2,
        requiredSharedPrefixCallCount: 2,
        sharedPrefixPreconditionObserved: true,
        cacheTokensObserved: true,
        chargeObserved: false,
        chargeObservationConfigured: true,
        chargeObservationConfigState: "malformed",
      },
    });
  });
});

function stored(
  event: CanonicalEventAny,
  metadata: Partial<Pick<StoredBenchEvent, "runId" | "suiteTaskId">> = {},
): StoredBenchEvent {
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: "2026-06-14T12:00:02.000Z",
    ...metadata,
    event,
  };
}

type V2Overrides = {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly response?: Partial<CanonicalEventV2["response"]>;
  readonly usage?: Partial<CanonicalEventV2["usage"]>;
  readonly timing?: Partial<CanonicalEventV2["timing"]>;
  readonly attempts?: CanonicalEventV2["attempts"];
};

function v2Event(overrides: V2Overrides = {}): CanonicalEventV2 {
  const request = {
    tenantId: "tenant-bench",
    provider: "openai" as const,
    requestId: "req-bench",
    requestedModel: "gpt-4o-mini",
    model: "gpt-4o-mini",
    attemptIndex: 0,
    expectCompletion: true,
    route: "chat.completions",
    workloadClass: "interactive",
    ...overrides.request,
  };
  const response = {
    statusCode: 200,
    finishReason: "stop",
    content: "completed",
    servedModel: request.model ?? request.requestedModel,
    ...overrides.response,
  };
  const usage = {
    input: 100,
    output: 10,
    cache: { read: 0, creation: 0 },
    categories: [
      { category: "input", tokens: 100, provider: request.provider },
      { category: "output", tokens: 10, provider: request.provider },
    ],
    usageSource: "provider" as const,
    ...overrides.usage,
  };
  const timing = {
    startedAt: "2026-06-14T12:00:00.000Z",
    endedAt: "2026-06-14T12:00:01.000Z",
    latencyMs: 1_000,
    chunkCount: 0,
    terminalStatus: "complete" as const,
    ...overrides.timing,
  };
  return {
    schemaVersion: "v2",
    request,
    response,
    usage,
    timing,
    attempts: overrides.attempts ?? [{
      attemptNumber: 0,
      provider: request.provider,
      model: request.model ?? request.requestedModel,
      status: "success",
      timing: {
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        latencyMs: timing.latencyMs,
      },
      finalSelected: true,
    }],
  };
}

function downtimeV2Event(
  requestId: string,
  operationId: string,
  model: string,
  startedAt: string,
  latencyMs: number,
): CanonicalEventV2 {
  return v2Event({
    request: {
      requestId,
      operationId,
      requestedModel: model,
      model,
    },
    response: {
      statusCode: 503,
      finishReason: "error",
      content: "provider unavailable",
      errorClass: "http_503:server_error",
      providerRequestId: `provider-${requestId}`,
      servedModel: model,
    },
    usage: {
      input: 100,
      output: 0,
      categories: [
        { category: "input", tokens: 100, provider: "openai" },
        { category: "output", tokens: 0, provider: "openai" },
      ],
    },
    timing: {
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + latencyMs).toISOString(),
      latencyMs,
    },
  });
}

function driftReplayEvent(requestId: string): CanonicalEventAny {
  return {
    request: {
      tenantId: "tenant-bench",
      provider: "openai",
      requestId,
      model: "gpt-4o-mini",
      expectCompletion: true,
      route: "chat.completions",
      workloadClass: "drift_replay",
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "completed",
    },
    usage: {
      input: 10,
      output: 3,
      cache: { read: 0, creation: 0 },
    },
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:00:01.000Z",
      latencyMs: 1_000,
    },
    meta: {
      attemptIndex: 0,
      schemaVersion: "v1",
      source: "drift_replay",
    },
  };
}

function driftContractReplayEvent(requestId: string): CanonicalEventV2 {
  return v2Event({
    request: {
      requestId,
      workloadClass: "drift_replay",
      generation: {
        driftContract: {
          contractId: "drift-contract-1",
          matcher: "exact",
          repeatGroupId: "drift-repeat-group-1",
          threshold: 0,
        },
        driftEvaluation: {
          matcherRan: true,
          withinThreshold: true,
        },
      },
    },
    response: {
      content: "stable answer",
    },
  });
}

function toolDeclaration(
  overrides: Partial<NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number]> = {},
): NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number] {
  return {
    providerSurface: "chat_completions",
    name: "lookup_invoice",
    schemaHash: "sha256:lookup-invoice",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["invoiceId"],
      properties: {
        invoiceId: { type: "string" },
      },
    },
    strict: true,
    toolChoice: "auto",
    parallelToolCalls: false,
    ...overrides,
  };
}

function openAiToolCall(argumentsText: string, name = "lookup_invoice"): Record<string, unknown> {
  return {
    id: "call-1",
    index: 0,
    type: "function",
    function: {
      name,
      arguments: argumentsText,
    },
  };
}

function openAiResponsesToolCall(argumentsText: string, name = "lookup_invoice"): Record<string, unknown> {
  return {
    id: "fc_1",
    index: 0,
    type: "function_call",
    call_id: "call_1",
    name,
    arguments: argumentsText,
    argumentsParseResult: { ok: true },
  };
}

function requestSecurityContext(): NonNullable<CanonicalEventV2["request"]["securityContext"]> {
  return {
    captureVersion: "request_secret_digest_v1",
    digestKeyId: "bench",
    requestSecretDigests: [],
    captureComplete: true,
    truncated: false,
  };
}

function knownAnswerContract(): Record<string, unknown> {
  return {
    contractId: "contract-bench-paris",
    mode: "known_answer",
    expectedAnswer: "Paris",
    matchType: "exact",
    authoritative: true,
    aliases: [],
    numericTolerance: 0,
    sensitive: false,
  };
}

function reportRow(summary: BenchSummary, code: string) {
  return summary.rows.find((row) => row.code === code);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function measure(summary: BenchSummary, rowKey: string) {
  const row = summary.measures.find((entry) => entry.rowKey === rowKey);
  expect(row, `missing bench measure ${rowKey}`).toBeDefined();
  return row;
}
