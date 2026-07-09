import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { platform as processPlatform, stdin as processStdin, stdout as processStdout } from "node:process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { roundUsd } from "@inferock/measure/pricing";
import {
  applyProviderKeyUpdate,
  benchKeyFromConfig,
  DEFAULT_HOST,
  DEFAULT_PORT,
  ensureBenchHome,
  ensureGeneratedBenchKey,
  providerApiKey,
  providerKeyStatus,
  readBenchConfig,
  resolveBenchPaths,
  setReliabilityIndexEnabled,
  type BenchConfig,
  type ProviderKeyUpdate,
} from "./config.js";
import { runInit } from "./init.js";
import type { ProviderFetch } from "./proxy.js";
import { createReceiptBundle, renderReceipt, writeReceiptBundle } from "./receipt.js";
import {
  createShareCardModel,
  renderShareCard,
  writeShareCard,
  writeShareCardFile,
} from "./share-card.js";
import { startServer } from "./server.js";
import { JsonlEventStore } from "./storage.js";
import { renderReport, summarizeBenchEvents, type TimeWindow } from "./summary.js";
import { sendReliabilityIndexPayload } from "./telemetry.js";
import {
  coverageBaselineVersion,
  coverageBaselineContentDigest,
  coverageTokenBaselineUrl,
  loadCoverageTokenBaseline,
  resolveCoverageBaselineSourceCommit,
  type LoadedCoverageTokenBaseline,
} from "./coverage-suite/baseline.js";
import {
  estimateCoverageSuite,
  resolveCoverageModelPreset,
  type CoverageSelectedModel,
} from "./coverage-suite/estimate.js";
import {
  loadCoverageSuiteManifest,
  type CoverageGenerator,
  type LoadedCoverageSuiteManifest,
} from "./coverage-suite/manifest.js";
import {
  createMeasuredCoverageTokenBaseline,
  plannedCallsForCoverageSuiteTask,
  renderSpeedTestReceipt,
  SPEND_CAP_REACHED_MESSAGE,
  writeSpeedTestReceiptBundle,
} from "./coverage-suite/runner.js";
import { runProviderParallelCoverageSuite } from "./coverage-suite/provider-parallel-runner.js";
import { agentInstallConsentText, planAgentProvisioning } from "./agent-mode/provisioner.js";
import { AgentProvisioningFailureError } from "./agent-mode/provisioner.js";
import type { AgentProcessRunner } from "./coverage-suite/agent-runner.js";
import {
  createConformanceArtifactWriter,
  emptyConformanceSummary,
} from "./conformance/artifacts.js";
import {
  buildConformanceEstimate,
  DEFAULT_CONFORMANCE_SPEND_CAP_USD,
  renderConformanceEstimate,
} from "./conformance/estimate.js";
import { runStreamFixtureControls } from "./conformance/stream-fixtures.js";
import { runHiddenTokenFixtureControls } from "./conformance/hidden-token-fixtures.js";
import { runAcceptedRealProviderConformance } from "./conformance/real-provider.js";
import { renderConformanceSummary, summarizeConformanceLedger } from "./conformance/summary.js";
import {
  cliModuleToConformanceModule,
  type ConformanceCliModule,
  type ConformanceModule,
} from "./conformance/types.js";
import type { ProviderName } from "./provider.js";
import {
  isProviderName,
  providerApiKeyShapeResult,
  providerDisplayName,
  providerKeyShapeDescription,
  PROVIDER_NAMES,
} from "./provider.js";
import { BENCH_PACKAGE_VERSION } from "./version.js";

export interface CliRuntime {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
  readonly error?: (line: string) => void;
  readonly stdinIsTty?: boolean;
  readonly stdoutIsTty?: boolean;
  readonly prompt?: (question: string) => Promise<string>;
  readonly providerFetch?: ProviderFetch;
  readonly coverageBaseline?: LoadedCoverageTokenBaseline;
  readonly coverageBaselineUrl?: string | URL;
  readonly eventTime?: string;
  readonly agentProcessRunner?: AgentProcessRunner;
  readonly readStdin?: () => Promise<string>;
  readonly secretPrompt?: (question: string) => Promise<string>;
  readonly clipboardWrite?: (text: string) => Promise<boolean>;
  readonly serverProbe?: (url: string) => Promise<boolean>;
  readonly platform?: NodeJS.Platform;
}

