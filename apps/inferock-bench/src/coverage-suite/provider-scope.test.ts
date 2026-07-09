import { describe, expect, it } from "vitest";
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
    expect(rendered).toContain("provider openai ledger: money loss");
    expect(rendered).toContain("provider anthropic ledger: money loss");
    expect(rendered).toContain("provider gemini ledger: money loss");
    expect(rendered).toContain("time lost");
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
