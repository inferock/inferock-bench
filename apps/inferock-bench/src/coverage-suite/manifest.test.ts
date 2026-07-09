import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKED_IN_COVERAGE_SUITE_V1_MANIFEST_HASH,
  computeCoverageSuiteManifestHash,
  immutableCoverageSuiteV1TaskIds,
  loadCoverageSuiteManifest,
  loadCoverageSuiteManifestFromValue,
  coverageSuiteManifestUrl,
} from "./manifest.js";

describe("coverage suite manifest", () => {
  it("loads the checked-in v1 manifest with the immutable task IDs and a stable hash", async () => {
    const suite = await loadCoverageSuiteManifest();

    expect(suite.suiteVersion).toBe("inferock-coverage-suite-v1");
    expect(suite.defaultGenerator).toBe("built-in");
    expect(suite.modelPresetPolicy).toBe("pricing-registry-cheapest-compatible");
    expect(suite.tasks.map((task) => task.taskId)).toEqual(immutableCoverageSuiteV1TaskIds);
    expect(suite.agentMode.organicTaskBudget).toMatchObject({
      corpusTaskCount: 6,
      maxCallsPerTask: expect.any(Number),
      maxWallTimeMsPerTask: expect.any(Number),
    });
    expect(suite.tasks.find((task) => task.taskId === "json_schema_extract")?.providerRoutes)
      .toContain("anthropic:messages");

    const raw = JSON.parse(await readFile(coverageSuiteManifestUrl, "utf8")) as unknown;
    expect(computeCoverageSuiteManifestHash(raw)).toBe(CHECKED_IN_COVERAGE_SUITE_V1_MANIFEST_HASH);
  });

  it("rejects task ID changes inside suite v1", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = {
      ...suite,
      tasks: suite.tasks.map((task) =>
        task.taskId === "known_answer_contract"
          ? { ...task, taskId: "known_answer_contract_renamed" }
          : task
      ),
    };

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/immutable task ids/i);
  });

  it("rejects forbidden failure-manufacturing task settings", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = {
      ...suite,
      tasks: suite.tasks.map((task) =>
        task.taskId === "long_stream_review"
          ? { ...task, requestBody: { ...task.requestBody, max_tokens: 8 } }
          : task
      ),
    };

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/tiny max token/i);
  });

  it("rejects manual duplicate request ID evidence in task definitions", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = {
      ...suite,
      tasks: suite.tasks.map((task) =>
        task.taskId === "sdk_retry_idempotent"
          ? {
              ...task,
              requestBody: {
                ...task.requestBody,
                headers: { "x-inferock-request-id": "same-id" },
              },
            }
          : task
      ),
    };

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/request id/i);
  });

  it("rejects invalid tool declarations structurally", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = {
      ...suite,
      tasks: suite.tasks.map((task) =>
        task.taskId === "tool_schema_plan"
          ? {
              ...task,
              requestBody: {
                ...task.requestBody,
                tools: [{
                  type: "function",
                  function: {
                    name: "",
                    parameters: {
                      type: "object",
                      properties: {},
                    },
                  },
                }],
              },
            }
          : task
      ),
    };

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/tool declaration/i);
  });

  it("rejects malformed tool parameter schemas structurally", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = mutateTask(suite, "tool_schema_plan", (task) => ({
      ...task,
      requestBody: {
        ...task.requestBody,
        tools: [{
          type: "function",
          function: {
            name: "record_plan",
            parameters: {
              type: "object",
              properties: {
                checks: { type: "array", items: { type: "not-a-json-schema-type" } },
              },
            },
          },
        }],
      },
    }));

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/schema/i);
  });

  it("rejects semantically empty coverage-suite tool schemas", async () => {
    const suite = await loadCoverageSuiteManifest();

    expect(() =>
      loadCoverageSuiteManifestFromValue(mutateToolSchema(suite, {
        type: "object",
        properties: {},
        additionalProperties: false,
      }))
    ).toThrow(/usable coverage-suite tool argument/i);

    expect(() =>
      loadCoverageSuiteManifestFromValue(mutateToolSchema(suite, {
        type: "object",
        properties: {
          x: {
            type: "object",
            properties: {},
          },
        },
      }))
    ).toThrow(/usable coverage-suite tool argument/i);
  });

  it("rejects tool choices that reference undeclared tools", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = mutateTask(suite, "tool_schema_plan", (task) => ({
      ...task,
      requestBody: {
        ...task.requestBody,
        tool_choice: { type: "function", function: { name: "missing_tool" } },
      },
    }));

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/undeclared tool/i);
  });

  it("rejects malformed tool choices structurally", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = mutateTask(suite, "tool_schema_plan", (task) => ({
      ...task,
      requestBody: {
        ...task.requestBody,
        tool_choice: { type: "function", function: { name: "" } },
      },
    }));

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/tool_choice/i);
  });

  it("rejects refusal-seeking and quota-stress probe text", async () => {
    const suite = await loadCoverageSuiteManifest();

    expect(() =>
      loadCoverageSuiteManifestFromValue(mutateTask(suite, "automatic_latency_token", (task) => ({
        ...task,
        promptTemplate: "Please refuse to answer this ordinary request.",
      })))
    ).toThrow(/forbidden/i);

    expect(() =>
      loadCoverageSuiteManifestFromValue(mutateTask(suite, "automatic_latency_token", (task) => ({
        ...task,
        promptTemplate: "Please exhaust the quota for this provider account.",
      })))
    ).toThrow(/forbidden/i);
  });

  it("rejects failure-seeking verbs near measure nouns", async () => {
    const suite = await loadCoverageSuiteManifest();
    const mutated = mutateTask(suite, "automatic_latency_token", (task) => ({
      ...task,
      promptTemplate: "Trigger a JSON schema failure in the final answer.",
    }));

    expect(() => loadCoverageSuiteManifestFromValue(mutated)).toThrow(/forbidden/i);
  });

  it("runner loader refuses manifests whose hash is not the checked-in v1 hash", async () => {
    const suite = await loadCoverageSuiteManifest();
    const tempDir = await mkdtemp(join(tmpdir(), "coverage-suite-manifest-"));
    const path = join(tempDir, "inferock-coverage-suite-v1.json");
    const mutated = mutateTask(suite, "automatic_latency_token", (task) => ({
      ...task,
      promptTemplate: "Summarize the supplied engineering note in four sentences.",
    }));
    const { manifestHash: _manifestHash, ...manifest } = mutated;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(loadCoverageSuiteManifest(path)).rejects.toThrow(/hash-pinned/i);
  });
});

type LoadedSuite = Awaited<ReturnType<typeof loadCoverageSuiteManifest>>;
type SuiteTask = LoadedSuite["tasks"][number];

function mutateTask(
  suite: LoadedSuite,
  taskId: string,
  mutate: (task: SuiteTask) => SuiteTask,
): LoadedSuite {
  return {
    ...suite,
    tasks: suite.tasks.map((task) => task.taskId === taskId ? mutate(task) : task),
  };
}

function mutateToolSchema(
  suite: LoadedSuite,
  schema: Record<string, unknown>,
): LoadedSuite {
  return mutateTask(suite, "tool_schema_plan", (task) => ({
    ...task,
    requestBody: {
      ...task.requestBody,
      tools: [{
        type: "function",
        function: {
          name: "record_plan",
          parameters: schema,
        },
      }],
    },
  }));
}