export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime = {},
): Promise<void> {
  const env = runtime.env ?? process.env;
  const cwd = runtime.cwd ?? process.cwd();
  const log = runtime.log ?? console.log;
  const error = runtime.error ?? console.error;

  if (isHelpRequest(argv)) {
    log(helpText());
    return;
  }

  if (isVersionRequest(argv)) {
    log(BENCH_PACKAGE_VERSION);
    return;
  }

  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "start";
  const args = command === "start" ? (argv[0]?.startsWith("-") ? argv : argv.slice(1)) : argv.slice(1);
  const paths = resolveBenchPaths(env);
  if (!knownCommand(command)) {
    error(`Unknown command: ${command}`);
    error(helpText());
    throw new CliUsageError();
  }

  if (command === "status") {
    await runStatusCommand({
      paths,
      config: await readBenchConfig(paths),
      env,
      runtime,
      log,
    });
    return;
  }

  if (command === "conformance" && booleanArg(args, "--fixture-only")) {
    await ensureBenchHome(paths);
    await runConformanceCommand({
      args,
      paths,
      env,
      log,
      error,
      runtime,
    });
    return;
  }

  await ensureBenchHome(paths);
  let config = await readBenchConfig(paths);
  config = await ensureGeneratedBenchKey({ paths, config });

  if (command === "key") {
    await runKeyCommand({
      args,
      config,
      runtime,
      log,
      error,
    });
    return;
  }

  if (command === "setup") {
    await runSetupCommand({
      args,
      paths,
      config,
      runtime,
      log,
      error,
    });
    return;
  }

  if (command === "telemetry" || command === "index") {
    await runTelemetryCommand({
      command,
      args,
      paths,
      config,
      env,
      log,
    });
    return;
  }

  if (command === "init") {
    await runInit({
      cwd,
      host: stringArg(args, "--host"),
      port: numberArg(args, "--port"),
      patchFile: stringArg(args, "--patch"),
      yes: booleanArg(args, "--yes"),
      benchKey: config.benchKey ?? benchKeyFromConfig(config, env),
      log,
    });
    return;
  }

  if (command === "start") {
    await startServer({
      paths,
      config,
      host: stringArg(args, "--host"),
      port: numberArg(args, "--port"),
      env,
      stdinIsTty: runtime.stdinIsTty,
      stdoutIsTty: runtime.stdoutIsTty,
      log,
    });
    return;
  }

  if (command === "test") {
    await runTestCommand({
      args,
      paths,
      config,
      cwd,
      env,
      log,
      error,
      runtime,
    });
    return;
  }

  if (command === "conformance") {
    await runConformanceCommand({
      args,
      paths,
      config,
      env,
      log,
      error,
      runtime,
    });
    return;
  }

  if (command === "report" || command === "live") {
    const summary = await currentSummary(paths.eventsFile, parseWindow(args), config);
    log(renderReport(summary));
    return;
  }

  if (command === "receipt") {
    const compact = booleanArg(args, "--compact");
    const jsonOnly = booleanArg(args, "--json");
    const shareCard = booleanArg(args, "--share-card");
    const noColor = booleanArg(args, "--no-color");
    const output = shareCard ? outputArg(args) : undefined;
    if (jsonOnly && shareCard) {
      error("Use either `--json` or `--share-card`, not both.");
      throw new CliUsageError();
    }
    const summary = await currentSummary(paths.eventsFile, parseWindow(args), config);
    const bundle = createReceiptBundle(summary);
    if (jsonOnly) {
      log(JSON.stringify(bundle, null, 2));
      return;
    }
    if (shareCard) {
      const rendered = renderShareCard(createShareCardModel(bundle), {
        color: !noColor && Boolean(runtime.stdoutIsTty ?? processStdout.isTTY),
      });
      log(rendered);
      if (output === "-") return;
      const path = output
        ? await writeShareCardFile(output, rendered)
        : await writeShareCard(paths.receiptsDir, bundle.generatedAt, rendered);
      log(`Share card: ${displayShareCardPath(path)}`);
      return;
    }
    log(renderReceipt(bundle, compact));
    const path = await writeReceiptBundle(paths.receiptsDir, bundle);
    log(`JSON bundle: ${path}`);
    return;
  }

  error(`Unknown command: ${command}`);
  error(helpText());
  throw new CliUsageError();
}

function isHelpRequest(argv: readonly string[]): boolean {
  return argv[0] === "help" || argv.includes("--help") || argv.includes("-h");
}

function isVersionRequest(argv: readonly string[]): boolean {
  return argv[0] === "version" || argv.includes("--version") || argv.includes("-v");
}

function knownCommand(command: string): boolean {
  return [
    "index",
    "init",
    "key",
    "live",
    "receipt",
    "report",
    "setup",
    "start",
    "status",
    "telemetry",
    "test",
    "conformance",
  ].includes(command);
}

async function runKeyCommand(input: {
  readonly args: readonly string[];
  readonly config: BenchConfig;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}): Promise<void> {
  const action = input.args[0];
  if (action !== "reveal" && action !== "copy") {
    input.error("Use `inferock-bench key reveal` or `inferock-bench key copy`.");
    throw new CliUsageError();
  }

  const benchKey = input.config.benchKey ?? "";
  if (!benchKey.startsWith("ibl_")) {
    input.error("Local ibl_ bench key is missing. Run `inferock-bench start` once or remove the local config so a new key can be generated.");
    throw new Error("local ibl_ bench key is missing");
  }

  if (action === "reveal") {
    warnLocalBenchKeyReveal(input.error);
    input.log(benchKey);
    return;
  }

  const copied = await writeClipboard(benchKey, input.runtime);
  if (copied) {
    input.log("Local inferock-bench key copied to the clipboard.");
    return;
  }

  input.error("No clipboard is available here, so the local inferock-bench key is printed below.");
  warnLocalBenchKeyReveal(input.error);
  input.log(benchKey);
}

async function runSetupCommand(input: {
  readonly args: readonly string[];
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly config: BenchConfig;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}): Promise<void> {
  const providerText = input.args[0];
  if (!isProviderName(providerText)) {
    input.error(`Choose a provider: ${PROVIDER_NAMES.join(", ")}.`);
    throw new CliUsageError();
  }

  const rawKey = await readProviderKeyForSetup(providerText, input.runtime);
  const providerKey = rawKey.trim();
  const keyShape = providerApiKeyShapeResult(providerText, providerKey);
  if (!keyShape.ok) {
    input.error(`That does not look like ${providerKeyShapeDescription(providerText)}.`);
    throw new Error("provider key shape validation failed");
  }
  if (keyShape.requiresInteractiveConfirmation && !isInteractive(input.runtime)) {
    input.error(
      "Gemini key shape is not a known AIza or AQ. format. Non-interactive setup only accepts known Gemini key shapes; rerun setup in an interactive terminal to confirm an unknown Google-plausible shape.",
    );
    throw new Error("provider key shape validation failed");
  }
  if (keyShape.warning) input.error(`Warning: ${keyShape.warning}`);
  if (keyShape.requiresInteractiveConfirmation) {
    const answer = await promptLine(input.runtime, "Type SAVE to store this Gemini key: ");
    if (answer.trim() !== "SAVE") {
      input.error("Gemini key was not saved.");
      throw new Error("provider key shape confirmation failed");
    }
  }

  const config = await applyProviderKeyUpdate({
    paths: input.paths,
    config: input.config,
    update: providerKeyUpdate(providerText, providerKey),
  });
  const status = providerKeyStatus(providerText, config, {});
  input.log(`${providerDisplayName(providerText)} key saved locally (${status.maskedKey ?? "configured"}).`);
  input.log(`Config: ${input.paths.configFile}`);
}

