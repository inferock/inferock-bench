import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import playwright, { type Browser, type Page } from "@playwright/test";
import {
  clearOutputSchemas,
  registerOutputSchema,
} from "@inferock/measure/output-schemas";
import {
  ensureGeneratedBenchKey,
  resolveBenchPaths,
} from "../src/config.js";
import { loadCoverageTokenBaselineFromValue } from "../src/coverage-suite/baseline.js";
import {
  loadCoverageSuiteManifest,
  type LoadedCoverageSuiteManifest,
} from "../src/coverage-suite/manifest.js";
import { createBenchApp, type ProviderFetch } from "../src/proxy.js";
import type { EventStore, StoredBenchEvent } from "../src/storage.js";
import {
  DASHBOARD_CAPTURE_CLIP_PADDING,
  DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR,
  DASHBOARD_CAPTURE_VIEWPORT_HEIGHT,
  DASHBOARD_CAPTURE_VIEWPORT_WIDTH,
} from "../src/dashboard-capture-spec.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const benchKey = "ibl_fresh_display_capture_local_key";
const openAiKey = "capture-local-placeholder-fresh-display";
const captureManagementAccessToken = "capture-display-fresh-run-management-token";
const outputSchemaVersion = "bench-display-fresh-output-v1";
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string", minLength: 1 },
  },
} as const;

type Side = "before" | "after";
type JsonRecord = Record<string, unknown>;

interface CaptureOptions {
  readonly outputDir: string;
  readonly dataPath: string;
  readonly sourceRoot: string;
  readonly side: Side;
  readonly generateData: boolean;
}

interface FreshRunData {
  readonly schemaVersion: "inferock-display-fresh-run-data-v1";
  readonly producedAt: string;
  readonly generatedWithSourceRoot: string;
  readonly runId: string;
  readonly run: JsonRecord;
  readonly optionsPayload: JsonRecord;
  readonly runsPayload: JsonRecord;
  readonly summaryPayload: JsonRecord;
  readonly rowsPayload: JsonRecord;
  readonly callsPayload: JsonRecord;
  readonly receiptPayload: JsonRecord;
  readonly shareCardReceiptPayload: JsonRecord;
}

interface RenderDashboardModule {
  renderDashboardHtml(input: { readonly managementAccessToken: string }): string;
}

interface ShareCardModule {
  createShareCardModel(receipt: unknown): unknown;
  renderShareCard(model: unknown, options: { readonly width: number }): string;
}

class MemoryStore implements EventStore {
  readonly records: StoredBenchEvent[] = [];

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

function usage(): string {
  return [
    "Usage: pnpm --filter inferock-bench capture:display-fresh-run --side <before|after> [options]",
    "",
    "Options:",
    "  --output-dir <path>   Directory for receipt/dashboard/share-card PNGs.",
    "  --data <path>         Fresh run payload JSON. Default: <output-dir>/fresh-run-data.json.",
    "  --source-root <path>  Repo/worktree root whose dashboard/share-card source should render the data.",
    "  --side <before|after> Filename suffix for rendered assets.",
    "  --generate-data       Run the mocked bench pipeline once before rendering.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CaptureOptions {
  let outputDir = resolve(repoRoot, "scratchpad/fresh-display-renders");
  let dataPath: string | undefined;
  let sourceRoot = repoRoot;
  let side: Side = "after";
  let generateData = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--generate-data") {
      generateData = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    if (arg === "--output-dir") outputDir = resolve(value);
    else if (arg === "--data") dataPath = resolve(value);
    else if (arg === "--source-root") sourceRoot = resolve(value);
    else if (arg === "--side") side = parseSide(value);
    else throw new Error(`unknown option ${arg}`);
    index += 1;
  }

  return {
    outputDir,
    dataPath: dataPath ?? resolve(outputDir, "fresh-run-data.json"),
    sourceRoot,
    side,
    generateData,
  };
}

function parseSide(value: string): Side {
  if (value === "before" || value === "after") return value;
  throw new Error(`--side must be before or after, got ${value}`);
}

async function generateFreshRunData(sourceRoot: string): Promise<FreshRunData> {
  clearOutputSchemas();
  registerOutputSchema({
    tenantId: "local",
    schemaVersion: outputSchemaVersion,
    schema: outputSchema,
  });

  const paths = resolveBenchPaths({
    INFEROCK_BENCH_HOME: await mkdtemp(join(tmpdir(), "inferock-fresh-display-")),
  });
  const config = await ensureGeneratedBenchKey({
    paths,
    config: {
      benchKey,
      openaiApiKey: openAiKey,
    },
  });
  const suite = await loadCoverageSuiteManifest();
  const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
  const store = new MemoryStore();
  const app = createBenchApp({
    config,
    paths,
    store,
    env: {},
    coverageTest: { suite, baseline },
    providerFetch: mockProviderFetch(),
    log: () => undefined,
    managementAccessToken: captureManagementAccessToken,
  });

  // The 0.2.2 auth gate serves the token-embedding dashboard only to a
  // tokened request; a bare root request gets the 401 locked shell.
  const root = await textResponse(await app.fetch(new Request(`http://127.0.0.1/?token=${captureManagementAccessToken}`)));
  const managementToken = root.match(/const MANAGEMENT_ACCESS_TOKEN = "([^"]+)";/)?.[1];
  if (managementToken !== captureManagementAccessToken) throw new Error("dashboard management token missing from generated page");
  const managementHeaders = {
    "content-type": "application/json",
    "x-inferock-bench-management": managementToken,
  };

