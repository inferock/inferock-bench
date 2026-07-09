import { describe, expect, it } from "vitest";
import { buildConformanceEstimate } from "./estimate.js";
import {
  hiddenTokenServingModelCandidates,
  isDisallowedConformanceProbeModel,
} from "./model-selection.js";

describe("conformance hidden-token model selection", () => {
  it.each([
    ["openai", "gpt-5.5-pro", true],
    ["openai", "gpt-5.5", true],
    ["openai", "gpt-4o-mini-2024-07-18", true],
    ["openai", "gpt-4o-mini", false],
    ["anthropic", "claude-mythos-5", true],
    ["anthropic", "claude-mythos-5-20260701", true],
    ["anthropic", "claude-sonnet-5-preview", true],
    ["anthropic", "claude-sonnet-5", false],
  ] as const)("classifies %s:%s disallowed=%s", (provider, model, disallowed) => {
    expect(isDisallowedConformanceProbeModel(provider, model)).toBe(disallowed);
  });

  it("does not include Glasswing, preview-gated, gpt-5.5, or retired dated IDs in hidden-token candidates", () => {
    const candidateSets = [
      hiddenTokenServingModelCandidates("openai", "hidden_token_positive"),
      hiddenTokenServingModelCandidates("openai", "hidden_token_negative"),
      hiddenTokenServingModelCandidates("anthropic", "hidden_token_positive"),
      hiddenTokenServingModelCandidates("anthropic", "hidden_token_negative"),
    ];

    for (const candidates of candidateSets) {
      expect(candidates).not.toEqual([]);
      for (const model of candidates) {
        expect(model).not.toMatch(/mythos|glasswing|preview|gpt-5\.5/i);
        expect(model).not.toBe("gpt-4o-mini-2024-07-18");
      }
    }
  });

  it("selects hidden-token defaults from bench-serving candidates instead of pricing-ranked canaries", () => {
    const estimate = buildConformanceEstimate({
      modules: ["hidden_token"],
      providers: ["openai", "anthropic"],
      spendCapUsd: 1,
      eventTime: "2026-07-08T12:00:00.000Z",
    });

    expect(estimate.selectedModels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.4-mini",
        purpose: "hidden_token_positive",
        presetPolicy: "bench-serving-default-conformance",
      }),
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o-mini",
        purpose: "hidden_token_negative",
        presetPolicy: "bench-serving-default-conformance",
      }),
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-5",
        purpose: "hidden_token_positive",
        presetPolicy: "bench-serving-default-conformance",
      }),
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        purpose: "hidden_token_negative",
        presetPolicy: "bench-serving-default-conformance",
      }),
    ]));
    expect(estimate.selectedModels.map((entry) => entry.model)).not.toContain("gpt-5.5-pro");
    expect(estimate.selectedModels.map((entry) => entry.model)).not.toContain("claude-mythos-5");
    expect(estimate.selectedModels.map((entry) => entry.model)).not.toContain("gpt-4o-mini-2024-07-18");
  });
});