async function runStatusCommand(input: {
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly config: BenchConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
}): Promise<void> {
  const healthUrl = localHealthUrl(input.env);
  const running = await serverRunning(healthUrl, input.runtime);
  const baseUrl = healthUrl.slice(0, -"/health".length);
  input.log([
    `inferock-bench ${BENCH_PACKAGE_VERSION}`,
    `store: ${input.paths.homeDir}`,
    `config: ${input.paths.configFile}`,
    `events: ${input.paths.eventsFile}`,
    `server: ${running ? "running" : "not running"} at ${baseUrl}`,
    "providers:",
    ...PROVIDER_NAMES.map((provider) => providerStatusLine(provider, input.config, input.env)),
  ].join("\n"));
}

function providerStatusLine(
  provider: ProviderName,
  config: BenchConfig,
  env: NodeJS.ProcessEnv,
): string {
  const status = providerKeyStatus(provider, config, env);
  if (!status.configured) return `  ${provider}: not configured`;
  return `  ${provider}: configured from ${status.source} (${status.maskedKey ?? "masked"})`;
}

function providerKeyUpdate(provider: ProviderName, key: string): ProviderKeyUpdate {
  if (provider === "openai") return { openaiApiKey: key };
  if (provider === "anthropic") return { anthropicApiKey: key };
  if (provider === "gemini") return { geminiApiKey: key };
  return { openrouterApiKey: key };
}

async function readProviderKeyForSetup(provider: ProviderName, runtime: CliRuntime): Promise<string> {
  if (isInteractive(runtime)) {
    return promptSecretLine(runtime, `${providerDisplayName(provider)} API key: `);
  }

  const piped = await readStandardInput(runtime);
  if (piped.trim().length === 0) {
    throw new Error(`Pipe ${providerKeyShapeDescription(provider)} into setup or run setup in an interactive terminal.`);
  }
  return piped;
}

function warnLocalBenchKeyReveal(error: (line: string) => void): void {
  error("Warning: this ibl_ key is a local-only inferock-bench credential. Treat it like a password for this gateway.");
}

async function promptSecretLine(runtime: CliRuntime, question: string): Promise<string> {
  if (runtime.secretPrompt) return runtime.secretPrompt(question);
  if (typeof processStdin.setRawMode !== "function") {
    throw new Error("Hidden key entry is not available in this terminal. Pipe the key into setup instead.");
  }

  processStdout.write(question);
  emitKeypressEvents(processStdin);
  const wasRaw = processStdin.isRaw;
  processStdin.setRawMode(true);
  processStdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;
    const finish = (result: { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: Error }) => {
      if (settled) return;
      settled = true;
      processStdin.off("keypress", onKeypress);
      processStdin.setRawMode(wasRaw);
      processStdout.write("\n");
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };
    const onKeypress = (text: string, key: KeypressKey) => {
      if (key.ctrl && key.name === "c") {
        finish({ ok: false, error: new Error("setup aborted") });
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish({ ok: true, value });
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        value = value.slice(0, -1);
        return;
      }
      if (!key.ctrl && text) value += text;
    };
    processStdin.on("keypress", onKeypress);
  });
}

interface KeypressKey {
  readonly name?: string;
  readonly ctrl?: boolean;
}

async function readStandardInput(runtime: CliRuntime): Promise<string> {
  if (runtime.readStdin) return runtime.readStdin();
  const chunks: Buffer[] = [];
  for await (const chunk of processStdin as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function writeClipboard(text: string, runtime: CliRuntime): Promise<boolean> {
  if (runtime.clipboardWrite) return runtime.clipboardWrite(text);
  for (const command of clipboardCommands(runtime.platform ?? processPlatform)) {
    if (await runClipboardCommand(command, text)) return true;
  }
  return false;
}

interface ClipboardCommand {
  readonly command: string;
  readonly args: readonly string[];
}

function clipboardCommands(platform: NodeJS.Platform): readonly ClipboardCommand[] {
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  if (platform === "win32") return [{ command: "clip.exe", args: [] }];
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

function runClipboardCommand(command: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command.command, [...command.args], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 1_000);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    child.on("error", () => finish(false));
    child.on("exit", (code) => finish(code === 0));
    child.stdin.on("error", () => undefined);
    child.stdin.end(text);
  });
}

function localHealthUrl(env: NodeJS.ProcessEnv): string {
  const host = env.INFEROCK_BENCH_HOST ?? DEFAULT_HOST;
  const port = portFromEnv(env) ?? DEFAULT_PORT;
  return `http://${host}:${port}/health`;
}

async function serverRunning(url: string, runtime: CliRuntime): Promise<boolean> {
  if (runtime.serverProbe) return runtime.serverProbe(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || typeof payload !== "object" || payload === null) return false;
    return (payload as { readonly service?: unknown }).service === "inferock-bench";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function portFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.INFEROCK_BENCH_PORT;
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}

async function runTelemetryCommand(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly config: Awaited<ReturnType<typeof readBenchConfig>>;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
}): Promise<void> {
  const action = input.args[0] ?? "status";
  const wantsReliabilityIndex = input.command === "index" || input.args.includes("--reliability-index");
  if (action === "enable" || action === "on") {
    if (!wantsReliabilityIndex) {
      input.log("Specify --reliability-index to enable reliability-index telemetry.");
      return;
    }
    const config = await setReliabilityIndexEnabled({
      paths: input.paths,
      config: input.config,
      enabled: true,
    });
    input.log("Reliability index enabled for anonymous aggregate failure counts only.");
    await printTelemetryPayload(input.paths.eventsFile, config, input.env, input.log);
    return;
  }

  if (action === "disable" || action === "off") {
    await setReliabilityIndexEnabled({
      paths: input.paths,
      config: input.config,
      enabled: false,
    });
    input.log("Reliability index disabled.");
    return;
  }

  input.log(input.config.reliabilityIndex?.enabled
    ? "Reliability index: enabled"
    : "Reliability index: off");
  await printTelemetryPayload(input.paths.eventsFile, input.config, input.env, input.log);
}

