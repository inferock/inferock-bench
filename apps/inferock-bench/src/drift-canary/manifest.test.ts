import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH,
  computeDriftCanaryManifestHash,
  driftCanaryManifestUrl,
  loadDriftCanaryManifest,
  loadDriftCanaryManifestFromValue,
} from "./manifest.js";

describe("drift canary manifest", () => {
  it("loads a fixed MIT-attributed 25 GSM8K-Platinum plus 25 MMLU subset", async () => {
    const manifest = await loadDriftCanaryManifest();

    expect(manifest.schemaVersion).toBe("inferock-drift-canary-manifest-v1");
    expect(manifest.suiteVersion).toBe("inferock-drift-canary-v1");
    expect(manifest.baselineRunCount).toBe(3);
    expect(manifest.alpha).toBe(0.05);
    expect(manifest.protocol).toMatchObject({
      promptSetVersion: "drift-canary-prompt-set-v1",
      temperature: 0,
      temperatureMode: "fixed_0_unless_provider_rejects",
      providerDefaultTemperatureModels: [
        "anthropic:claude-4.7-plus-or-5",
        "openai:gpt-5-or-o-series",
        "openrouter:moonshotai/kimi-k2.7-code",
      ],
      maxCompletionTokensLowerBound: 256,
    });
    expect(manifest.items).toHaveLength(50);
    expect(manifest.items.filter((item) => item.dataset === "gsm8k_platinum")).toHaveLength(25);
    expect(manifest.items.filter((item) => item.dataset === "mmlu_hendrycks_test")).toHaveLength(25);
    expect(manifest.provenance.gsm8kPlatinum.license).toBe("MIT");
    expect(manifest.provenance.mmlu.license).toBe("MIT");
    expect(manifest.provenance.simpleEvals.use).toContain("no copied code");

    const raw = JSON.parse(await readFile(driftCanaryManifestUrl, "utf8")) as unknown;
    expect(computeDriftCanaryManifestHash(raw)).toBe(CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH);
  });

  it("rejects item-count drift inside v1", async () => {
    const manifest = await loadDriftCanaryManifest();
    const mutated = {
      ...manifest,
      items: manifest.items.slice(1),
    };

    expect(() => loadDriftCanaryManifestFromValue(mutated)).toThrow(/25 GSM8K-Platinum and 25 MMLU/i);
  });
});
