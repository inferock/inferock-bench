import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AGENT_CODING_CORPUS } from "./corpus.js";

describe("agent coding corpus", () => {
  it("vendors only license-vetted Exercism JavaScript tasks with attribution", () => {
    expect(AGENT_CODING_CORPUS.corpusId).toBe("agent-coding-corpus-exercism-js-v1");
    expect(AGENT_CODING_CORPUS.tasks.map((task) => task.slug)).toEqual([
      "hello-world",
      "two-fer",
      "leap",
      "rna-transcription",
      "resistor-color",
      "pangram",
    ]);
    for (const task of AGENT_CODING_CORPUS.tasks) {
      expect(task.license).toBe("MIT");
      expect(task.source.repository).toBe("https://github.com/exercism/javascript");
      expect(task.source.revision).toBe("d8cabd2cddcc2b20f0beb4e1d2d31ff946a93ccd");
      expect(task.canonicalData.repository).toBe("https://github.com/exercism/problem-specifications");
      expect(task.canonicalData.revision).toBe("77d50e4a40e93b90bf45fa610a2329087e4ca3d1");
      expect(task.localTestRuntime).toBe("node:test");
    }
  });

  it("keeps a source-exported attribution notice for the vendored corpus", async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const notice = await readFile(join(sourceDir, "CORPUS-NOTICE.md"), "utf8");
    const manifest = JSON.parse(await readFile(join(sourceDir, "CORPUS-MANIFEST.json"), "utf8")) as {
      corpusId: string;
      sources: readonly { repository: string; revision: string; license: string }[];
      tasks: readonly string[];
    };
    expect(notice).toContain("agent-coding-corpus-exercism-js-v1");
    expect(notice).toContain("d8cabd2cddcc2b20f0beb4e1d2d31ff946a93ccd");
    expect(notice).toContain("77d50e4a40e93b90bf45fa610a2329087e4ca3d1");
    expect(notice).toContain("MIT");
    expect(manifest.corpusId).toBe(AGENT_CODING_CORPUS.corpusId);
    expect(manifest.tasks).toEqual(AGENT_CODING_CORPUS.tasks.map((task) => task.slug));
    expect(manifest.sources.every((source) => source.license === "MIT")).toBe(true);
  });
});