async function printTelemetryPayload(
  eventsFile: string,
  config: Awaited<ReturnType<typeof readBenchConfig>>,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<void> {
  const summary = await currentSummary(eventsFile, {}, config);
  const result = await sendReliabilityIndexPayload({ config, summary, env });
  log(result.message);
  log(JSON.stringify(result.payload, null, 2));
}

interface ConformanceCommandOptions {
  readonly modules: readonly ConformanceModule[];
  readonly providers: readonly ConformanceProvider[];
  readonly fixtureOnly: boolean;
  readonly spendCapUsd?: number;
  readonly acceptEstimateHash?: string;
  readonly json: boolean;
  readonly allowPricingUnknownForValidation: boolean;
}

type ConformanceProvider = Extract<ProviderName, "openai" | "anthropic">;

async function runConformanceCommand(input: {
  readonly args: readonly string[];
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly config?: BenchConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly runtime: CliRuntime;
}): Promise<void> {
  const options = parseConformanceOptions(input.args);
  const eventTime = input.runtime.eventTime ?? new Date().toISOString();
  const estimate = buildConformanceEstimate({
    modules: options.modules,
    providers: options.providers,
    spendCapUsd: options.spendCapUsd ?? DEFAULT_CONFORMANCE_SPEND_CAP_USD,
    eventTime,
    allowPricingUnknownForValidation: options.allowPricingUnknownForValidation,
  });

  if (options.fixtureOnly) {
    const result = await runFixtureOnlyConformance({
      paths: input.paths,
      options,
      estimate,
      eventTime,
    });
    input.log(options.json
      ? JSON.stringify(result, null, 2)
      : [
          "inferock-bench conformance fixture replay complete",
          `run: ${result.runId}`,
          `artifacts: ${result.artifactDir}`,
          `estimate hash: ${estimate.estimateHash}`,
        ].join("\n"));
    return;
  }

  if (options.spendCapUsd !== undefined && !options.acceptEstimateHash) {
    const message = "Conformance --spend-cap-usd override requires --accept-estimate <hash>.";
    input.error(message);
    throw new Error(message);
  }

  if (!options.json) input.log(renderConformanceEstimate(estimate));

  if (!await confirmConformanceRun({
    estimateHash: estimate.estimateHash,
    acceptEstimateHash: options.acceptEstimateHash,
    runtime: input.runtime,
    log: input.log,
    error: input.error,
    json: options.json,
  })) {
    input.log("aborted before provider calls");
    return;
  }

  if (!input.config) {
    throw new Error("Conformance real-provider mode requires bench config after estimate acceptance.");
  }

  const configuredProviders = options.providers.filter((provider) =>
    Boolean(providerApiKey(provider, input.config as BenchConfig, input.env))
  );
  if (configuredProviders.length === 0) {
    const message = "No validation provider key configured for requested conformance provider(s).";
    input.error(message);
    throw new Error(message);
  }

  const result = await runAcceptedRealProviderConformance({
    paths: input.paths,
    config: input.config,
    env: input.env,
    modules: options.modules,
    providers: configuredProviders,
    estimate,
    eventTime,
    providerFetch: input.runtime.providerFetch,
  });
  input.log(options.json
    ? JSON.stringify(result, null, 2)
    : [
        "inferock-bench conformance complete",
        `run: ${result.runId}`,
        `artifacts: ${result.artifactDir}`,
        renderConformanceSummary({
          summary: result.summary,
          entries: await createConformanceArtifactWriter({
            paths: input.paths,
            runId: result.runId,
            createdAt: eventTime,
            mode: "real_provider",
            modules: options.modules,
            providers: configuredProviders,
          }).readLedgerEntries(),
        }),
      ].join("\n"));
}

function parseConformanceOptions(args: readonly string[]): ConformanceCommandOptions {
  const modules = parseConformanceModules(args);
  const providers = parseConformanceProviders(args);
  const spendCapUsd = decimalArg(args, "--spend-cap-usd");
  return {
    modules,
    providers,
    fixtureOnly: booleanArg(args, "--fixture-only"),
    ...(spendCapUsd !== undefined ? { spendCapUsd } : {}),
    ...(stringArg(args, "--accept-estimate") ? { acceptEstimateHash: stringArg(args, "--accept-estimate") } : {}),
    json: booleanArg(args, "--json"),
    allowPricingUnknownForValidation: booleanArg(args, "--allow-pricing-unknown-for-validation"),
  };
}

function parseConformanceModules(args: readonly string[]): readonly ConformanceModule[] {
  const rawModules = stringArgs(args, "--module");
  const values = rawModules.length === 0 ? ["stream-sse", "hidden-token"] : rawModules;
  const modules: ConformanceModule[] = [];
  for (const raw of values) {
    if (!isConformanceCliModule(raw)) {
      throw new Error("--module must be stream-sse or hidden-token.");
    }
    modules.push(cliModuleToConformanceModule(raw));
  }
  return [...new Set(modules)];
}

function parseConformanceProviders(args: readonly string[]): readonly ConformanceProvider[] {
  const repeated = stringArgs(args, "--provider");
  const combined = stringArg(args, "--providers");
  if (repeated.length > 0 && combined) {
    throw new Error("Use --provider repeatedly or --providers, not both.");
  }
  const raw = repeated.length > 0
    ? repeated
    : combined
      ? combined.split(",").map((value) => value.trim()).filter(Boolean)
      : ["openai", "anthropic"];
  const providers: ConformanceProvider[] = [];
  for (const entry of raw) {
    if (entry === "both" || entry === "all") {
      providers.push("openai", "anthropic");
      continue;
    }
    if (!isConformanceProvider(entry)) {
      throw new Error("Conformance --provider must be openai or anthropic.");
    }
    providers.push(entry);
  }
  return [...new Set(providers)];
}

async function confirmConformanceRun(input: {
  readonly estimateHash: string;
  readonly acceptEstimateHash?: string;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly json: boolean;
}): Promise<boolean> {
  if (input.acceptEstimateHash) {
    if (input.acceptEstimateHash !== input.estimateHash) {
      const message = `Accepted conformance estimate hash does not match the current estimate. Expected ${input.estimateHash}.`;
      input.error(message);
      throw new Error(message);
    }
    return true;
  }
  if (!isInteractive(input.runtime)) {
    const message = "Non-interactive inferock-bench conformance requires --accept-estimate <hash>.";
    input.error(message);
    throw new Error(message);
  }
  if (!input.json) input.log("Type RUN to start real provider conformance calls.");
  const answer = await promptLine(input.runtime, "RUN> ");
  return answer.trim() === "RUN";
}

async function runFixtureOnlyConformance(input: {
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly options: ConformanceCommandOptions;
  readonly estimate: ReturnType<typeof buildConformanceEstimate>;
  readonly eventTime: string;
}): Promise<{
  readonly runId: string;
  readonly artifactDir: string;
  readonly estimateHash: string;
  readonly summary: ReturnType<typeof emptyConformanceSummary>;
}> {
  const writer = createConformanceArtifactWriter({
    paths: input.paths,
    createdAt: input.eventTime,
    mode: "fixture_control",
    modules: input.options.modules,
    providers: input.options.providers,
  });
  await writer.writeManifest();
  const entries = input.options.modules.includes("stream_sse")
    ? (await runStreamFixtureControls({ runId: writer.runId, writer })).entries
    : [];
  const hiddenEntries = input.options.modules.includes("hidden_token")
    ? (await runHiddenTokenFixtureControls({
        runId: writer.runId,
        writer,
        providers: input.options.providers,
      })).entries
    : [];
  const allEntries = [...entries, ...hiddenEntries];
  const summary = allEntries.length > 0
    ? summarizeConformanceLedger({
        runId: writer.runId,
        entries: allEntries,
        generatedAt: input.eventTime,
      })
    : emptyConformanceSummary({
        runId: writer.runId,
        generatedAt: input.eventTime,
      });
  await writer.writeSummary(summary);
  return {
    runId: writer.runId,
    artifactDir: writer.runDir,
    estimateHash: input.estimate.estimateHash,
    summary,
  };
}

function isConformanceCliModule(value: string): value is ConformanceCliModule {
  return value === "stream-sse" || value === "hidden-token";
}

function isConformanceProvider(value: string): value is ConformanceProvider {
  return value === "openai" || value === "anthropic";
}

async function runTestCommand(input: {
  readonly args: readonly string[];
  readonly paths: ReturnType<typeof resolveBenchPaths>;
  readonly config: BenchConfig;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly runtime: CliRuntime;
}): Promise<void> {
  const options = parseTestOptions(input.args);
  if (options.agentCmd && options.generator !== "agent") {
    const message = "--agent-cmd is valid only with --generator agent.";
    input.error(message);
    throw new Error(message);
  }
  if (options.yes && !options.acceptEstimateHash && !isInteractive(input.runtime)) {
    const message = "Non-interactive inferock-bench test requires --accept-estimate <hash>; bare --yes is insufficient.";
    input.error(message);
    throw new Error(message);
  }

  const suite = await loadCoverageSuiteManifest();
  const requestedProviders = requestedCoverageProviders(options.providers, input.config, input.env);
  if (requestedProviders.kind === "offline") {
    input.log([
      "No provider key configured for inferock-bench test.",
      "Offline explanation only: configure OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY, an INFEROCK_BENCH_* provider key, or local bench config.",
      "Made zero provider calls.",
    ].join("\n"));
    return;
  }
  if (requestedProviders.kind === "error") {
    input.error(requestedProviders.message);
    throw new Error(requestedProviders.message);
  }
  const recordBaselineSourceCommit = options.recordBaseline
    ? await recordBaselineCommitOrThrow(input.cwd, input.error)
    : undefined;

  const eventTime = input.runtime.eventTime ?? new Date().toISOString();
  const baseline = options.recordBaseline
    ? conservativeRecordBaselineForEstimate(suite)
    : await loadNormalCoverageBaseline(input.runtime.coverageBaseline, suite, input.error, input.runtime.coverageBaselineUrl);
  const selectedModels = selectedCoverageModels({
    modelArgs: options.models,
    providers: requestedProviders.providers,
    suite,
    baseline,
    eventTime,
  });
  const firstEstimate = estimateCoverageSuite({
    selectedModels,
    suite,
    baseline,
    generator: options.generator,
    spendCapUsd: options.spendCapUsd ?? 1,
    eventTime,
  });
  const spendCapUsd = options.spendCapUsd ??
    defaultSpendCapUsd(firstEstimate, suite);
  const estimate = estimateCoverageSuite({
    selectedModels,
    suite,
    baseline,
    generator: options.generator,
    spendCapUsd,
    eventTime,
  });

  if (!options.json) {
    input.log(renderCoverageEstimate(estimate, suite, {
      recordBaseline: options.recordBaseline,
      spendCapMultiplier: suite.estimateDefaults.defaultSpendCapMultiplier,
    }));
  }

  const agentInstallPlan = options.generator === "agent" && !options.agentCmd
    ? planAgentProvisioning({ benchHome: input.paths.homeDir })
    : undefined;
  if (agentInstallPlan && !options.json) {
    input.log(agentInstallConsentText(agentInstallPlan));
  }
  if (agentInstallPlan) {
    if (!await confirmAgentInstall({
      planHash: agentInstallPlan.consentHash,
      acceptAgentInstallHash: options.acceptAgentInstallHash,
      runtime: input.runtime,
      log: input.log,
      error: input.error,
      json: options.json,
    })) {
      return;
    }
  }

  if (!await confirmCoverageRun({
    estimateHash: estimate.estimateHash,
    acceptEstimateHash: options.acceptEstimateHash,
    runtime: input.runtime,
    log: input.log,
    error: input.error,
    json: options.json,
  })) {
    input.log("aborted before provider calls");
    return;
  }

  const store = new JsonlEventStore(input.paths.eventsFile);
  const now = new Date().toISOString();
  const run = await runCoverageOrReportProvisioningFailure({
    suite,
    baseline,
    estimate,
    config: input.config,
    env: input.env,
    store,
    providerFetch: input.runtime.providerFetch,
    benchHome: input.paths.homeDir,
    agentCommand: options.agentCmd,
    agentInstallConsentHash: options.acceptAgentInstallHash,
    agentProcessRunner: input.runtime.agentProcessRunner,
    log: options.json ? () => undefined : input.log,
    startedAt: now,
    consentedAt: now,
  }, input.error);

  if (options.recordBaseline) {
    const records = await store.readAll();
    const outputPath = options.baselineOutputPath ?? fileURLToPath(coverageTokenBaselineUrl);
    const measuredBaseline = await createMeasuredCoverageTokenBaseline({
      suite,
      records: records.filter((record) =>
        record.runId === run.runId || record.runId?.startsWith(`${run.runId}/`)
      ),
      outputPath,
      generatedAt: new Date().toISOString(),
      sourcePath: "inferock-bench test --record-baseline",
      sourceCommit: recordBaselineSourceCommit,
      benchPackageVersion: BENCH_PACKAGE_VERSION,
      providerModelsMeasured: estimate.selectedModels.map((model) => `${model.provider}:${model.model}`),
    });
    if (!options.json) {
      input.log(`Measured token baseline written: ${outputPath}`);
      input.log(`Measured baseline version: ${coverageBaselineVersion(measuredBaseline)}`);
    }
  }

  if (options.json) {
    input.log(JSON.stringify(run.receipt, null, 2));
    failIfRunIncomplete(run.receipt.run.status, input.error);
    return;
  }

  input.log(renderSpeedTestReceipt(run.receipt));
  const receiptPath = await writeSpeedTestReceiptBundle(input.paths.receiptsDir, run.receipt);
  input.log(`JSON bundle: ${receiptPath}`);
  failIfRunIncomplete(run.receipt.run.status, input.error);
}

async function runCoverageOrReportProvisioningFailure(
  input: Parameters<typeof runProviderParallelCoverageSuite>[0],
  error: (line: string) => void,
) {
  try {
    return await runProviderParallelCoverageSuite(input);
  } catch (caught) {
    if (caught instanceof AgentProvisioningFailureError) {
      error(agentProvisioningFailureOffer(caught));
    }
    throw caught;
  }
}

function agentProvisioningFailureOffer(error: AgentProvisioningFailureError): string {
  const detail = error.detail;
  return [
    "Agent provisioning failed before provider calls.",
    `package: ${detail.packageName}@${detail.packageVersion}`,
    `url: ${detail.tarballUrl}`,
    `platform: ${detail.platform}`,
    `reason: ${detail.reason}`,
    "Offer: run the built-in driver instead as a separate action with `inferock-bench test --generator built-in`.",
    "The generator was not changed automatically.",
  ].join("\n");
}

interface TestCommandOptions {
  readonly providers?: readonly ProviderName[];
  readonly models: readonly string[];
  readonly preset: "cheap" | "standard";
  readonly generator: CoverageGenerator;
  readonly agentCmd?: string;
  readonly spendCapUsd?: number;
  readonly json: boolean;
  readonly yes: boolean;
  readonly acceptEstimateHash?: string;
  readonly acceptAgentInstallHash?: string;
  readonly recordBaseline: boolean;
  readonly baselineOutputPath?: string;
}

function parseTestOptions(args: readonly string[]): TestCommandOptions {
  const providers = parseProviders(args);
  const preset = stringArg(args, "--preset") ?? "cheap";
  if (preset !== "cheap" && preset !== "standard") {
    throw new Error("--preset must be cheap or standard.");
  }
  const generator = stringArg(args, "--generator") ?? "built-in";
  if (generator !== "built-in" && generator !== "agent") {
    throw new Error("--generator must be built-in or agent.");
  }
  const spendCapUsd = decimalArg(args, "--spend-cap-usd");
  return {
    ...(providers ? { providers } : {}),
    models: stringArgs(args, "--model"),
    preset,
    generator,
    ...(stringArg(args, "--agent-cmd") ? { agentCmd: stringArg(args, "--agent-cmd") } : {}),
    ...(spendCapUsd !== undefined ? { spendCapUsd } : {}),
    json: booleanArg(args, "--json"),
    yes: booleanArg(args, "--yes"),
    ...(stringArg(args, "--accept-estimate") ? { acceptEstimateHash: stringArg(args, "--accept-estimate") } : {}),
    ...(stringArg(args, "--accept-agent-install")
      ? { acceptAgentInstallHash: stringArg(args, "--accept-agent-install") }
      : {}),
    recordBaseline: booleanArg(args, "--record-baseline"),
    ...(stringArg(args, "--baseline-output") ? { baselineOutputPath: stringArg(args, "--baseline-output") } : {}),
  };
}

function requestedCoverageProviders(
  requested: TestCommandOptions["providers"],
  config: BenchConfig,
  env: NodeJS.ProcessEnv,
):
  | { readonly kind: "providers"; readonly providers: readonly ProviderName[] }
  | { readonly kind: "offline" }
  | { readonly kind: "error"; readonly message: string } {
  const configured = PROVIDER_NAMES.filter((provider) =>
    Boolean(providerApiKey(provider, config, env))
  );
  if (!requested) {
    return configured.length === 0 ? { kind: "offline" } : { kind: "providers", providers: configured };
  }
  const selected = requested;
  const missing = selected.filter((provider) => !providerApiKey(provider, config, env));
  if (missing.length > 0) {
    if (configured.length === 0) return { kind: "offline" };
    return {
      kind: "error",
      message: `Provider key not configured for requested provider(s): ${missing.join(", ")}.`,
    };
  }
  return { kind: "providers", providers: selected };
}

function parseProviders(args: readonly string[]): readonly ProviderName[] | undefined {
  const providers = stringArg(args, "--providers");
  const provider = stringArg(args, "--provider");
  if (providers && provider) throw new Error("Use --providers or --provider, not both.");
  const raw = providers ?? provider;
  if (!raw || raw === "all") return undefined;
  if (raw === "both") return ["openai", "anthropic"];
  const selected = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (selected.length === 0) throw new Error(`--providers must be all or a comma-separated subset of ${PROVIDER_NAMES.join(", ")}.`);
  for (const entry of selected) {
    if (!isProviderName(entry)) {
      throw new Error(`--providers must be all or a comma-separated subset of ${PROVIDER_NAMES.join(", ")}.`);
    }
  }
  return [...new Set(selected)] as ProviderName[];
}

async function loadNormalCoverageBaseline(
  injected: LoadedCoverageTokenBaseline | undefined,
  suite: LoadedCoverageSuiteManifest,
  error: (line: string) => void,
  baselineUrl?: string | URL,
): Promise<LoadedCoverageTokenBaseline> {
  if (injected) return injected;
  try {
    return await loadCoverageTokenBaseline(baselineUrl, suite);
  } catch (caught) {
    const message = caught instanceof Error && /bootstrap_required/i.test(caught.message)
      ? "baseline not measured yet: run `inferock-bench test --record-baseline` with explicit consent to produce a real per-task token baseline."
      : caught instanceof Error
        ? caught.message
        : "failed to load coverage token baseline.";
    error(message);
    throw new Error(message, { cause: caught });
  }
}

function selectedCoverageModels(input: {
  readonly modelArgs: readonly string[];
  readonly providers: readonly ProviderName[];
  readonly suite: LoadedCoverageSuiteManifest;
  readonly baseline: LoadedCoverageTokenBaseline;
  readonly eventTime: string;
}): readonly CoverageSelectedModel[] {
  if (input.modelArgs.length === 0) {
    return resolveCoverageModelPreset({
      configuredProviders: input.providers,
      suite: input.suite,
      baseline: input.baseline,
      eventTime: input.eventTime,
    });
  }
  const allowed = new Set(input.providers);
  return input.modelArgs.map((value) => {
    const parsed = parseProviderModel(value);
    if (!allowed.has(parsed.provider)) {
      throw new Error(`Selected model ${value} does not match configured/requested provider selection.`);
    }
    return parsed;
  });
}

type BenchCoverageSelectedModel = CoverageSelectedModel & {
  readonly provider: ProviderName;
};

function parseProviderModel(value: string): BenchCoverageSelectedModel {
  const separator = value.indexOf(":");
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (separator <= 0 || !model || !isProviderName(provider)) {
    throw new Error("--model must use provider:model, for example gemini:gemini-2.5-flash.");
  }
  return { provider, model };
}

function conservativeRecordBaselineForEstimate(
  suite: LoadedCoverageSuiteManifest,
): LoadedCoverageTokenBaseline {
  const baseline = {
    schemaVersion: "inferock-coverage-token-baseline-v1" as const,
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: "2026-07-04T00:00:00.000Z",
    generatedBy: "covrun" as const,
    provenance: {
      sourcePath: "inferock-bench test --record-baseline conservative consent estimate",
      sourceCommit: "not-stored",
      benchPackageVersion: BENCH_PACKAGE_VERSION,
      providerModelsMeasured: [],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [
        task.taskId,
        plannedCallsForCoverageSuiteTask(task),
      ])),
      notes: "Temporary conservative per-call token bound for record-baseline consent only; never store this as the measured baseline.",
    },
    quantile: "reviewed" as const,
    tasks: suite.tasks.map((task) => ({
      taskId: task.taskId,
      plannedCalls: plannedCallsForCoverageSuiteTask(task),
      usage: {
        input: 16_000,
        output: 2_048,
        cacheRead: 0,
        cacheCreation: 0,
      },
    })),
  };
  return {
    ...baseline,
    baselineVersion: coverageBaselineVersion(baseline),
    baselineContentDigest: coverageBaselineContentDigest(baseline),
  };
}

