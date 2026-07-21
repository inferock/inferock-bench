import { describe, expect, it } from "vitest";
import type { CanonicalEventAny, CanonicalEventV2 } from "@inferock/measure/canonical-event";
import type { ProviderFetch } from "../proxy.js";
import type { ProviderName } from "../provider.js";
import type { EventStore, StoredBenchEvent } from "../storage.js";
import { loadCoverageTokenBaselineFromValue } from "./baseline.js";
import { estimateCoverageSuite } from "./estimate.js";
import { loadCoverageSuiteManifest } from "./manifest.js";
import { runProviderParallelCoverageSuite } from "./provider-parallel-runner.js";
import { createCombinedSpeedTestReceiptBundle } from "./provider-scope.js";
import {
  createSpeedTestReceiptBundle,
  renderSpeedTestReceipt,
  type SpeedTestReceiptBundle,
} from "./runner.js";
import { summarizeBenchEvents } from "../summary.js";
import { planAgentProvisioning } from "../agent-mode/provisioner.js";
import { SPEEDTEST_RECEIPT_SCHEMA_VERSION } from "../receipt-schema.js";

class MemoryStore implements EventStore {
  readonly records: StoredBenchEvent[] = [];

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

describe("provider-scoped speed-test receipts", () => {
  it("keeps provider receipts, ledgers, and surfaces-watched lines separate", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const openaiEstimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const acceptedEstimate = estimateCoverageSuite({
      selectedModels: [
        { provider: "openai", model: "gpt-4o-mini-2024-07-18" },
        { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        { provider: "gemini", model: "gemini-2.5-flash" },
      ],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 3,
      eventTime: "2026-07-06T00:00:00.000Z",
    });
    const anthropicEstimate = estimateCoverageSuite({
      selectedModels: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001" }],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const geminiEstimate = estimateCoverageSuite({
      selectedModels: [{ provider: "gemini", model: "gemini-2.5-flash" }],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-06T00:00:00.000Z",
    });
    const openai = createSpeedTestReceiptBundle({
      runId: "speedtest_parallel/openai",
      providerId: "openai",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate: openaiEstimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_parallel/openai" }),
      suite,
    });
    const anthropic = createSpeedTestReceiptBundle({
      runId: "speedtest_parallel/anthropic",
      providerId: "anthropic",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate: anthropicEstimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_parallel/anthropic" }),
      suite,
    });
    const gemini = createSpeedTestReceiptBundle({
      runId: "speedtest_parallel/gemini",
      providerId: "gemini",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate: geminiEstimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_parallel/gemini" }),
      suite,
    });

    const combined = createCombinedSpeedTestReceiptBundle({
      runId: "speedtest_parallel",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      providerReceipts: [openai, anthropic, gemini],
      parallelProviderCount: 3,
      acceptedEstimate,
    });

    expect(combined.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(combined.providerReceipts?.map((receipt) => receipt.providerScope?.provider)).toEqual([
      "openai",
      "anthropic",
      "gemini",
    ]);
    expect(combined.providerLedgers?.map((ledger) => ledger.provider)).toEqual(["openai", "anthropic", "gemini"]);
    expect(combined.providerReceipts?.every((receipt) => receipt.coverage.totalSurfaceCount === 13)).toBe(true);
    expect(combined.coverage.totalSurfaceCount).toBe(13);
    expect(combined.consent.estimate.estimateHash).toBe(acceptedEstimate.estimateHash);
    expect(combined.consent.estimate.estimateHash).not.toBe(openai.consent.estimate.estimateHash);
    expect(combined.providerScope?.parallelProviderCount).toBe(3);
    expect(combined.providerScope?.localContentionPossible).toBe(true);
    const rendered = renderSpeedTestReceipt(combined);
    expect(rendered).toContain("provider scope: openai, anthropic, gemini (3 parallel; local contention possible)");
    expect(rendered).toContain("provider openai ledger: money loss");
    expect(rendered).toContain("provider anthropic ledger: money loss");
    expect(rendered).toContain("provider gemini ledger: money loss");
    expect(rendered).toContain("time lost");
  });

  it("stamps provider receipts with the enclosing parallel provider count", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const estimate = estimateCoverageSuite({
      selectedModels: [
        { provider: "openai", model: "gpt-4o-mini-2024-07-18" },
        { provider: "gemini", model: "gemini-2.5-flash" },
      ],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 2,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const store = new MemoryStore();
    const startedProviders = new Set<ProviderName>();

    const result = await runProviderParallelCoverageSuite({
      runId: "speedtest_actual_parallel",
      suite,
      baseline,
      estimate,
      config: {
        benchKey: "local",
        openaiApiKey: "provider-openai",
        geminiApiKey: "provider-gemini",
      },
      env: {},
      store,
      providerFetch: overlappingProviderFetch(startedProviders),
      benchHome: "/tmp/inferock-provider-parallel",
      startedAt: "2026-07-05T00:00:00.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      log: () => undefined,
    });

    expect([...startedProviders].sort()).toEqual(["gemini", "openai"]);
    expect(result.providerResults).toHaveLength(2);
    expect(result.receipt.providerScope).toMatchObject({
      selectedProviders: ["openai", "gemini"],
      parallelProviderCount: 2,
      localContentionPossible: true,
    });
    for (const providerResult of result.providerResults) {
      const provider = providerResult.receipt.providerScope?.provider;
      expect(provider).toBeDefined();
      expect(providerResult.receipt.providerScope).toMatchObject({
        selectedProviders: [provider],
        parallelProviderCount: 2,
        localContentionPossible: true,
      });
      expect(renderSpeedTestReceipt(providerResult.receipt)).toContain(
        `provider scope: ${provider} (2 parallel; local contention possible)`,
      );
    }
    expect(renderSpeedTestReceipt(result.receipt)).toContain(
      "provider scope: openai, gemini (2 parallel; local contention possible)",
    );
  });

  it("uses one provider surface denominator for receipt blocks and ledgers", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const acceptedEstimate = estimateCoverageSuite({
      selectedModels: [
        { provider: "openai", model: "gpt-4o-mini-2024-07-18" },
        { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      ],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 2,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const providerReceipts = (["openai", "anthropic"] as const).map((provider) => {
      const estimate = estimateCoverageSuite({
        selectedModels: [{
          provider,
          model: provider === "openai" ? "gpt-4o-mini-2024-07-18" : "claude-haiku-4-5-20251001",
        }],
        suite,
        baseline,
        generator: "agent",
        spendCapUsd: 1,
        eventTime: "2026-07-05T00:00:00.000Z",
      });
      const receipt = createSpeedTestReceiptBundle({
        runId: `speedtest_denominator/${provider}`,
        providerId: provider,
        status: "completed",
        startedAt: "2026-07-05T00:00:00.000Z",
        endedAt: "2026-07-05T00:00:01.000Z",
        consentedAt: "2026-07-05T00:00:00.000Z",
        estimate,
        summary: summarizeBenchEvents([], { runId: `speedtest_denominator/${provider}` }),
        suite,
        agent: { name: "opencode-ai", version: "1.17.13", source: "auto-provisioned" },
      });
      return {
        ...receipt,
        coverage: {
          ...receipt.coverage,
          watchedCount: 13,
          totalSurfaceCount: 12,
          notOpenableCount: 0,
          surfaces: receipt.coverage.surfaces.map((surface) => ({
            ...surface,
            status: "watched_clean" as const,
            signalCount: 0,
          })),
        },
      };
    });

    const combined = createCombinedSpeedTestReceiptBundle({
      runId: "speedtest_denominator",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      providerReceipts,
      parallelProviderCount: 2,
      acceptedEstimate,
    });

    for (const receipt of [combined, ...(combined.providerReceipts ?? [])]) {
      expect(receipt.coverage.watchedCount).toBeLessThanOrEqual(receipt.coverage.totalSurfaceCount);
    }
    for (const ledger of combined.providerLedgers ?? []) {
      const receipt = combined.providerReceipts?.find((entry) => entry.providerScope?.provider === ledger.provider);
      expect(receipt).toBeDefined();
      expect(ledger.surfacesWatched).toBe(receipt?.coverage.watchedCount);
      expect(ledger.totalSurfaces).toBe(receipt?.coverage.totalSurfaceCount);
    }
  });

  it("keeps cache exposure out of provider ledgers when a provider has a tiny real loss", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const estimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const summary = summarizeBenchEvents(cacheExposureAndTinyLossEvents(), {
      runId: "speedtest_exposure/openai",
    });
    const realLossRow = summary.rows.find((row) => row.code === "BROKEN_OUTPUT");
    const openai = createSpeedTestReceiptBundle({
      runId: "speedtest_exposure/openai",
      providerId: "openai",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate,
      summary,
      suite,
    });

    const combined = createCombinedSpeedTestReceiptBundle({
      runId: "speedtest_exposure",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      providerReceipts: [openai],
      parallelProviderCount: 1,
      acceptedEstimate: estimate,
    });
    const ledger = combined.providerLedgers?.[0];

    expect(summary.exposures).toEqual([{
      class: "cache_discount_at_risk",
      amount: 0.0015,
      count: 1,
      guidance: "verify your invoice",
    }]);
    expect(realLossRow?.standardLossUsd).toBeGreaterThan(0);
    const moneyRows = summary.rows.filter((row) => row.primaryValueKind === "money");
    const standardLossUsd = roundUsd(sum(moneyRows.map((row) => row.standardLossUsd)));
    const recognitionGapUsd = roundUsd(sum(moneyRows.map((row) => row.recognitionGapUsd)));
    expect(summary.rows.some((row) => row.failureClass === "cache_discount_at_risk")).toBe(false);
    expect(openai.rows.some((row) => row.failureClass === "cache_discount_at_risk")).toBe(false);
    expect(combined.rows.some((row) => row.failureClass === "cache_discount_at_risk")).toBe(false);
    expect(openai.totals.money.standardLossUsd).toBe(standardLossUsd);
    expect(openai.totals.money.recognitionGapUsd).toBe(recognitionGapUsd);
    expect(ledger?.standardLossUsd).toBe(standardLossUsd);
    expect(ledger?.recognitionGapUsd).toBe(recognitionGapUsd);
    expect(combined.exposures).toEqual(summary.exposures);
    expect(renderSpeedTestReceipt(combined)).toContain(
      "spent $0.00 · money loss $0.00 · time loss ~0s · invoice-check exposure $0.001500",
    );
    expect(renderSpeedTestReceipt(combined)).toContain(
      "cache discount at risk — verify your invoice: 1 invoice exposure, $0.001500",
    );
  });

  it("labels agent receipts with agent identity and traffic mix", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const estimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });

    const receipt: SpeedTestReceiptBundle = createSpeedTestReceiptBundle({
      runId: "speedtest_agent/openai",
      providerId: "openai",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_agent/openai" }),
      suite,
      agent: {
        name: "opencode-ai",
        version: "1.17.13",
        source: "auto-provisioned",
      },
      agentOrganicTasks: [{
        taskId: "resistor-color",
        status: "budget_bounded",
        callsObserved: 4,
        rejectedAttempts: 1,
        maxCalls: 4,
        inFlightAtBound: 0,
        concurrencyLimit: 1,
        elapsedMs: 2_000,
        maxWallTimeMs: 10_000,
        budgetBoundedReason: "max_calls",
      }],
      trafficMix: {
        organicAgentTasks: 6,
        harnessPreconditionTasks: 13,
        driftCanaryCalls: 50,
        sdkRetryWorkerCalls: 2,
      },
    });

    expect(receipt.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(receipt.run.generator).toBe("agent");
    expect(receipt.agent).toEqual({
      name: "opencode-ai",
      version: "1.17.13",
      source: "auto-provisioned",
    });
    expect(receipt.trafficMix).toEqual({
      organicAgentTasks: 6,
      harnessPreconditionTasks: 13,
      driftCanaryCalls: 50,
      sdkRetryWorkerCalls: 2,
    });
    const organicTask = receipt.agentOrganicTasks?.[0];
    expect(organicTask).toMatchObject({
      callsObserved: 4,
      rejectedAttempts: 1,
      maxCalls: 4,
      inFlightAtBound: 0,
      concurrencyLimit: 1,
      budgetBoundedReason: "max_calls",
    });
    expect(organicTask?.callsObserved).toBeLessThanOrEqual(organicTask?.maxCalls ?? 0);
  });

  it("aggregates multi-provider agent traffic without overwriting per-provider receipt details", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const installManifestHash = planAgentProvisioning({ benchHome: "/tmp/inferock-agent-hash" }).consentHash;
    const openaiEstimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const acceptedEstimate = estimateCoverageSuite({
      selectedModels: [
        { provider: "openai", model: "gpt-4o-mini-2024-07-18" },
        { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      ],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 2,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const anthropicEstimate = estimateCoverageSuite({
      selectedModels: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001" }],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const openai = createSpeedTestReceiptBundle({
      runId: "speedtest_agent_parallel/openai",
      providerId: "openai",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate: openaiEstimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_agent_parallel/openai" }),
      suite,
      agent: { name: "opencode-ai", version: "1.17.13", source: "auto-provisioned" },
      acceptedAgentInstallHash: installManifestHash,
      trafficMix: {
        organicAgentTasks: 6,
        harnessPreconditionTasks: 13,
        driftCanaryCalls: 50,
        sdkRetryWorkerCalls: 1,
      },
    });
    const anthropic = createSpeedTestReceiptBundle({
      runId: "speedtest_agent_parallel/anthropic",
      providerId: "anthropic",
      status: "completed",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      consentedAt: "2026-07-05T00:00:00.000Z",
      estimate: anthropicEstimate,
      summary: summarizeBenchEvents([], { runId: "speedtest_agent_parallel/anthropic" }),
      suite,
      agent: { name: "opencode-ai", version: "user-agent-2.0.0", source: "user-supplied" },
      acceptedAgentInstallHash: installManifestHash,
      trafficMix: {
        organicAgentTasks: 4,
        harnessPreconditionTasks: 13,
        driftCanaryCalls: 50,
        sdkRetryWorkerCalls: 0,
      },
    });

    const combined = createCombinedSpeedTestReceiptBundle({
      runId: "speedtest_agent_parallel",
      startedAt: "2026-07-05T00:00:00.000Z",
      endedAt: "2026-07-05T00:00:01.000Z",
      providerReceipts: [openai, anthropic],
      parallelProviderCount: 2,
      acceptedEstimate,
    });

    expect(combined.agent).toBeUndefined();
    expect(combined.trafficMix).toEqual({
      organicAgentTasks: 10,
      harnessPreconditionTasks: 26,
      driftCanaryCalls: 100,
      sdkRetryWorkerCalls: 1,
    });
    expect(combined.providerReceipts?.[0]?.agent).toEqual(openai.agent);
    expect(combined.providerReceipts?.[1]?.agent).toEqual(anthropic.agent);
    expect(combined.providerReceipts?.[0]?.trafficMix).toEqual(openai.trafficMix);
    expect(combined.providerReceipts?.[1]?.trafficMix).toEqual(anthropic.trafficMix);
    expect(combined.consent.acceptedAgentInstallHash).toBe(installManifestHash);
    expect(combined.providerReceipts?.map((receipt) => receipt.consent.acceptedAgentInstallHash)).toEqual([
      installManifestHash,
      installManifestHash,
    ]);
  });

  it("offers built-in fallback on provision failure without silently swapping generators", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const benchHome = "/tmp/inferock-agent-provision-fail";
    const agentInstallConsentHash = planAgentProvisioning({ benchHome }).consentHash;
    const estimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const store = new MemoryStore();
    let providerCalls = 0;

    await expect(runProviderParallelCoverageSuite({
      runId: "speedtest_provision_fail",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      env: {},
      store,
      benchHome,
      agentInstallConsentHash,
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
      agentProvisioner: async () => {
        throw new Error("download denied");
      },
      log: () => undefined,
    })).rejects.toMatchObject({
      name: "AgentProvisioningFailureError",
      detail: {
        packageName: "opencode-ai",
        packageVersion: "1.17.13",
        tarballUrl: "https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.17.13.tgz",
        reason: "download denied",
      },
    });

    expect(providerCalls).toBe(0);
    expect(store.records).toHaveLength(0);
  });

  it("does not auto-provision an agent without an install consent hash", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const benchHome = "/tmp/inferock-agent-no-consent";
    const expectedHash = planAgentProvisioning({ benchHome }).consentHash;
    const estimate = estimateCoverageSuite({
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const store = new MemoryStore();
    let provisionCalls = 0;
    let providerCalls = 0;

    await expect(runProviderParallelCoverageSuite({
      runId: "speedtest_agent_no_consent",
      suite,
      baseline,
      estimate,
      config: { benchKey: "local", openaiApiKey: "provider-openai" },
      env: {},
      store,
      benchHome,
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
      agentProvisioner: async () => {
        provisionCalls += 1;
        throw new Error("should not provision");
      },
      log: () => undefined,
    })).rejects.toThrow(`Agent install consent hash is required. Expected ${expectedHash}.`);

    expect(provisionCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(store.records).toHaveLength(0);
  });
});

function completeBaselineForSuite(suite: Awaited<ReturnType<typeof loadCoverageSuiteManifest>>) {
  return {
    schemaVersion: "inferock-coverage-token-baseline-v1",
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: "2026-07-04T00:00:00.000Z",
    generatedBy: "covrun",
    provenance: {
      sourcePath: "/tmp/inferock-covrun-assets/",
      sourceCommit: "test-commit",
      benchPackageVersion: "0.1.3",
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 1])),
      notes: "provider scope test fixture",
    },
    quantile: "reviewed",
    tasks: suite.tasks.map((task, index) => ({
      taskId: task.taskId,
      plannedCalls: task.taskId === "concurrency_wave"
        ? 4
        : task.taskId === "identical_rerun_drift"
          ? 5
          : 1,
      provenance: "covrun_measured",
      usage: {
        input: 100 + index,
        output: 40 + index,
        cacheRead: task.taskId === "shared_prefix_cache" ? 800 : 0,
        cacheCreation: task.taskId === "shared_prefix_cache" ? 100 : 0,
      },
    })),
  } as const;
}

function cacheExposureAndTinyLossEvents(): readonly StoredBenchEvent[] {
  return [
    stored(v2Event({
      request: { requestId: "req-provider-cache-prefix" },
    }), {
      runId: "speedtest_exposure/openai",
      suiteTaskId: "shared_prefix_cache",
    }),
    stored(v2Event({
      request: { requestId: "req-provider-cache" },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 20_000, creation: 0 },
        categories: [
          { category: "cached", tokens: 20_000, provider: "openai" },
        ],
      },
    }), {
      runId: "speedtest_exposure/openai",
      suiteTaskId: "shared_prefix_cache",
    }),
    stored(v2Event({
      request: {
        requestId: "req-provider-tiny-real-loss",
        generation: { response_format: { type: "json_object" } },
      },
      response: { content: "not json" },
    }), {
      runId: "speedtest_exposure/openai",
    }),
  ];
}

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