  const optionsBefore = await jsonResponse(await app.fetch(new Request("http://127.0.0.1/api/coverage-test/options")));
  const defaults = recordValue(optionsBefore.defaults);
  if (!defaults) throw new Error("coverage options missing defaults");
  const estimateRequest = {
    generator: stringValue(defaults.generator) ?? "built-in",
    selectedModels: arrayValue(defaults.selectedModels),
    spendCapUsd: numberValue(defaults.spendCapUsd),
  };
  const estimatePayload = await jsonResponse(await app.fetch(new Request("http://127.0.0.1/api/coverage-test/estimate", {
    method: "POST",
    headers: managementHeaders,
    body: JSON.stringify(estimateRequest),
  })));
  const estimate = recordValue(estimatePayload.estimate);
  const consentHash = stringValue(estimatePayload.consentHash) ?? stringValue(estimate?.estimateHash);
  if (!consentHash) throw new Error("coverage estimate missing consent hash");
  const startPayload = await jsonResponse(await app.fetch(new Request("http://127.0.0.1/api/coverage-test/start", {
    method: "POST",
    headers: managementHeaders,
    body: JSON.stringify({
      ...estimateRequest,
      consentHash,
      displayedConsentHash: consentHash,
      displayedEstimateUsd: numberValue(estimate?.estimatedUsd) ?? 0,
    }),
  })));
  const startedRun = recordValue(startPayload.run);
  const runId = stringValue(startedRun?.runId);
  if (!runId) throw new Error("fresh coverage run did not return a run id");

  const run = await waitForReceiptReady(app.fetch.bind(app), runId);
  const [optionsPayload, runsPayload, summaryPayload, rowsPayload, callsPayload, receiptPayload, shareCardReceiptPayload] = await Promise.all([
    jsonResponse(await app.fetch(new Request("http://127.0.0.1/api/coverage-test/options"))),
    jsonResponse(await app.fetch(new Request("http://127.0.0.1/api/coverage-test/runs"))),
    jsonResponse(await app.fetch(new Request(`http://127.0.0.1/api/summary?runId=${encodeURIComponent(runId)}`))),
    jsonResponse(await app.fetch(new Request(`http://127.0.0.1/api/rows?runId=${encodeURIComponent(runId)}`))),
    jsonResponse(await app.fetch(new Request(`http://127.0.0.1/api/calls?runId=${encodeURIComponent(runId)}&limit=8`))),
    jsonResponse(await app.fetch(new Request(`http://127.0.0.1/api/coverage-test/runs/${encodeURIComponent(runId)}/receipt`))),
    jsonResponse(await app.fetch(new Request(`http://127.0.0.1/api/receipt?runId=${encodeURIComponent(runId)}`))),
  ]);

  return {
    schemaVersion: "inferock-display-fresh-run-data-v1",
    producedAt: new Date().toISOString(),
    generatedWithSourceRoot: sourceRoot,
    runId,
    run,
    optionsPayload,
    runsPayload,
    summaryPayload,
    rowsPayload,
    callsPayload,
    receiptPayload,
    shareCardReceiptPayload,
  };
}

async function waitForReceiptReady(
  fetcher: (request: Request) => Promise<Response>,
  runId: string,
): Promise<JsonRecord> {
  const deadline = Date.now() + 30_000;
  let latest: JsonRecord | undefined;
  while (Date.now() < deadline) {
    latest = await jsonResponse(await fetcher(new Request(`http://127.0.0.1/api/coverage-test/runs/${encodeURIComponent(runId)}`)));
    if (latest.receiptReady === true) return latest;
    await delay(100);
  }
  throw new Error(`fresh coverage run did not produce a receipt: ${JSON.stringify(latest)}`);
}

