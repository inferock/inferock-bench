import { describe, expect, it } from "vitest";
import {
  renderConformanceSummary,
  summarizeConformanceLedger,
} from "./summary.js";
import {
  CONFORMANCE_LEDGER_SCHEMA_VERSION,
  type ConformanceLedgerEntry,
  validationEligibility,
} from "./types.js";

describe("conformance summary renderer", () => {
  it("renders hidden no-token, stream not-exercised, fixture fault, and watched-clean cases", () => {
    const entries = [
      entry({
        probeId: "hidden-token-openai-responses-positive-001",
        module: "hidden_token",
        provider: "openai",
        providerSurface: "openai_responses",
        status: "inconclusive",
        openabilityStatus: "not_openable",
        surfaceOpened: false,
        reason: "hidden-token surface not opened; provider returned no recognized reasoning/thinking usage",
        label: "not-openable: hidden-token surface not opened; provider returned no recognized reasoning/thinking usage",
        rawEvidence: { recognizedHiddenOutputTokens: 0 },
      }),
      entry({
        probeId: "stream-sse-openai-chat-001",
        module: "stream_sse",
        provider: "openai",
        providerSurface: "chat_completions",
        status: "not_openable",
        openabilityStatus: "not_openable",
        surfaceOpened: false,
        reason: "not a streaming request",
        label: "not-openable: not a streaming request",
      }),
      entry({
        probeId: "stream-fixture-client-abort-anthropic",
        module: "stream_sse",
        provider: "anthropic",
        providerSurface: "anthropic_messages",
        mode: "fixture_control",
        status: "signal",
        openabilityStatus: "signal",
        surfaceOpened: false,
        label: "signal: conformance anomaly found",
        rawEvidence: { fixtureControl: "client_abort" },
      }),
      entry({
        probeId: "hidden-token-anthropic-messages-positive-001",
        module: "hidden_token",
        provider: "anthropic",
        providerSurface: "anthropic_messages",
        status: "passed",
        openabilityStatus: "watched_clean",
        surfaceOpened: true,
        label: "watched-clean: hidden usage category recognized; billed-empty and recount guards passed",
        rawEvidence: { recognizedHiddenOutputTokens: 9 },
      }),
    ];

    const summary = summarizeConformanceLedger({
      runId: "conformance_20260708T120000Z_summary",
      generatedAt: "2026-07-08T12:00:02.000Z",
      entries,
    });
    expect(summary).toMatchObject({
      status: "signal",
      probeCount: 4,
      notOpenableCount: 2,
      signalCount: 1,
      inconclusiveCount: 1,
      dashboardEligible: false,
      lossReportEligible: false,
      providerRecognizedEligible: false,
    });
    expect(renderConformanceSummary({ summary, entries })).toMatchInlineSnapshot(`
      "inferock-bench conformance summary
      run: conformance_20260708T120000Z_summary
      status: signal
      probes: 4
      not-openable: 2
      signals: 1
      inconclusive: 1
      hidden_token/anthropic: watched-clean
        probes=1 not-openable=0 signals=0 inconclusive=0
        - watched-clean: hidden usage category recognized; billed-empty and recount guards passed
      hidden_token/openai: inconclusive
        probes=1 not-openable=1 signals=0 inconclusive=1
        - not-openable: hidden-token surface not opened; provider returned no recognized reasoning/thinking usage
      stream_sse/anthropic: signal
        probes=1 not-openable=0 signals=1 inconclusive=0
        - signal: conformance anomaly found
      stream_sse/openai: not-openable
        probes=1 not-openable=1 signals=0 inconclusive=0
        - not-openable: not a streaming request"
    `);
  });

  it("rejects a hidden positive watched-clean row without recognized hidden tokens", () => {
    const badEntry = entry({
      probeId: "hidden-token-openai-responses-positive-001",
      module: "hidden_token",
      provider: "openai",
      providerSurface: "openai_responses",
      status: "passed",
      openabilityStatus: "watched_clean",
      surfaceOpened: true,
      rawEvidence: { recognizedHiddenOutputTokens: 0 },
    });

    expect(() => summarizeConformanceLedger({
      runId: "conformance_20260708T120000Z_bad",
      entries: [badEntry],
    })).toThrow(/cannot be watched-clean without recognized hidden output tokens/);
  });
});

function entry(input: {
  readonly probeId: string;
  readonly module: ConformanceLedgerEntry["module"];
  readonly provider: ConformanceLedgerEntry["provider"];
  readonly providerSurface: ConformanceLedgerEntry["providerSurface"];
  readonly mode?: ConformanceLedgerEntry["mode"];
  readonly status: ConformanceLedgerEntry["status"];
  readonly openabilityStatus: ConformanceLedgerEntry["openability"]["status"];
  readonly surfaceOpened: boolean;
  readonly reason?: string;
  readonly label?: string;
  readonly rawEvidence?: ConformanceLedgerEntry["rawEvidence"];
}): ConformanceLedgerEntry {
  return {
    schemaVersion: CONFORMANCE_LEDGER_SCHEMA_VERSION,
    runId: "conformance_20260708T120000Z_summary",
    probeId: input.probeId,
    module: input.module,
    mode: input.mode ?? "real_provider",
    provider: input.provider,
    providerSurface: input.providerSurface,
    model: input.provider === "openai" ? "gpt-5.4-mini" : "claude-sonnet-5",
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    status: input.status,
    openability: {
      surfaceOpened: input.surfaceOpened,
      status: input.openabilityStatus,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
    validationMetadata: ["billing_observation_pending"],
    ...validationEligibility(input.mode === "fixture_control" ? { standardLossEligible: false } : {}),
    request: {
      bodyHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      promptId: "summary-test",
      syntheticContentOnly: true,
    },
    rawEvidence: input.rawEvidence ?? {},
    canonical: {},
    detectors: {},
  };
}
