import { afterEach, describe, expect, it } from "vitest";
import {
  clearOutputSchemas,
  detectBrokenOutput,
  type CanonicalEventV1,
} from "@inferock/measure";
import { loadCoverageSuiteManifest } from "./manifest.js";
import {
  BenchRequestAnnotationRegistry,
  registerCoverageSuiteOutputSchemas,
  registerCoverageSuiteTaskRequestAnnotations,
} from "./runner-annotations.js";

afterEach(() => {
  clearOutputSchemas();
});

describe("coverage-suite runner annotations", () => {
  it("coverage-suite-output-schema-registration: registers suite output schemas under the tenant before calls use outputSchemaVersion", async () => {
    const manifest = await loadCoverageSuiteManifest();
    const registered = registerCoverageSuiteOutputSchemas(manifest, { tenantId: "local" });

    expect(registered.map((entry) => entry.schemaVersion)).toEqual([
      "coverage-suite-v1.config-facts",
      "coverage-suite-v1.checkpoint",
    ]);

    const signal = detectBrokenOutput(schemaEvent("coverage-suite-v1.config-facts"));
    expect(signal).toMatchObject({
      code: "BROKEN_OUTPUT",
      evidence: {
        reason: "schema_validation_failed",
        outputSchemaVersion: "coverage-suite-v1.config-facts",
      },
    });
  });

  it("coverage-suite-task-request-annotations: creates unique local request IDs and bench-only annotations for suite tasks", async () => {
    const manifest = await loadCoverageSuiteManifest();
    const registry = new BenchRequestAnnotationRegistry();

    const first = registerCoverageSuiteTaskRequestAnnotations(registry, {
      manifest,
      runId: "run-speed-1",
      taskId: "known_answer_contract",
    });
    const second = registerCoverageSuiteTaskRequestAnnotations(registry, {
      manifest,
      runId: "run-speed-1",
      taskId: "known_answer_contract",
    });
    const operationTask = registerCoverageSuiteTaskRequestAnnotations(registry, {
      manifest,
      runId: "run-speed-1",
      taskId: "sdk_retry_idempotent",
    });

    expect(first.requestId).not.toBe(second.requestId);
    expect(first.headers["x-inferock-request-id"]).toBe(first.requestId);
    expect(first.headers).not.toHaveProperty("x-inferock-operation-id");
    expect(operationTask.headers["x-inferock-operation-id"]).toMatch(
      /^coverage-suite-v1:run-speed-1:sdk_retry_idempotent:/,
    );
    expect(() => registry.register(first.requestId, first.annotation))
      .toThrow(/already exists/);
    expect(registry.annotationForRequest(first.requestId)).toMatchObject({
      runId: "run-speed-1",
      suiteTaskId: "known_answer_contract",
      factualityContract: {
        contractId: "coverage-suite-v1.invoice-reconciliation-owner",
        expectedAnswer: "Billing Reliability",
      },
    });
  });
});

function schemaEvent(outputSchemaVersion: string): CanonicalEventV1 {
  return {
    request: {
      tenantId: "local",
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "req-schema",
      expectCompletion: true,
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: JSON.stringify({ serviceName: "gateway" }),
    },
    usage: {
      input: 100,
      output: 10,
      cache: { read: 0, creation: 0 },
    },
    timing: {
      startedAt: "2026-07-04T12:00:00.000Z",
      endedAt: "2026-07-04T12:00:01.000Z",
      latencyMs: 1_000,
    },
    meta: {
      attemptIndex: 0,
      schemaVersion: "v1",
      outputSchemaVersion,
    },
  };
}