function completeBaselineForSuite(suite: LoadedCoverageSuiteManifest) {
  return {
    schemaVersion: "inferock-coverage-token-baseline-v1",
    suiteVersion: suite.suiteVersion,
    suiteManifestHash: suite.manifestHash,
    generatedAt: new Date().toISOString(),
    generatedBy: "covrun",
    provenance: {
      sourcePath: "apps/inferock-bench/scripts/capture-display-fresh-run.ts",
      sourceCommit: "workspace",
      benchPackageVersion: "0.2.1",
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 1])),
      notes: "Mocked local display capture baseline; provider responses pass through the real bench summary and receipt pipeline.",
    },
    quantile: "reviewed",
    tasks: suite.tasks.map((task, index) => ({
      taskId: task.taskId,
      plannedCalls: task.taskId === "concurrency_wave"
        ? 4
        : task.taskId === "identical_rerun_drift"
          ? 5
          : 1,
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

function mockProviderFetch(): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as JsonRecord;
    return providerResponse(url, body);
  };
}

function providerResponse(url: string, body: JsonRecord): Response {
  if (url.endsWith("/responses")) return openAiResponsesResponse(body);
  if (String(body.stream) === "true") return openAiStreamResponse(body);
  return openAiChatResponse(body);
}

function openAiChatResponse(body: JsonRecord): Response {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const message = hasTools
    ? {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_record_plan",
          type: "function",
          function: {
            name: "record_plan",
            arguments: JSON.stringify({
              component: "billing worker",
              riskLevel: "medium",
              checks: ["verify retries", "review metrics"],
            }),
          },
        }],
      }
    : { role: "assistant", content: responseContentForBody(body) };
  return jsonProviderResponse({
    id: "chatcmpl-display-fresh",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    choices: [{ finish_reason: hasTools ? "tool_calls" : "stop", message }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      prompt_tokens_details: body.metadata ? { cached_tokens: 15 } : undefined,
    },
  }, "provider-chat-display-fresh");
}

function openAiResponsesResponse(body: JsonRecord): Response {
  return jsonProviderResponse({
    id: "resp-display-fresh",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    output_text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
    output: [{
      id: "msg-display-fresh",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
        annotations: [],
      }],
    }],
    usage: {
      input_tokens: 90,
      output_tokens: 35,
      total_tokens: 125,
    },
  }, "provider-responses-display-fresh");
}