async function recordBaselineCommitOrThrow(
  cwd: string,
  error: (line: string) => void,
): Promise<string> {
  try {
    return await resolveCoverageBaselineSourceCommit(cwd);
  } catch (caught) {
    const message = caught instanceof Error
      ? caught.message
      : "Cannot record coverage token baseline without git source commit.";
    error(message);
    throw new Error(message, { cause: caught });
  }
}

function renderCoverageEstimate(
  estimate: ReturnType<typeof estimateCoverageSuite>,
  suite: LoadedCoverageSuiteManifest,
  input: {
    readonly recordBaseline: boolean;
    readonly spendCapMultiplier: number;
  },
): string {
  const lines = [
    "inferock-bench coverage speed test estimate",
    `Running the complete test set on ${estimate.selectedModels.map((model) => model.provider).join(", ")} will cost approximately ${formatEstimateUsd(estimate.estimatedUsd)}.`,
    `selected model(s): ${estimate.selectedModels.map((model) => `${model.provider}:${model.model}`).join(", ")}`,
    `suite: ${estimate.suiteVersion}`,
    `baseline: ${estimate.baselineVersion}`,
    `generator: ${estimate.generator}`,
    `planned tasks: ${suite.tasks.length}`,
    `estimated tokens: ${Object.entries(estimate.estimatedTokensByCategory).map(([category, tokens]) => `${category}=${tokens}`).join(", ")}`,
    `estimated USD total: ${formatEstimateUsd(estimate.estimatedUsd)}`,
    ...(estimate.generator === "agent" ? [
      `agent estimate bands: low ${formatEstimateUsd(estimate.estimatedUsdBand.low)} | expected ${formatEstimateUsd(estimate.estimatedUsdBand.expected)} | high ${formatEstimateUsd(estimate.estimatedUsdBand.high)}`,
    ] : []),
    ...estimate.estimatedUsdByModel.map((model) =>
      estimate.generator === "agent"
        ? `estimated USD ${model.provider}:${model.model}: low ${formatEstimateUsd(model.estimatedUsdBand.low)} | expected ${formatEstimateUsd(model.estimatedUsdBand.expected)} | high ${formatEstimateUsd(model.estimatedUsdBand.high)} (${model.plannedCallsBand.high} high-band planned calls)`
        : `estimated USD ${model.provider}:${model.model}: ${formatEstimateUsd(model.estimatedUsd)} (${model.plannedCalls} planned calls)`
    ),
    `pricing sources: ${estimate.pricing.map((pricing) => `${pricing.provider}:${pricing.model} ${pricing.pricingVersion} ${pricing.source}`).join("; ")}`,
    `spend cap: ${formatEstimateUsd(estimate.spendCapUsd)}${input.recordBaseline ? "" : estimate.generator === "agent" ? " (agent high-band default unless overridden)" : ` (default multiplier ${input.spendCapMultiplier}x unless overridden)`}`,
    "BYOK: provider charges, if any, are on your provider account. Abort before starting makes zero provider calls. If the cap is hit, already-started provider calls may still be billed.",
    `ready to spend ~${formatEstimateUsd(estimate.estimatedUsd)} to measure everything`,
    `estimate hash: ${estimate.estimateHash}`,
  ];
  if (input.recordBaseline) {
    lines.splice(6, 0, "record-baseline estimate uses a temporary conservative per-call bound: input=16000 tokens, output=2048 tokens; this bound is never stored as the measured baseline.");
  }
  return lines.join("\n");
}

