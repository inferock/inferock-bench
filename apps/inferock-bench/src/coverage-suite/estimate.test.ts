import { afterEach, describe, expect, it } from "vitest";
import {
  clearModelPricing,
  registerDefaultModelPricing,
  registerModelPricing,
} from "@inferock/measure/pricing";
import { loadCoverageSuiteManifest } from "./manifest.js";
import { loadCoverageTokenBaselineFromValue } from "./baseline.js";
import {
  estimateCoverageSuite,
  resolveCoverageModelPreset,
} from "./estimate.js";

describe("coverage suite estimator", () => {
  afterEach(() => {
    clearModelPricing();
    registerDefaultModelPricing();
  });

  it("resolves the default preset for all configured providers", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);

    const selected = resolveCoverageModelPreset({
      configuredProviders: ["openai", "anthropic"],
      suite,
      baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    expect(selected.map((model) => model.provider).sort()).toEqual(["anthropic", "openai"]);
    expect(selected.every((model) => model.presetPolicy === "pricing-registry-cheapest-compatible")).toBe(true);
  });

  it("estimates tokens and USD only through priced registry lookups", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selected = resolveCoverageModelPreset({
      configuredProviders: ["openai"],
      suite,
      baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    const estimate = estimateCoverageSuite({
      selectedModels: selected,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    expect(estimate.estimatedTokensByCategory.input).toBeGreaterThan(0);
    expect(estimate.estimatedTokensByCategory.output).toBeGreaterThan(0);
    expect(estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.estimatedUsdBand).toEqual({
      low: estimate.estimatedUsd,
      expected: estimate.estimatedUsd,
      high: estimate.estimatedUsd,
    });
    expect(estimate.estimatedUsdByModel).toHaveLength(1);
    expect(estimate.pricing.every((pricing) => pricing.pricingStatus === "priced")).toBe(true);
    expect(estimate.estimateHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const changedCap = estimateCoverageSuite({
      selectedModels: selected,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 2,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    expect(changedCap.estimateHash).not.toBe(estimate.estimateHash);
  });

  it("models agent organic traffic from the manifest budget and uses the high band as the ready spend estimate", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = [
      { provider: "openai" as const, model: "gpt-4o-mini-2024-07-18" },
      { provider: "anthropic" as const, model: "claude-haiku-4-5-20251001" },
    ];

    const builtIn = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const agent = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });

    expect(agent.estimatedUsdBand.low).toBeGreaterThan(builtIn.estimatedUsd);
    expect(agent.estimatedUsdBand.expected).toBeGreaterThan(agent.estimatedUsdBand.low);
    expect(agent.estimatedUsdBand.high).toBeGreaterThan(agent.estimatedUsdBand.expected);
    expect(agent.estimatedUsd).toBe(agent.estimatedUsdBand.high);
    expect(agent.estimatedUsdByModel).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "openai",
        organicBudget: expect.objectContaining({
          corpusTaskCount: suite.agentMode.organicTaskBudget.corpusTaskCount,
          maxCallsPerTask: suite.agentMode.organicTaskBudget.maxCallsPerTask,
          maxWallTimeMsPerTask: suite.agentMode.organicTaskBudget.maxWallTimeMsPerTask,
        }),
        plannedCallsBand: expect.objectContaining({
          high: expect.any(Number),
        }),
      }),
      expect.objectContaining({
        provider: "anthropic",
        organicBudget: expect.objectContaining({
          corpusTaskCount: suite.agentMode.organicTaskBudget.corpusTaskCount,
          maxCallsPerTask: suite.agentMode.organicTaskBudget.maxCallsPerTask,
          maxWallTimeMsPerTask: suite.agentMode.organicTaskBudget.maxWallTimeMsPerTask,
        }),
      }),
    ]));
    expect(agent.estimateHash).not.toBe(builtIn.estimateHash);
  });

  it("rejects Gemini agent estimates before agent install consent", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);

    expect(() =>
      estimateCoverageSuite({
        selectedModels: [{ provider: "gemini", model: "gemini-2.5-flash" }],
        suite,
        baseline,
        generator: "agent",
        spendCapUsd: 1,
        eventTime: "2026-07-05T00:00:00.000Z",
      })
    ).toThrow(/Agent generator currently supports OpenAI and Anthropic only/);
  });

  it("binds the estimate hash to baseline task usage content", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baselineValue = completeBaselineForSuite(suite);
    const baseline = loadCoverageTokenBaselineFromValue(baselineValue, suite);
    const mutatedBaseline = loadCoverageTokenBaselineFromValue({
      ...baselineValue,
      tasks: baselineValue.tasks.map((task) =>
        task.taskId === "json_schema_extract"
          ? {
              ...task,
              usage: {
                ...task.usage,
                input: task.usage.input + 1,
              },
            }
          : task
      ),
    }, suite);
    expect(mutatedBaseline.baselineVersion).toBe(baseline.baselineVersion);
    expect(mutatedBaseline.baselineContentDigest).not.toBe(baseline.baselineContentDigest);

    const selectedModels = [{ provider: "openai" as const, model: "gpt-4o-mini-2024-07-18" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const changedUsageEstimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline: mutatedBaseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    expect(changedUsageEstimate.estimateHash).not.toBe(estimate.estimateHash);
  });

  it("binds the estimate hash to the pricing registry version used for dollars", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = [{ provider: "openai" as const, model: "gpt-4o-mini-2024-07-18" }];
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    registerModelPricing({
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.60,
      cacheReadInputMultiplier: 0.5,
      reasoningUsdPerMillion: 0.60,
      toolUsdPerMillion: 0.60,
      effectiveFrom: "2024-07-18T00:00:00.000Z",
      source: "test pricing registry version",
      pricingVersion: "test-pricing-registry-v-next",
    });
    const changedPricingEstimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    expect(changedPricingEstimate.pricing).toContainEqual(expect.objectContaining({
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      pricingVersion: "test-pricing-registry-v-next",
    }));
    expect(changedPricingEstimate.estimateHash).not.toBe(estimate.estimateHash);
  });

  it("fails closed when pricing is unknown", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);

    expect(() =>
      estimateCoverageSuite({
        selectedModels: [{ provider: "openai", model: "unpriced-model" }],
        suite,
        baseline,
        generator: "built-in",
        spendCapUsd: 1,
        eventTime: "2026-07-04T00:00:00.000Z",
      })
    ).toThrow(/pricing_unknown/i);
  });

  it("fails closed when pricing is partial", async () => {
    clearModelPricing();
    registerModelPricing({
      provider: "openai",
      model: "partial-category-model",
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      source: "test partial model",
      pricingVersion: "test-registry",
    });

    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(
      {
        ...completeBaselineForSuite(suite),
        tasks: completeBaselineForSuite(suite).tasks.map((task) =>
          task.taskId === "json_schema_extract"
            ? {
                ...task,
                usage: {
                  ...task.usage,
                  categories: [{ category: "provider:openai:responses.usage.new_billed_tokens", tokens: 7 }],
                },
              }
            : task
        ),
      },
      suite,
    );

    expect(() =>
      estimateCoverageSuite({
        selectedModels: [{ provider: "openai", model: "partial-category-model" }],
        suite,
        baseline,
        generator: "built-in",
        spendCapUsd: 1,
        eventTime: "2026-07-04T00:00:00.000Z",
      })
    ).toThrow(/partial/i);
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
      providerModelsMeasured: [
        "openai:gpt-4o-mini-2024-07-18",
        "anthropic:claude-haiku-4-5-20251001",
      ],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 1])),
      notes: "test fixture",
    },
    quantile: "reviewed",
    tasks: suite.tasks.map((task, index) => ({
      taskId: task.taskId,
      plannedCalls: task.taskId === "concurrency_wave" ? 4 : 1,
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