function openAiStreamResponse(body: JsonRecord): Response {
  const model = String(body.model ?? "gpt-4o-mini-2024-07-18");
  const text = [
    `data: ${JSON.stringify({
      id: "chatcmpl-stream-display-fresh",
      model,
      choices: [{ delta: { content: "review " }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream-display-fresh",
      model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 140, completion_tokens: 45, total_tokens: 185 },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "provider-stream-display-fresh" },
  });
}

function responseContentForBody(body: JsonRecord): string {
  const serialized = JSON.stringify(body);
  if (serialized.includes("invoice reconciliation")) return "Billing Reliability";
  if (serialized.includes("json_schema")) {
    return "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}";
  }
  return "The maintenance note is ready for review.";
}

function jsonProviderResponse(body: JsonRecord, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": requestId },
  });
}

async function renderSide(options: CaptureOptions, data: FreshRunData): Promise<JsonRecord> {
  const dashboardModule = await importDashboardModule(options.sourceRoot);
  const shareCardModule = await importShareCardModule(options.sourceRoot);
  const server = await startRenderServer(dashboardModule, data);
  const browser = await playwright.chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    await mkdir(options.outputDir, { recursive: true });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const receiptDesktop = resolve(options.outputDir, `receipt-desktop-${options.side}.png`);
    const receiptNarrow = resolve(options.outputDir, `receipt-narrow-${options.side}.png`);
    const dashboard = resolve(options.outputDir, `dashboard-${options.side}.png`);
    const shareCard = resolve(options.outputDir, `share-card-${options.side}.png`);
    const shareCardTextPath = resolve(options.outputDir, `share-card-${options.side}.txt`);

    await captureReceipt(browser, baseUrl, receiptDesktop, { width: 1280, height: 900, deviceScaleFactor: 1 });
    await captureReceipt(browser, baseUrl, receiptNarrow, {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await captureDashboard(browser, baseUrl, dashboard);
    const shareCardText = renderShareCardText(shareCardModule, data);
    await writeFile(shareCardTextPath, `${shareCardText}\n`);
    await captureShareCard(browser, shareCardText, shareCard);

    const assets = [receiptDesktop, receiptNarrow, dashboard, shareCard];
    const hashes = await Promise.all(assets.map((asset) => imageMetadata(asset)));
    const output = {
      side: options.side,
      sourceRoot: options.sourceRoot,
      dataPath: options.dataPath,
      assets: Object.fromEntries(assets.map((asset, index) => [asset, hashes[index]])),
    };
    await writeFile(resolve(options.outputDir, `capture-${options.side}.json`), `${JSON.stringify(output, null, 2)}\n`);
    return output;
  } finally {
    await browser.close();
    await server.close();
  }
}

async function importDashboardModule(sourceRoot: string): Promise<RenderDashboardModule> {
  const modulePath = pathToFileURL(resolve(sourceRoot, "apps/inferock-bench/src/dashboard.ts")).href;
  const imported = await import(modulePath) as Partial<RenderDashboardModule>;
  if (typeof imported.renderDashboardHtml !== "function") {
    throw new Error(`renderDashboardHtml export missing from ${modulePath}`);
  }
  return { renderDashboardHtml: imported.renderDashboardHtml };
}

async function importShareCardModule(sourceRoot: string): Promise<ShareCardModule> {
  const modulePath = pathToFileURL(resolve(sourceRoot, "apps/inferock-bench/src/share-card.ts")).href;
  const imported = await import(modulePath) as Partial<ShareCardModule>;
  if (typeof imported.createShareCardModel !== "function" || typeof imported.renderShareCard !== "function") {
    throw new Error(`share-card exports missing from ${modulePath}`);
  }
  return {
    createShareCardModel: imported.createShareCardModel,
    renderShareCard: imported.renderShareCard,
  };
}

async function startRenderServer(
  dashboardModule: RenderDashboardModule,
  data: FreshRunData,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const managementAccessToken = "fresh-display-capture-management-token";
  const server = createServer((incoming, outgoing) => {
    void handleRenderRequest(incoming, outgoing, dashboardModule, data, managementAccessToken);
  });
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("render server did not expose a TCP address");
  return {
    port: address.port,
    close: () => closeServer(server),
  };
}

async function handleRenderRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponseLike,
  dashboardModule: RenderDashboardModule,
  data: FreshRunData,
  managementAccessToken: string,
): Promise<void> {
  try {
    const response = renderResponse(incoming, dashboardModule, data, managementAccessToken);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(error instanceof Error ? error.message : "display capture server error");
  }
}

type ServerResponseLike = Pick<ServerResponse, "statusCode" | "setHeader" | "end">;

function renderResponse(
  incoming: IncomingMessage,
  dashboardModule: RenderDashboardModule,
  data: FreshRunData,
  managementAccessToken: string,
): Response {
  const origin = `http://${incoming.headers.host ?? "127.0.0.1"}`;
  const url = new URL(incoming.url ?? "/", origin);
  if (url.pathname === "/") {
    return new Response(dashboardModule.renderDashboardHtml({ managementAccessToken }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (url.pathname === "/api/summary") return localJson(data.summaryPayload);
  if (url.pathname === "/api/rows") return localJson(data.rowsPayload);
  if (url.pathname === "/api/calls") return localJson(data.callsPayload);
  if (url.pathname === "/api/receipt") return localJson(data.receiptPayload);
  if (url.pathname === "/api/coverage-test/options") return localJson(data.optionsPayload);
  if (url.pathname === "/api/coverage-test/runs") return localJson(data.runsPayload);
  if (url.pathname === "/api/coverage-test/runs/latest") return localJson(data.run);
  if (url.pathname === `/api/coverage-test/runs/${encodeURIComponent(data.runId)}`) return localJson(data.run);
  if (url.pathname === `/api/coverage-test/runs/${encodeURIComponent(data.runId)}/receipt`) return localJson(data.receiptPayload);
  if (url.pathname === `/api/coverage-test/runs/${encodeURIComponent(data.runId)}/events`) {
    return new Response("", { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  }
  return localJson({ error: "not_found", message: `Unhandled capture path ${url.pathname}` }, 404);
}

function localJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

interface ViewportSpec {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile?: boolean;
  readonly hasTouch?: boolean;
}

async function captureReceipt(
  browser: Browser,
  baseUrl: string,
  outputPath: string,
  viewport: ViewportSpec,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile ?? false,
    hasTouch: viewport.hasTouch ?? false,
  });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForFreshRunReceipt(page);
    await hideDynamicChrome(page);
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await context.close();
  }
}

async function captureDashboard(browser: Browser, baseUrl: string, outputPath: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: DASHBOARD_CAPTURE_VIEWPORT_WIDTH, height: DASHBOARD_CAPTURE_VIEWPORT_HEIGHT },
    deviceScaleFactor: DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR,
  });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForFreshRunReceipt(page);
    await hideDynamicChrome(page);
    await page.evaluate(() => {
      document.body.dataset.staticCapture = "dashboard-real-traffic";
    });
    const clip = await dashboardClip(page);
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: false, clip });
  } finally {
    await context.close();
  }
}