function defaultSpendCapUsd(
  estimate: ReturnType<typeof estimateCoverageSuite>,
  suite: LoadedCoverageSuiteManifest,
): number {
  return estimate.generator === "agent"
    ? estimate.estimatedUsdBand.high
    : estimate.estimatedUsd * suite.estimateDefaults.defaultSpendCapMultiplier;
}

function failIfRunIncomplete(
  status: string,
  error: (line: string) => void,
): void {
  if (status !== "killed") return;
  error(SPEND_CAP_REACHED_MESSAGE);
  throw new Error(SPEND_CAP_REACHED_MESSAGE);
}

async function confirmAgentInstall(input: {
  readonly planHash: string;
  readonly acceptAgentInstallHash?: string;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly json: boolean;
}): Promise<boolean> {
  if (input.acceptAgentInstallHash) {
    if (input.acceptAgentInstallHash !== input.planHash) {
      const message = `Accepted agent install hash does not match the current install plan. Expected ${input.planHash}.`;
      input.error(message);
      throw new Error(message);
    }
    return true;
  }
  if (!isInteractive(input.runtime)) {
    const message = "Non-interactive inferock-bench test --generator agent requires --accept-agent-install <hash>.";
    input.error(message);
    throw new Error(message);
  }
  if (!input.json) input.log("Type INSTALL to download and verify the local coding agent.");
  const answer = await promptLine(input.runtime, "INSTALL> ");
  if (answer.trim() !== "INSTALL") {
    input.log("aborted before agent install or provider calls");
    return false;
  }
  return true;
}