function overlappingProviderFetch(startedProviders: Set<ProviderName>): ProviderFetch {
  let releaseBothStarted: (() => void) | undefined;
  let bothProvidersStarted = false;
  const bothStarted = new Promise<void>((resolve) => {
    releaseBothStarted = resolve;
  });

  return async (url, init) => {
    const provider = providerFromUrl(url);
    startedProviders.add(provider);
    if (!bothProvidersStarted && startedProviders.size >= 2) {
      bothProvidersStarted = true;
      releaseBothStarted?.();
    }
    await Promise.race([
      bothStarted,
      timeout(1_000, "provider parallel runner did not overlap provider jobs"),
    ]);

    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    if (provider === "gemini") return geminiResponse(url, body);
    if (url.endsWith("/responses")) return openAiResponsesResponse(body);
    if (body.stream === true) return openAiStreamResponse(body);
    return openAiChatResponse(body);
  };
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function providerFromUrl(url: string): Extract<ProviderName, "openai" | "gemini"> {
  return url.includes("generativelanguage.googleapis.com") || url.includes(":generateContent") ||
      url.includes(":streamGenerateContent")
    ? "gemini"
    : "openai";
}

function openAiChatResponse(body: Record<string, unknown>): Response {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const message = hasTools
    ? {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-suite",
          type: "function",
          function: {
            name: "record_plan",
            arguments: JSON.stringify({
              component: "billing worker",
              riskLevel: "medium",
              checks: ["verify retries", "review metrics"],
            }),
          },
        }],
      }
    : { role: "assistant", content: responseContentForBody(body) };
  return new Response(JSON.stringify({
    id: "chatcmpl-suite",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    choices: [{ finish_reason: hasTools ? "tool_calls" : "stop", message }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      prompt_tokens_details: body.metadata ? { cached_tokens: 15 } : undefined,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-chat" },
  });
}

function openAiResponsesResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "resp-suite",
    object: "response",
    created_at: 1782993603,
    status: "completed",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    output_text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
    output: [{
      id: "msg-suite",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
        annotations: [],
      }],
    }],
    usage: {
      input_tokens: 90,
      output_tokens: 35,
      total_tokens: 125,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-responses" },
  });
}