async function waitForFreshRunReceipt(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="done-state"]', { state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.body.dataset.stage === "done");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="receipt-mode-label"]')?.textContent?.trim() === "Receipt"
  );
  const visibleText = await page.locator("body").innerText();
  const forbidden = [
    "Saved results from earlier calls",
    "Run test for a fresh receipt",
    "Previous results",
    "Previous run receipt",
  ];
  for (const phrase of forbidden) {
    if (visibleText.includes(phrase)) throw new Error(`capture rendered stale receipt phrase: ${phrase}`);
  }
}

async function hideDynamicChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const refresh = document.querySelector('[data-testid="refresh-status"]') as HTMLElement | null;
    if (refresh) refresh.style.visibility = "hidden";
  });
}

async function dashboardClip(page: Page): Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }> {
  return await page.locator(".page").evaluate((element, padding) => {
    const pageRect = (element as HTMLElement).getBoundingClientRect();
    const ledger = document.querySelector(".receipt-card") as HTMLElement | null;
    if (!ledger) throw new Error("receipt card not found for dashboard capture");
    const ledgerRect = ledger.getBoundingClientRect();
    const x = Math.max(0, Math.floor(pageRect.left - padding));
    const y = Math.max(0, Math.floor(pageRect.top - padding));
    const right = Math.min(window.innerWidth, Math.ceil(pageRect.right + padding));
    const bottom = Math.min(window.innerHeight, Math.ceil(ledgerRect.bottom + padding));
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }, DASHBOARD_CAPTURE_CLIP_PADDING);
}

function renderShareCardText(module: ShareCardModule, data: FreshRunData): string {
  const receipt = recordValue(data.shareCardReceiptPayload.bundle) ?? recordValue(data.receiptPayload.bundle);
  if (!receipt) throw new Error("fresh run data missing receipt bundle");
  return module.renderShareCard(module.createShareCardModel(receipt), { width: 68 });
}

async function captureShareCard(browser: Browser, rendered: string, outputPath: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; background: #f7f5f2; }
    body { display: inline-block; padding: 28px; }
    pre {
      margin: 0;
      padding: 18px 20px;
      color: #1f2933;
      background: #fffdf9;
      border: 1px solid #d8d1c7;
      border-radius: 6px;
      font: 700 16px/1.42 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      white-space: pre;
    }
  </style>
</head>
<body><pre>${escapeHtml(rendered)}</pre></body>
</html>`);
    await mkdir(dirname(outputPath), { recursive: true });
    await page.locator("pre").screenshot({ path: outputPath });
  } finally {
    await context.close();
  }
}

async function imageMetadata(path: string): Promise<JsonRecord> {
  const bytes = (await stat(path)).size;
  const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  return { bytes, sha256 };
}

async function readFreshRunData(path: string): Promise<FreshRunData> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!recordValue(parsed) || parsed.schemaVersion !== "inferock-display-fresh-run-data-v1") {
    throw new Error(`invalid fresh run data file: ${path}`);
  }
  return parsed as FreshRunData;
}

async function writeFreshRunData(path: string, data: FreshRunData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function jsonResponse(response: Response): Promise<JsonRecord> {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const parsed = await response.json() as unknown;
  const record = recordValue(parsed);
  if (!record) throw new Error("expected JSON object response");
  return record;
}

async function textResponse(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return await response.text();
}

function recordValue(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const data = options.generateData
    ? await generateFreshRunData(options.sourceRoot)
    : await readFreshRunData(options.dataPath);
  if (options.generateData) await writeFreshRunData(options.dataPath, data);
  const output = await renderSide(options, data);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