async function confirmCoverageRun(input: {
  readonly estimateHash: string;
  readonly acceptEstimateHash?: string;
  readonly runtime: CliRuntime;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly json: boolean;
}): Promise<boolean> {
  if (input.acceptEstimateHash) {
    if (input.acceptEstimateHash !== input.estimateHash) {
      const message = `Accepted estimate hash does not match the current estimate. Expected ${input.estimateHash}.`;
      input.error(message);
      throw new Error(message);
    }
    return true;
  }
  if (!isInteractive(input.runtime)) {
    const message = "Non-interactive inferock-bench test requires --accept-estimate <hash>.";
    input.error(message);
    throw new Error(message);
  }
  if (!input.json) input.log("Type RUN to start provider calls.");
  const answer = await promptLine(input.runtime, "RUN> ");
  return answer.trim() === "RUN";
}

async function promptLine(runtime: CliRuntime, question: string): Promise<string> {
  if (runtime.prompt) return runtime.prompt(question);
  const readline = createInterface({ input: processStdin, output: processStdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

function isInteractive(runtime: CliRuntime): boolean {
  return Boolean(runtime.stdinIsTty ?? processStdin.isTTY) &&
    Boolean(runtime.stdoutIsTty ?? processStdout.isTTY);
}

function formatEstimateUsd(value: number): string {
  return formatUsdForEstimate(roundUsd(value));
}

function formatUsdForEstimate(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function currentSummary(
  eventsFile: string,
  window: TimeWindow,
  config: Awaited<ReturnType<typeof readBenchConfig>>,
) {
  const store = new JsonlEventStore(eventsFile);
  return summarizeBenchEvents(await store.readAll(), window, { config });
}

function parseWindow(args: readonly string[]): TimeWindow {
  const sinceText = stringArg(args, "--since");
  const untilText = stringArg(args, "--until");
  const lastText = stringArg(args, "--last");
  const until = untilText ? parseDateOrThrow(untilText, "--until") : undefined;
  const since = sinceText
    ? parseDateOrThrow(sinceText, "--since")
    : lastText
      ? new Date((until ?? new Date()).getTime() - parseDurationMs(lastText))
      : undefined;
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}

function parseDateOrThrow(value: string, flag: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} must be an ISO date/time.`);
  }
  return date;
}

function parseDurationMs(value: string): number {
  const match = value.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error("--last must use m, h, or d, for example --last 24h.");
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}

function stringArg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function numberArg(args: readonly string[], flag: string): number | undefined {
  const value = stringArg(args, flag);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function decimalArg(args: readonly string[], flag: string): number | undefined {
  const value = stringArg(args, flag);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

function booleanArg(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function outputArg(args: readonly string[]): string | undefined {
  if (!args.includes("--output")) return undefined;
  const output = stringArg(args, "--output");
  if (!output) throw new Error("--output requires a path.");
  return output;
}

function displayShareCardPath(path: string): string {
  return `receipts/${basename(path)}`;
}

function stringArgs(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(String(args[index + 1]));
  }
  return values;
}

function helpText(): string {
  return [
    "inferock-bench",
    "",
    "Commands:",
    "  start [--host 127.0.0.1] [--port 4318]",
    "  init [--patch path/to/client.ts --yes]",
    "  setup <openai|anthropic|gemini|openrouter>",
    "  status",
    "  key reveal",
    "  key copy",
    "  test [--providers all|openai|anthropic|gemini|openrouter|openai,anthropic,gemini,openrouter] [--model provider:model] [--preset cheap|standard] [--generator built-in|agent] [--agent-cmd path] [--spend-cap-usd N] [--accept-estimate hash] [--accept-agent-install hash] [--json]",
    "  test --record-baseline [--baseline-output path] [--accept-estimate hash]",
    "  conformance --module stream-sse|hidden-token --provider openai|anthropic --fixture-only --spend-cap-usd N --accept-estimate hash --json (experimental)",
    "  report [--last 24h] [--since ISO] [--until ISO]",
    "  receipt --compact [--last 30d]",
    "  receipt --share-card [--last 30d] [--since ISO] [--until ISO] [--output path] [--no-color]",
    "  telemetry enable --reliability-index",
    "  telemetry disable --reliability-index",
    "  index on|off|status",
  ].join("\n");
}

class CliUsageError extends Error {}
