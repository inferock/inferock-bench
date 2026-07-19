import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { normalizeCanonicalEvent } from "@inferock/measure/canonical-event";
import { createAgentChildEnv, buildOpenCodeLaunch, writeOpenCodeWorkspaceConfig, type OpenCodeLaunch } from "../agent-mode/opencode-adapter.js";
import { AGENT_CODING_CORPUS, writeAgentCorpusWorkspace } from "../agent-mode/corpus.js";
import { redactAgentLogLine } from "../agent-mode/redaction.js";
import { runSdkRetryWorker } from "../agent-mode/sdk-retry-worker.js";
import { benchKeyFromConfig, type BenchConfig } from "../config.js";
import { ensurePrivateDir } from "../private-files.js";
import {
  createBenchApp,
  createBenchKeyCallBudget,
  type AdditionalBenchKeyGrant,
  type BenchKeyCallBudget,
  type ProviderFetch,
} from "../proxy.js";
import type { EventStore } from "../storage.js";
import type { ProviderName } from "../provider.js";
import type { CoverageEstimate } from "./estimate.js";
import type { LoadedCoverageSuiteManifest } from "./manifest.js";
import type { LoadedCoverageTokenBaseline } from "./baseline.js";
import {
  runBuiltInCoverageSuite,
  type BuiltInCoverageSuiteRunResult,
  type CoverageSuiteProgressEvent,
  type SpeedTestAgentOrganicTaskReceipt,
  type SpeedTestAgentReceipt,
} from "./runner.js";

export interface AgentProcessResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly version?: string;
}

export interface AgentProcessRunControls {
  readonly abortSignal?: AbortSignal;
  readonly organicTaskId?: string;
  readonly maxCalls?: number;
  readonly maxWallTimeMs?: number;
}

export type AgentProcessRunner = (
  launch: OpenCodeLaunch,
  controls?: AgentProcessRunControls,
) => Promise<AgentProcessResult>;

export interface AgentProcessBudgetResult {
  readonly status: "completed" | "budget_bounded";
  readonly result: AgentProcessResult;
  readonly callsObserved: number;
  readonly rejectedAttempts: number;
  readonly inFlightAtBound: number;
  readonly concurrencyLimit: number;
  readonly elapsedMs: number;
  readonly budgetBoundedReason?: "max_calls" | "max_wall_time";
}

export interface AgentCoverageSuiteRunInput {
  readonly runId: string;
  readonly provider: ProviderName;
  readonly suite: LoadedCoverageSuiteManifest;
  readonly baseline: LoadedCoverageTokenBaseline;
  readonly estimate: CoverageEstimate;
  readonly config: BenchConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly store: EventStore;
  readonly providerFetch?: ProviderFetch;
  readonly benchHome: string;
  readonly executablePath: string;
  readonly agentSource: "auto-provisioned" | "user-supplied";
  readonly agentVersion?: string;
  readonly acceptedAgentInstallHash?: string;
  readonly agentProcessRunner?: AgentProcessRunner;
  readonly log?: (line: string) => void;
  readonly startedAt?: string;
  readonly consentedAt?: string;
  readonly abortSignal?: AbortSignal;
  readonly onProgress?: (event: CoverageSuiteProgressEvent) => void | Promise<void>;
}

const AGENT_KEY_TTL_MS = 30 * 60_000;
const AGENT_ORGANIC_CALL_CONCURRENCY_LIMIT = 1;

