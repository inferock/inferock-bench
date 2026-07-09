import { describe, expect, it } from "vitest";
import { createBenchKeyCallBudget } from "../proxy.js";
import { runAgentProcessWithBudget } from "./agent-runner.js";

describe("agent organic task budget enforcement", () => {
  it("stops an organic task at the manifest call budget and records a normal budget-bounded result", async () => {
    let observedCalls = 0;

    const result = await runAgentProcessWithBudget({
      launch: {
        command: "/tmp/opencode",
        args: [],
        cwd: "/tmp/workspace",
        env: {},
      },
      taskId: "two-fer",
      maxCalls: 2,
      maxWallTimeMs: 10_000,
      pollIntervalMs: 1,
      countOrganicCalls: async () => observedCalls,
      runner: async (_launch, controls) => {
        observedCalls = 2;
        await new Promise<void>((resolve) => {
          controls?.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { exitCode: 143, stderr: "terminated" };
      },
    });

    expect(result).toMatchObject({
      status: "budget_bounded",
      callsObserved: 2,
      concurrencyLimit: 1,
      inFlightAtBound: 1,
      budgetBoundedReason: "max_calls",
      result: { exitCode: 143 },
    });
  });

  it("keeps local rejected attempts out of provider-dispatched call counts", async () => {
    let observedCalls = 0;
    let rejectedAttempts = 0;
    const callBudget = createBenchKeyCallBudget({ maxCalls: 4, concurrencyLimit: 1 });

    const result = await runAgentProcessWithBudget({
      launch: {
        command: "/tmp/opencode",
        args: [],
        cwd: "/tmp/workspace",
        env: {},
      },
      taskId: "resistor-color",
      maxCalls: 4,
      maxWallTimeMs: 10_000,
      pollIntervalMs: 1,
      callBudget,
      countOrganicCalls: async () => observedCalls,
      countOrganicRejectedAttempts: async () => rejectedAttempts,
      runner: async (_launch, controls) => {
        callBudget.startedCalls = 4;
        callBudget.completedCalls = 4;
        callBudget.rejectedAttempts = 1;
        rejectedAttempts = 1;
        observedCalls = 4;
        await new Promise<void>((resolve) => {
          controls?.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { exitCode: 143, stderr: "terminated" };
      },
    });

    expect(result.status).toBe("budget_bounded");
    expect(result.budgetBoundedReason).toBe("max_calls");
    expect(result.callsObserved).toBe(4);
    expect(result.callsObserved).toBeLessThanOrEqual(4);
    expect(result.rejectedAttempts).toBe(1);
    expect(result.inFlightAtBound).toBe(0);
  });
});
