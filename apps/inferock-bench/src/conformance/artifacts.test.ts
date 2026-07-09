import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBenchPaths } from "../config.js";
import {
  createConformanceArtifactWriter,
  emptyConformanceSummary,
  generateConformanceRunId,
  validationConformanceRoot,
} from "./artifacts.js";
import {
  CONFORMANCE_ARTIFACT_SUBTREE,
  CONFORMANCE_LEDGER_SCHEMA_VERSION,
  type ConformanceLedgerEntry,
  validationEligibility,
} from "./types.js";

describe("conformance artifact writer", () => {
  it("writes validation artifacts under the dedicated conformance subtree only", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-conformance-artifacts-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const runId = generateConformanceRunId(
      new Date("2026-07-08T12:00:00.000Z"),
      "01234567-89ab-cdef-0123-456789abcdef",
    );
    const writer = createConformanceArtifactWriter({
      paths,
      runId,
      createdAt: "2026-07-08T12:00:00.000Z",
      mode: "fixture_control",
      modules: ["stream_sse"],
      providers: ["openai"],
    });

    const manifestPath = await writer.writeManifest();
    const ledgerPath = await writer.appendLedger(ledgerEntry(runId));
    const rawFramesPath = await writer.writeRawNdjson("stream-sse-openai-chat-001", [
      { index: 0, eventType: "message", terminalMarker: false },
      { index: 1, eventType: "done", terminalMarker: true },
    ]);
    const usagePath = await writer.writeRawJson("stream-sse-openai-chat-001", "usage", {
      rawUsagePresent: true,
    });
    const summaryPath = await writer.writeSummary(emptyConformanceSummary({
      runId,
      generatedAt: "2026-07-08T12:00:01.000Z",
    }));

    const expectedRoot = join(validationConformanceRoot(home), runId);
    expect(writer.runDir).toBe(expectedRoot);
    expect(manifestPath).toBe(join(expectedRoot, "manifest.json"));
    expect(ledgerPath).toBe(join(expectedRoot, "ledger.jsonl"));
    expect(rawFramesPath).toBe(join(expectedRoot, "raw", "stream-sse-openai-chat-001.sse.ndjson"));
    expect(usagePath).toBe(join(expectedRoot, "raw", "stream-sse-openai-chat-001.usage.json"));
    expect(summaryPath).toBe(join(expectedRoot, "summary.json"));

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: "inferock-real-provider-conformance-manifest-v1",
      runId,
      artifactSubtree: CONFORMANCE_ARTIFACT_SUBTREE,
      dashboardEligible: false,
      lossReportEligible: false,
      providerRecognizedEligible: false,
    });

    const entries = await writer.readLedgerEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
      dashboardEligible: false,
      lossReportEligible: false,
      providerRecognizedEligible: false,
      standardLossEligible: false,
    });

    await expect(readFile(paths.eventsFile, "utf8")).rejects.toThrow(/ENOENT/);
    await expect(stat(paths.receiptsDir)).rejects.toThrow(/ENOENT/);
  });

  it("rejects ledger entries that try to enter live reporting surfaces", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-conformance-artifacts-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const writer = createConformanceArtifactWriter({
      paths,
      runId: "conformance_20260708T120000Z_0123abcd",
      createdAt: "2026-07-08T12:00:00.000Z",
      mode: "fixture_control",
      modules: ["stream_sse"],
      providers: ["openai"],
    });
    const entry = {
      ...ledgerEntry(writer.runId),
      dashboardEligible: true,
    } as unknown as ConformanceLedgerEntry;

    await expect(writer.appendLedger(entry)).rejects.toThrow(/validation-only/);
    await expect(readFile(join(writer.runDir, "ledger.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });
});

function ledgerEntry(runId: string): ConformanceLedgerEntry {
  return {
    schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
    runId,
    probeId: "stream-sse-openai-chat-001",
    module: "stream_sse",
    mode: "fixture_control",
    provider: "openai",
    providerSurface: "chat_completions",
    model: "gpt-5.4-mini",
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    status: "passed",
    openability: {
      surfaceOpened: true,
      status: "watched_clean",
    },
    validationMetadata: ["synthetic_fixture_fault"],
    ...validationEligibility({ standardLossEligible: false }),
    request: {
      bodyHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      promptId: "normal-release-checklist-v1",
      syntheticContentOnly: true,
    },
    rawEvidence: {},
    canonical: {},
    detectors: {},
  };
}
