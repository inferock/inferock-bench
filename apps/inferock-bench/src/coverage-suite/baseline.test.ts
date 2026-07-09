import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCoverageSuiteManifest } from "./manifest.js";
import {
  deriveCoverageTokenBaselineFromCovrun,
  loadCoverageTokenBaseline,
  loadCoverageTokenBaselineFromValue,
} from "./baseline.js";

// Package-local sanitized copies of the 2026-07-04 covrun artifacts: the test
// must run anywhere the package does (CI checkout, OSS export), never reach
// outside the package for repo-internal memory/ files.
const FIXTURES_DIR = fileURLToPath(new URL("./__fixtures__", import.meta.url));
const COVRUN_REPORT = join(FIXTURES_DIR, "covrun-report.md");
const COVRUN_PRECONDITIONS = join(FIXTURES_DIR, "covrun-preconditions.md");

describe("coverage token baseline", () => {
  it("loads the checked-in measured baseline with real per-task samples", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = await loadCoverageTokenBaseline();

    expect(baseline.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.provenance.sourceCommit).not.toBe("unknown");
    expect(baseline.tasks).toHaveLength(suite.tasks.length);
    expect(baseline.tasks.every((task) => task.provenance === "covrun_measured")).toBe(true);
    expect(Object.values(baseline.provenance.sampleCountByTask).every((count) => count > 0)).toBe(true);
  });

  it("rejects stale suite manifest hashes", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = completeBaselineForSuite(suite);

    expect(() =>
      loadCoverageTokenBaselineFromValue(
        { ...baseline, suiteManifestHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
        suite,
      )
    ).toThrow(/suite manifest hash/i);
  });

  it("rejects incomplete task coverage", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = completeBaselineForSuite(suite);

    expect(() =>
      loadCoverageTokenBaselineFromValue(
        { ...baseline, tasks: baseline.tasks.slice(1) },
        suite,
      )
    ).toThrow(/missing task/i);
  });

  it("derives bootstrap-required placeholders from covrun reports that lack per-task token samples", async () => {
    const suite = await loadCoverageSuiteManifest();
    const outputDir = await mkdtemp(join(tmpdir(), "inferock-baseline-"));
    const outputPath = join(outputDir, "coverage-suite-v1.tokens.json");

    const baseline = await deriveCoverageTokenBaselineFromCovrun({
      suite,
      reportPath: COVRUN_REPORT,
      preconditionsPath: COVRUN_PRECONDITIONS,
      sourcePath: "/tmp/inferock-covrun-assets/",
      sourceCommit: "test-commit",
      outputPath,
    });

    expect(baseline.provenance.providerModelsMeasured).toEqual([
      "openai:gpt-4o-mini-2024-07-18",
      "anthropic:claude-haiku-4-5-20251001",
    ]);
    expect(baseline.tasks).toHaveLength(suite.tasks.length);
    expect(baseline.tasks.every((task) => task.provenance === "bootstrap_required")).toBe(true);
    expect(await readFile(outputPath, "utf8")).toContain("\"bootstrap_required\"");
    expect(() => loadCoverageTokenBaselineFromValue(baseline, suite)).toThrow(/bootstrap_required/i);
  });

  it("fails loud when deriving a baseline without git source provenance", async () => {
    const suite = await loadCoverageSuiteManifest();
    const repoCwd = await mkdtemp(join(tmpdir(), "inferock-baseline-no-git-"));
    const outputDir = await mkdtemp(join(tmpdir(), "inferock-baseline-output-"));
    const outputPath = join(outputDir, "coverage-suite-v1.tokens.json");

    await expect(deriveCoverageTokenBaselineFromCovrun({
      suite,
      reportPath: COVRUN_REPORT,
      preconditionsPath: COVRUN_PRECONDITIONS,
      sourcePath: "/tmp/inferock-covrun-assets/",
      repoCwd,
      outputPath,
    })).rejects.toThrow(/without git source commit/i);
    await expect(readFile(outputPath, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("loads a complete measured baseline for estimator tests", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = completeBaselineForSuite(suite);

    expect(loadCoverageTokenBaselineFromValue(baseline, suite).tasks).toHaveLength(suite.tasks.length);
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