function openAiStreamResponse(body: Record<string, unknown>): Response {
  const model = String(body.model ?? "gpt-4o-mini-2024-07-18");
  const text = [
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: { content: "review " }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: { content: "complete" }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 140, completion_tokens: 45, total_tokens: 185 },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "provider-stream" },
  });
}

function geminiResponse(url: string, body: Record<string, unknown>): Response {
  if (url.includes(":streamGenerateContent")) return geminiStreamResponse();
  return new Response(JSON.stringify(geminiPayload(body)), {
    status: 200,
    headers: { "content-type": "application/json", "x-goog-request-id": "provider-gemini" },
  });
}

function geminiStreamResponse(): Response {
  const text = [
    `data: ${JSON.stringify(geminiPayload({}, "review "))}`,
    "",
    `data: ${JSON.stringify(geminiPayload({}, "complete", "STOP"))}`,
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-goog-request-id": "provider-gemini-stream" },
  });
}

function geminiPayload(
  body: Record<string, unknown>,
  text = responseContentForBody(body),
  finishReason = "STOP",
): Record<string, unknown> {
  return {
    candidates: [{
      content: { role: "model", parts: [{ text }] },
      finishReason,
    }],
    usageMetadata: {
      promptTokenCount: 90,
      candidatesTokenCount: 25,
      totalTokenCount: 115,
      serviceTier: "standard",
    },
    modelVersion: "gemini-2.5-flash",
    responseId: "gemini-suite-response",
  };
}

function responseContentForBody(body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (serialized.includes("invoice reconciliation")) return "Billing Reliability";
  if (serialized.includes("deployment checks")) return "1. Check migrations\n2. Check rollback\n3. Check metrics";
  if (serialized.includes("json_schema")) {
    return "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}";
  }
  return "The maintenance note is ready for review.";
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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