export async function runAgentCoverageSuite(
  input: AgentCoverageSuiteRunInput,
): Promise<BuiltInCoverageSuiteRunResult> {
  const selectedModel = input.estimate.selectedModels.find((model) => model.provider === input.provider);
  if (!selectedModel) throw new Error(`Agent run missing selected model for ${input.provider}.`);
  const runRoot = join(input.benchHome, "runs", input.runId, input.provider);
  const workspace = join(runRoot, "workspace");
  const home = join(runRoot, "home");
  await ensurePrivateDir(home);
  const localKey = `ibl_agent_${randomBytes(16).toString("hex")}`;
  const localKeyGrant: AdditionalBenchKeyGrant = {
    key: localKey,
    annotation: {
      runId: input.runId,
      workloadClass: "coding_agent",
    },
    provider: input.provider,
    models: [selectedModel.model],
    expiresAt: new Date(Date.now() + AGENT_KEY_TTL_MS).toISOString(),
  };
  let revoked = false;
  const revokeLocalKey = (): void => {
    if (revoked) return;
    revoked = true;
    localKeyGrant.revokedAt = new Date().toISOString();
  };
  input.abortSignal?.addEventListener("abort", revokeLocalKey, { once: true });
  const app = createBenchApp({
    config: input.config,
    env: input.env,
    store: input.store,
    providerFetch: input.providerFetch,
    log: input.log,
    additionalBenchKeys: [localKeyGrant],
  });
  const server = await listenOnLoopback(app.fetch);
  try {
    const proxyBaseUrl = `http://127.0.0.1:${server.port}`;
    const workspaceTask = await writeAgentCorpusWorkspace({ workspace });
    await writeOpenCodeWorkspaceConfig({
      workspace,
      provider: input.provider,
      model: selectedModel.model,
      proxyBaseUrl,
    });
    const env = createAgentChildEnv({
      inheritedEnv: input.env ?? process.env,
      workspace,
      home,
      localKey,
      provider: input.provider,
      model: selectedModel.model,
    });
    const sdkRetryCallBudget = createBenchKeyCallBudget({
      maxCalls: 3,
      concurrencyLimit: 1,
    });
    localKeyGrant.callBudget = sdkRetryCallBudget;
    let sdkRetry: Awaited<ReturnType<typeof runSdkRetryWorker>>;
    try {
      sdkRetry = await runSdkRetryWorker({
        provider: input.provider,
        model: selectedModel.model,
        proxyBaseUrl,
        localKey,
        runId: input.runId,
        store: input.store,
        log: input.log,
      });
    } finally {
      delete localKeyGrant.callBudget;
    }
    const budget = input.suite.agentMode.organicTaskBudget;
    const corpusTasks = AGENT_CODING_CORPUS.tasks.slice(0, budget.corpusTaskCount);
    if (corpusTasks.length !== budget.corpusTaskCount) {
      throw new Error(`Agent organic budget references ${budget.corpusTaskCount} tasks but corpus has ${AGENT_CODING_CORPUS.tasks.length}.`);
    }
    const agentOrganicTasks: SpeedTestAgentOrganicTaskReceipt[] = [];
    let observedAgentVersion = input.agentVersion;
    for (const task of corpusTasks) {
      const launch = buildOpenCodeLaunch({
        executablePath: input.executablePath,
        workspace,
        provider: input.provider,
        model: selectedModel.model,
        prompt: organicTaskPrompt(task.slug),
        env,
      });
      const callBudget = createBenchKeyCallBudget({
        maxCalls: budget.maxCallsPerTask,
        concurrencyLimit: AGENT_ORGANIC_CALL_CONCURRENCY_LIMIT,
      });
      localKeyGrant.callBudget = callBudget;
      let budgeted: AgentProcessBudgetResult;
      try {
        budgeted = await runAgentProcessWithBudget({
          launch,
          runner: input.agentProcessRunner ?? spawnAgentProcess,
          parentAbortSignal: input.abortSignal,
          taskId: task.slug,
          maxCalls: budget.maxCallsPerTask,
          maxWallTimeMs: budget.maxWallTimeMsPerTask,
          callBudget,
          countOrganicCalls: () => countOrganicAgentProviderDispatches(input.store, input.runId),
          countOrganicRejectedAttempts: () => countOrganicAgentRejectedAttempts(input.store, input.runId),
        });
      } finally {
        delete localKeyGrant.callBudget;
      }
      agentOrganicTasks.push({
        taskId: task.slug,
        status: budgeted.status,
        callsObserved: budgeted.callsObserved,
        rejectedAttempts: budgeted.rejectedAttempts,
        maxCalls: budget.maxCallsPerTask,
        inFlightAtBound: budgeted.inFlightAtBound,
        concurrencyLimit: budgeted.concurrencyLimit,
        elapsedMs: budgeted.elapsedMs,
        maxWallTimeMs: budget.maxWallTimeMsPerTask,
        ...(budgeted.budgetBoundedReason ? { budgetBoundedReason: budgeted.budgetBoundedReason } : {}),
      });
      observedAgentVersion ??= budgeted.result.version;
      if (budgeted.status !== "budget_bounded" && budgeted.result.exitCode !== 0) {
        throw new Error([
          `agent process failed with exit ${budgeted.result.exitCode}`,
          budgeted.result.stdout ? redactAgentLogLine(budgeted.result.stdout) : "",
          budgeted.result.stderr ? redactAgentLogLine(budgeted.result.stderr) : "",
        ].filter(Boolean).join("\n"));
      }
    }
    const harness = await runBuiltInCoverageSuite({
      runId: input.runId,
      suite: input.suite,
      baseline: input.baseline,
      estimate: input.estimate,
      config: {
        ...input.config,
        benchKey: input.config.benchKey ?? benchKeyFromConfig(input.config, input.env),
      },
      env: input.env,
      store: input.store,
      providerFetch: input.providerFetch,
      log: input.log,
      startedAt: input.startedAt,
      consentedAt: input.consentedAt,
      abortSignal: input.abortSignal,
      onProgress: input.onProgress,
    });
    const agent: SpeedTestAgentReceipt = {
      name: "opencode-ai",
      version: observedAgentVersion ?? "1.17.13",
      source: input.agentSource,
    };
    return {
      ...harness,
      receipt: {
        ...harness.receipt,
        run: {
          ...harness.receipt.run,
          generator: "agent",
          providerId: input.provider,
        },
        consent: {
          ...harness.receipt.consent,
          ...(input.acceptedAgentInstallHash ? { acceptedAgentInstallHash: input.acceptedAgentInstallHash } : {}),
        },
        agent,
        trafficMix: {
          organicAgentTasks: workspaceTask.taskCount,
          harnessPreconditionTasks: input.suite.tasks.length,
          driftCanaryCalls: harness.receipt.driftCanary?.plannedCallCount ?? 0,
          sdkRetryWorkerCalls: sdkRetry.callsLaunched,
        },
        agentOrganicTasks,
        providerScope: {
          provider: input.provider,
          selectedProviders: [input.provider],
          parallelProviderCount: 1,
          localContentionPossible: false,
        },
      },
    };
  } finally {
    revokeLocalKey();
    input.abortSignal?.removeEventListener("abort", revokeLocalKey);
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

async function listenOnLoopback(fetchHandler: (request: Request) => Response | Promise<Response>):
  Promise<{ readonly port: number; close(callback: (error?: Error) => void): void }> {
  return await new Promise((resolve) => {
    const server = serve({
      fetch: fetchHandler,
      hostname: "127.0.0.1",
      port: 0,
    }, (info) => {
      resolve({
        port: info.port,
        close: (callback) => server.close(callback),
      });
    });
  });
}

export async function runAgentProcessWithBudget(input: {
  readonly launch: OpenCodeLaunch;
  readonly runner: AgentProcessRunner;
  readonly parentAbortSignal?: AbortSignal;
  readonly taskId: string;
  readonly maxCalls: number;
  readonly maxWallTimeMs: number;
  readonly callBudget?: BenchKeyCallBudget;
  readonly countOrganicCalls: () => Promise<number>;
  readonly countOrganicRejectedAttempts?: () => Promise<number>;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
}): Promise<AgentProcessBudgetResult> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const initialCalls = await input.countOrganicCalls();
  const initialRejectedAttempts = input.countOrganicRejectedAttempts
    ? await input.countOrganicRejectedAttempts()
    : 0;
  const controller = new AbortController();
  let budgetBoundedReason: "max_calls" | "max_wall_time" | undefined;
  let callsObserved = 0;
  const abortForParent = (): void => controller.abort(input.parentAbortSignal?.reason);
  input.parentAbortSignal?.addEventListener("abort", abortForParent, { once: true });
  const timer = setTimeout(() => {
    budgetBoundedReason = "max_wall_time";
    controller.abort(new Error("agent organic task wall-time budget reached"));
  }, input.maxWallTimeMs);
  const poller = setInterval(() => {
    void input.countOrganicCalls()
      .then((count) => {
        callsObserved = Math.max(0, count - initialCalls);
        if (!budgetBoundedReason && callsObserved >= input.maxCalls) {
          budgetBoundedReason = "max_calls";
          controller.abort(new Error("agent organic task call budget reached"));
        }
      })
      .catch(() => undefined);
  }, input.pollIntervalMs ?? 250);
  try {
    const result = await input.runner(input.launch, {
      abortSignal: controller.signal,
      organicTaskId: input.taskId,
      maxCalls: input.maxCalls,
      maxWallTimeMs: input.maxWallTimeMs,
    });
    callsObserved = Math.max(0, await input.countOrganicCalls() - initialCalls);
    if (!budgetBoundedReason && callsObserved >= input.maxCalls) {
      budgetBoundedReason = "max_calls";
    }
    return {
      status: budgetBoundedReason ? "budget_bounded" : "completed",
      result,
      callsObserved,
      rejectedAttempts: await rejectedAttemptsForResult(input, initialRejectedAttempts),
      inFlightAtBound: inFlightAtBoundForResult(input.callBudget, budgetBoundedReason, input.maxCalls, callsObserved),
      concurrencyLimit: input.callBudget?.concurrencyLimit ?? AGENT_ORGANIC_CALL_CONCURRENCY_LIMIT,
      elapsedMs: Math.max(0, now() - startedAt),
      ...(budgetBoundedReason ? { budgetBoundedReason } : {}),
    };
  } finally {
    clearTimeout(timer);
    clearInterval(poller);
    input.parentAbortSignal?.removeEventListener("abort", abortForParent);
  }
}

async function rejectedAttemptsForResult(
  input: {
    readonly callBudget?: BenchKeyCallBudget;
    readonly countOrganicRejectedAttempts?: () => Promise<number>;
  },
  initialRejectedAttempts: number,
): Promise<number> {
  if (!input.countOrganicRejectedAttempts) return input.callBudget?.rejectedAttempts ?? 0;
  return Math.max(0, await input.countOrganicRejectedAttempts() - initialRejectedAttempts);
}

function inFlightAtBoundForResult(
  callBudget: BenchKeyCallBudget | undefined,
  budgetBoundedReason: "max_calls" | "max_wall_time" | undefined,
  maxCalls: number,
  callsObserved: number,
): number {
  if (callBudget) return callBudget.inFlightAtBound;
  return budgetBoundedReason === "max_calls" || callsObserved >= maxCalls
    ? AGENT_ORGANIC_CALL_CONCURRENCY_LIMIT
    : 0;
}

async function countOrganicAgentProviderDispatches(store: EventStore, runId: string): Promise<number> {
  const records = await store.readAll();
  return records.filter((record) =>
    record.runId === runId &&
    eventWorkloadClass(record) === "coding_agent" &&
    !isLocalAgentRejectedAttempt(record)
  ).length;
}

async function countOrganicAgentRejectedAttempts(store: EventStore, runId: string): Promise<number> {
  const records = await store.readAll();
  return records.filter((record) =>
    record.runId === runId &&
    eventWorkloadClass(record) === "coding_agent" &&
    isLocalAgentRejectedAttempt(record)
  ).length;
}

function eventWorkloadClass(record: Awaited<ReturnType<EventStore["readAll"]>>[number]): string | undefined {
  const event = record.event as { readonly request?: { readonly workloadClass?: unknown }; readonly meta?: { readonly workloadClass?: unknown } };
  return typeof event.request?.workloadClass === "string"
    ? event.request.workloadClass
    : typeof event.meta?.workloadClass === "string"
      ? event.meta.workloadClass
      : undefined;
}

function isLocalAgentRejectedAttempt(record: Awaited<ReturnType<EventStore["readAll"]>>[number]): boolean {
  const event = normalizeCanonicalEvent(record.event);
  return event.response.statusCode === 429 &&
    (
      event.response.rawErrorType === "agent_call_budget_exhausted" ||
      event.response.rawErrorType === "agent_call_concurrency_limit" ||
      event.response.rawErrorType === "agent_no_active_task_budget"
    );
}

function organicTaskPrompt(slug: string): string {
  return [
    `Fix only the failing JavaScript exercise in ./${slug}.`,
    `Run node --test ./${slug} from the workspace and leave that exercise passing.`,
    "Use only files inside this workspace.",
  ].join(" ");
}

async function spawnAgentProcess(
  launch: OpenCodeLaunch,
  controls: AgentProcessRunControls = {},
): Promise<AgentProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += redactAgentLogLine(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr += redactAgentLogLine(String(chunk));
    });
    const abort = (): void => {
      if (child.exitCode === null) child.kill("SIGTERM");
    };
    controls.abortSignal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      controls.abortSignal?.removeEventListener("abort", abort);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
