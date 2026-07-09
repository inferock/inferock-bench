import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBenchPaths } from "../config.js";
import { createConformanceArtifactWriter } from "./artifacts.js";
import {
  runStreamFixtureControls,
  STREAM_FIXTURE_CONTROL_DEFINITIONS,
} from "./stream-fixtures.js";

describe("stream fixture-only controls", () => {
  it("emits fixture_control ledger rows with expected stream detector codes", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-stream-fixtures-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const writer = createConformanceArtifactWriter({
      paths,
      runId: "conformance_20260708T120000Z_streamfx",
      createdAt: "2026-07-08T12:00:00.000Z",
      mode: "fixture_control",
      modules: ["stream_sse"],
      providers: ["openai", "anthropic"],
    });
    await writer.writeManifest();

    const result = await runStreamFixtureControls({
      runId: writer.runId,
      writer,
    });

    const expectedCodes = Object.fromEntries(STREAM_FIXTURE_CONTROL_DEFINITIONS.map((definition) => [
      definition.controlId,
      definition.expectedDetectorCode,
    ]));
    expect(result.entries).toHaveLength(4);
    for (const entry of result.entries) {
      const controlId = String(entry.rawEvidence.fixtureControl);
      expect(entry).toMatchObject({
        mode: "fixture_control",
        module: "stream_sse",
        status: "signal",
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
        standardLossEligible: false,
      });
      expect(entry.validationMetadata).toContain("synthetic_fixture_fault");
      expect(entry.rawEvidence).toMatchObject({
        fixtureControl: controlId,
        expectedDetectorCode: expectedCodes[controlId],
        syntheticProviderAttribution: false,
      });
      expect(entry.detectors.signalCodes).toEqual([expectedCodes[controlId]]);
      expect(entry.detectors).toMatchObject({
        fixtureControl: controlId,
        expectedDetectorCode: expectedCodes[controlId],
        syntheticProviderAttribution: false,
      });
    }

    const clientAbort = result.entries.find((entry) => entry.rawEvidence.fixtureControl === "client_abort");
    expect(clientAbort?.validationMetadata).toContain("caller_owned_control");
    expect(clientAbort?.detectors.signalCodes).toEqual(["STREAM_CLIENT_ABORTED"]);
    expect(result.entries.find((entry) => entry.rawEvidence.fixtureControl === "missing_done")?.detectors.signalCodes)
      .toEqual(["OPENAI_STREAM_MISSING_DONE_MARKER"]);
    expect(result.entries.find((entry) => entry.rawEvidence.fixtureControl === "provider_stream_error")?.detectors.signalCodes)
      .toEqual(["ANTHROPIC_STREAM_ERROR_EVENT"]);
    expect(result.entries.find((entry) => entry.rawEvidence.fixtureControl === "terminal_status_gap")?.detectors.signalCodes)
      .toEqual(["STREAM_TERMINAL_STATUS_GAP"]);

    const ledgerRaw = await readFile(join(writer.runDir, "ledger.jsonl"), "utf8");
    expect(ledgerRaw).toContain("\"mode\":\"fixture_control\"");
    expect(ledgerRaw).toContain("\"standardLossEligible\":false");
    expect(ledgerRaw).not.toContain("\"providerRecognizedEligible\":true");
    await expect(readFile(paths.eventsFile, "utf8")).rejects.toThrow(/ENOENT/);
    await expect(stat(paths.receiptsDir)).rejects.toThrow(/ENOENT/);
  });
});
