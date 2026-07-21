import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import playwright, { type Page } from "@playwright/test";
import { createBenchApp } from "../src/proxy.js";
import { ensurePrivateDir, writePrivateTextFile } from "../src/private-files.js";
import { JsonlEventStore } from "../src/storage.js";
import type { BenchConfig, BenchPaths } from "../src/config.js";
import {
  DASHBOARD_CAPTURE_CLIP_PADDING,
  DASHBOARD_CAPTURE_CLIP_WIDTH,
  DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR,
  DASHBOARD_CAPTURE_PAGE_WIDTH,
  DASHBOARD_CAPTURE_VIEWPORT_HEIGHT,
  DASHBOARD_CAPTURE_VIEWPORT_WIDTH,
} from "../src/dashboard-capture-spec.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const seedRunId = "speedtest_20f50256-1816-4078-97af-2b9582c15c44";
const benchKey = "capture-local-placeholder";
const captureManagementAccessToken = "capture-dashboard-real-traffic-management-token";
const captureDeviceScaleFactor = DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR;
const defaultComponentRoot = process.env.INFEROCK_BENCH_CAPTURE_COMPONENT_ROOT
  ? resolve(process.env.INFEROCK_BENCH_CAPTURE_COMPONENT_ROOT)
  : resolve(repoRoot, "scratchpad");

interface CaptureOptions {
  readonly newrunEvents: string;
  readonly run15Events: string;
  readonly captureHome: string;
  readonly outputPath: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly clipPadding: number;
}

interface LineRecord {
  readonly line: string;
  readonly runId?: string;
}

interface CaptureClip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface HeadlineMetric {
  readonly cardTop: number;
  readonly labelText: string;
  readonly labelTop: number;
  readonly labelHeight: number;
  readonly labelLineHeight: number;
  readonly valueText: string;
  readonly valueTop: number;
  readonly valueBottom: number;
  readonly labelWhiteSpace: string;
  readonly whiteSpace: string;
  readonly labelScrollWidth: number;
  readonly labelClientWidth: number;
  readonly height: number;
  readonly lineHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

interface LedgerDividerMetric {
  readonly rowIndex: number;
  readonly labels: readonly string[];
  readonly leftRuleY: number;
  readonly rightRuleY: number;
  readonly minRuleY: number;
  readonly maxRuleY: number;
}

function usage(): string {
  return [
    "Usage: pnpm --filter inferock-bench capture:dashboard-real-traffic [options]",
    "",
    "Options:",
    "  --component-root <path>   Root containing newrun/ and run15/ component stores.",
    "  --newrun-events <path>    Override the 2026-07-09 event component.",
    "  --run15-events <path>     Override the run15 extracted event component.",
    "  --capture-home <path>     Temporary INFEROCK_BENCH_HOME for reassembled store.",
    "  --output <path>           Dashboard PNG output path.",
    `  --viewport-width <px>     Desktop viewport width. Default: ${DASHBOARD_CAPTURE_VIEWPORT_WIDTH}.`,
    `  --viewport-height <px>    Desktop viewport height. Default: ${DASHBOARD_CAPTURE_VIEWPORT_HEIGHT}.`,
    `  --clip-padding <px>       Padding around the rendered .page content column. Default: ${DASHBOARD_CAPTURE_CLIP_PADDING}.`,
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CaptureOptions {
  let componentRoot = defaultComponentRoot;
  let newrunEvents: string | undefined;
  let run15Events: string | undefined;
  let captureHome = resolve(repoRoot, "scratchpad/dashboard-real-traffic-capture/.inferock-bench");
  let outputPath = resolve(repoRoot, "oss/public-root/assets/dashboard-real-traffic.png");
  let viewportWidth = DASHBOARD_CAPTURE_VIEWPORT_WIDTH;
  let viewportHeight = DASHBOARD_CAPTURE_VIEWPORT_HEIGHT;
  let clipPadding = DASHBOARD_CAPTURE_CLIP_PADDING;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === "--component-root") componentRoot = resolve(value);
    else if (arg === "--newrun-events") newrunEvents = resolve(value);
    else if (arg === "--run15-events") run15Events = resolve(value);
    else if (arg === "--capture-home") captureHome = resolve(value);
    else if (arg === "--output") outputPath = resolve(value);
    else if (arg === "--viewport-width") viewportWidth = positiveInteger(value, arg);
    else if (arg === "--viewport-height") viewportHeight = positiveInteger(value, arg);
    else if (arg === "--clip-padding") clipPadding = positiveInteger(value, arg);
    else throw new Error(`unknown option ${arg}`);
    index += 1;
  }

  return {
    newrunEvents: newrunEvents ?? resolve(componentRoot, "newrun/newrun/events.jsonl"),
    run15Events: run15Events ?? resolve(componentRoot, "run15/harvest/extracted-store/.inferock-bench/events.jsonl"),
    captureHome,
    outputPath,
    viewportWidth,
    viewportHeight,
    clipPadding,
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function readEventLines(path: string): Promise<LineRecord[]> {
  const raw = await readFile(path, "utf8");
  return raw.split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as { readonly runId?: unknown };
      return {
        line,
        ...(typeof parsed.runId === "string" ? { runId: parsed.runId } : {}),
      };
    });
}

async function assembleStore(options: CaptureOptions): Promise<{
  readonly paths: BenchPaths;
  readonly eventsHash: string;
  readonly eventsBytes: number;
}> {
  const newrun = await readEventLines(options.newrunEvents);
  const run15 = await readEventLines(options.run15Events);
  const run15WithoutSeed = run15.filter((record) => record.runId !== seedRunId);
  const dropped = run15.length - run15WithoutSeed.length;
  if (newrun.length !== 107) throw new Error(`expected 107 newrun events, saw ${newrun.length}`);
  if (run15.length !== 1162) throw new Error(`expected 1162 run15 events, saw ${run15.length}`);
  if (dropped !== 1) throw new Error(`expected to drop one run15 seed row, dropped ${dropped}`);

  const combined = [...newrun, ...run15WithoutSeed];
  if (combined.length !== 1268) throw new Error(`expected 1268 cumulative events, saw ${combined.length}`);

  const homeDir = options.captureHome;
  const eventsFile = resolve(homeDir, "events.jsonl");
  const combinedEvents = `${combined.map((record) => record.line).join("\n")}\n`;
  await rm(homeDir, { recursive: true, force: true });
  await ensurePrivateDir(resolve(homeDir, "receipts"));
  await writePrivateTextFile(eventsFile, combinedEvents);
  await writePrivateTextFile(resolve(homeDir, "config"), `${JSON.stringify({ benchKey }, null, 2)}\n`);

  return {
    paths: {
      homeDir,
      configFile: resolve(homeDir, "config"),
      eventsFile,
      receiptsDir: resolve(homeDir, "receipts"),
    },
    eventsHash: `sha256:${createHash("sha256").update(combinedEvents).digest("hex")}`,
    eventsBytes: Buffer.byteLength(combinedEvents),
  };
}

function requestFromIncoming(incoming: IncomingMessage): Request {
  const origin = `http://${incoming.headers.host ?? "127.0.0.1"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return new Request(new URL(incoming.url ?? "/", origin), {
    method: incoming.method ?? "GET",
    headers,
  });
}

async function startCaptureServer(paths: BenchPaths): Promise<{
  readonly port: number;
  readonly close: () => Promise<void>;
}> {
  const config: BenchConfig = { benchKey };
  const app = createBenchApp({
    config,
    paths,
    store: new JsonlEventStore(paths.eventsFile),
    env: {
      INFEROCK_BENCH_HOME: paths.homeDir,
      INFEROCK_BENCH_KEY: benchKey,
    },
    log: () => undefined,
    managementAccessToken: captureManagementAccessToken,
  });

  const server = createServer(async (incoming, outgoing) => {
    try {
      const response = await app.fetch(requestFromIncoming(incoming));
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : "capture server error");
    }
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a TCP address");

  return {
    port: address.port,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error?: Error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function waitForDashboardValues(page: Page): Promise<void> {
  await page.getByTestId("view-previous-results").click();
  await page.waitForSelector('[data-testid="done-state"]', { state: "visible" });
  await page.waitForFunction(() => document.body.dataset.stage === "done");
  await assertTestIdText(page, "spent-headline", "$7.15");
  await assertTestIdText(page, "money-headline-standard", "$0.03 (0.4%)");
  await assertTestIdText(page, "time-headline", "~2.9 min");
  await assertTestIdText(page, "invoice-check-exposure-headline", "$16.80");
  await assertTestIdText(page, "receipt-calls", "1,268");
  await assertTestIdText(page, "receipt-failures", "564");
  await assertTestIdText(page, "receipt-surfaces", "12 / 13");
  await assertTestIdText(page, "receipt-provider-spend", "$7.15");
}

async function assertTestIdText(page: Page, testId: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ testId: targetTestId, expected: expectedText }) =>
      document.querySelector(`[data-testid="${targetTestId}"]`)?.textContent?.trim() === expectedText,
    { testId, expected },
  );
}

async function assertNoVisibleKeyPanel(page: Page): Promise<void> {
  const visibleKeyPanels = await page.locator(".key-panel").evaluateAll((panels) =>
    panels.filter((panel) => {
      const element = panel as HTMLElement;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).length,
  );
  if (visibleKeyPanels !== 0) {
    throw new Error(`expected key panel to be hidden in dashboard capture, saw ${visibleKeyPanels}`);
  }
}

async function assertNoVisibleSecretsOrHostPaths(page: Page): Promise<void> {
  const visibleText = await page.evaluate(() => document.body.innerText);
  const forbidden = [/ibl_/, /sk-/, /\/home\//, /\/Users\//, /(^|[^A-Za-z0-9])ec2-user([^A-Za-z0-9]|$)/];
  for (const pattern of forbidden) {
    if (pattern.test(visibleText)) {
      throw new Error(`visible dashboard text matched forbidden masking pattern ${pattern}`);
    }
  }
}

async function assertHeadlineAlignment(page: Page): Promise<void> {
  const headlineMetrics: HeadlineMetric[] = await page.locator(".headline-card").evaluateAll((cards) => cards.map((card) => {
    const label = card.querySelector(".headline-card-label") as HTMLElement | null;
    const value = card.querySelector(".headline-card-value") as HTMLElement | null;
    if (!label || !value) throw new Error("headline card missing label or value");
    const cardRect = (card as HTMLElement).getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    const labelStyle = window.getComputedStyle(label);
    const style = window.getComputedStyle(value);
    return {
      cardTop: cardRect.top,
      labelText: label.textContent?.trim() ?? "",
      labelTop: labelRect.top,
      labelHeight: labelRect.height,
      labelLineHeight: Number.parseFloat(labelStyle.lineHeight),
      valueText: value.textContent?.trim() ?? "",
      valueTop: valueRect.top,
      valueBottom: valueRect.bottom,
      labelWhiteSpace: labelStyle.whiteSpace,
      whiteSpace: style.whiteSpace,
      labelScrollWidth: label.scrollWidth,
      labelClientWidth: label.clientWidth,
      height: valueRect.height,
      lineHeight: Number.parseFloat(style.lineHeight),
      scrollWidth: value.scrollWidth,
      clientWidth: value.clientWidth,
    };
  }));
  if (headlineMetrics.length !== 4) throw new Error(`expected four headline cards, saw ${headlineMetrics.length}`);

  for (const metric of headlineMetrics) {
    if (metric.labelWhiteSpace !== "nowrap") {
      throw new Error(`headline label ${metric.labelText} is not nowrap`);
    }
    if (Math.abs(metric.labelHeight - metric.labelLineHeight) > 1) {
      throw new Error(`headline label ${metric.labelText} is not exactly one line`);
    }
    if (metric.labelScrollWidth > metric.labelClientWidth + 1) {
      throw new Error(`headline label ${metric.labelText} overflowed`);
    }
    if (metric.whiteSpace !== "nowrap") throw new Error(`headline value ${metric.valueText} is not nowrap`);
    if (metric.height > metric.lineHeight * 1.2) throw new Error(`headline value ${metric.valueText} wrapped vertically`);
    if (metric.scrollWidth > metric.clientWidth + 1) throw new Error(`headline value ${metric.valueText} overflowed`);
  }
  const labelHeights = headlineMetrics.map((metric) => metric.labelHeight);
  if (Math.max(...labelHeights) - Math.min(...labelHeights) > 1) {
    throw new Error("headline label zones are not equal height");
  }

  const rows: HeadlineMetric[][] = [];
  for (const metric of headlineMetrics) {
    const row = rows.find((candidate) => Math.abs(candidate[0]!.cardTop - metric.cardTop) <= 2);
    if (row) row.push(metric);
    else rows.push([metric]);
  }
  for (const row of rows.filter((candidate) => candidate.length > 1)) {
    const labelTops = row.map((metric) => metric.labelTop);
    const valueTops = row.map((metric) => metric.valueTop);
    const valueBottoms = row.map((metric) => metric.valueBottom);
    if (Math.max(...labelTops) - Math.min(...labelTops) > 2) throw new Error("headline label tops are not row-aligned");
    if (Math.max(...valueTops) - Math.min(...valueTops) > 2) throw new Error("headline value tops are not row-aligned");
    if (Math.max(...valueBottoms) - Math.min(...valueBottoms) > 2) throw new Error("headline value baselines are not row-aligned");
  }
}

async function assertLedgerDividerAlignment(page: Page): Promise<void> {
  const metrics: LedgerDividerMetric[] = await page.locator(".receipt-ledger").evaluate((ledger) => {
    const element = ledger as HTMLElement;
    const computed = window.getComputedStyle(element);
    if (computed.display !== "grid") throw new Error("receipt ledger is not a CSS grid");
    if (computed.gridTemplateColumns.split(" ").length !== 4) {
      throw new Error(`receipt ledger capture grid does not have four columns: ${computed.gridTemplateColumns}`);
    }

    const cells = Array.from(element.children) as HTMLElement[];
    if (cells.length % 4 !== 0) throw new Error(`receipt ledger cell count ${cells.length} is not divisible by four`);

    const rows: LedgerDividerMetric[] = [];
    for (let index = 0; index < cells.length; index += 4) {
      const rowCells = cells.slice(index, index + 4);
      const bottoms = rowCells.map((cell) => cell.getBoundingClientRect().bottom);
      const leftRuleY = Math.max(bottoms[0] ?? 0, bottoms[1] ?? 0);
      const rightRuleY = Math.max(bottoms[2] ?? 0, bottoms[3] ?? 0);
      rows.push({
        rowIndex: index / 4,
        labels: [rowCells[0]?.textContent?.trim() ?? "", rowCells[2]?.textContent?.trim() ?? ""],
        leftRuleY,
        rightRuleY,
        minRuleY: Math.min(...bottoms),
        maxRuleY: Math.max(...bottoms),
      });
    }
    return rows;
  });

  if (metrics.length === 0) throw new Error("receipt ledger produced no divider rows");
  for (const metric of metrics) {
    if (Math.abs(metric.leftRuleY - metric.rightRuleY) > 1 || metric.maxRuleY - metric.minRuleY > 1) {
      throw new Error(`receipt ledger divider row ${metric.rowIndex} is misaligned: ${JSON.stringify(metric)}`);
    }
  }
}

async function assertCaptureSpec(page: Page, options: CaptureOptions, clip: CaptureClip): Promise<void> {
  if (captureDeviceScaleFactor !== DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR) {
    throw new Error(`capture deviceScaleFactor ${captureDeviceScaleFactor} does not match ${DASHBOARD_CAPTURE_DEVICE_SCALE_FACTOR}`);
  }
  if (options.clipPadding !== DASHBOARD_CAPTURE_CLIP_PADDING) {
    throw new Error(`capture clip padding ${options.clipPadding} does not match ${DASHBOARD_CAPTURE_CLIP_PADDING}`);
  }
  if (clip.width !== DASHBOARD_CAPTURE_CLIP_WIDTH) {
    throw new Error(`capture clip width ${clip.width} does not match ${DASHBOARD_CAPTURE_CLIP_WIDTH}`);
  }

  const boundary = await page.locator(".page").evaluate((element, input) => {
    const pageRect = (element as HTMLElement).getBoundingClientRect();
    const ledger = document.querySelector(".receipt-card") as HTMLElement | null;
    const actionSection = document.querySelector(".action-section") as HTMLElement | null;
    if (!ledger) throw new Error("receipt ledger section not found for capture invariant");
    const ledgerRect = ledger.getBoundingClientRect();
    const actionTop = actionSection?.getBoundingClientRect().top ?? null;
    return {
      pageWidth: pageRect.width,
      expectedClipBottom: Math.ceil(ledgerRect.bottom + input.clipPadding),
      clipBottom: input.clip.y + input.clip.height,
      actionTop,
    };
  }, { clip, clipPadding: options.clipPadding });

  if (Math.abs(boundary.pageWidth - DASHBOARD_CAPTURE_PAGE_WIDTH) > 1) {
    throw new Error(`capture page width ${boundary.pageWidth} does not match ${DASHBOARD_CAPTURE_PAGE_WIDTH}`);
  }
  if (Math.abs(boundary.clipBottom - boundary.expectedClipBottom) > 1) {
    throw new Error(`capture clip bottom ${boundary.clipBottom} does not land on previous-results ledger boundary ${boundary.expectedClipBottom}`);
  }
  if (boundary.actionTop !== null && boundary.clipBottom > boundary.actionTop) {
    throw new Error(`capture clip enters action section: bottom ${boundary.clipBottom}, action top ${boundary.actionTop}`);
  }
}

async function assertCaptureInvariants(page: Page, options: CaptureOptions, clip: CaptureClip): Promise<void> {
  await assertHeadlineAlignment(page);
  await assertLedgerDividerAlignment(page);
  await assertCaptureSpec(page, options, clip);
}

async function contentColumnClip(page: Page, options: CaptureOptions): Promise<CaptureClip> {
  const clip: CaptureClip = await page.locator(".page").evaluate((element, input) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    const ledger = document.querySelector(".receipt-card") as HTMLElement | null;
    if (!ledger) throw new Error("receipt ledger section not found for capture clip");
    const ledgerRect = ledger.getBoundingClientRect();
    const actionSection = document.querySelector(".action-section") as HTMLElement | null;
    const bottom = Math.ceil(ledgerRect.bottom + input.clipPadding);
    if (bottom > input.viewportHeight) {
      throw new Error(`receipt ledger bottom ${bottom} exceeds viewport height ${input.viewportHeight}`);
    }
    if (actionSection) {
      const actionTop = actionSection.getBoundingClientRect().top;
      if (bottom > actionTop) {
        throw new Error(`capture clip would cut into action section: bottom ${bottom}, action top ${actionTop}`);
      }
    }
    const x = Math.max(0, Math.floor(rect.left - input.clipPadding));
    const y = Math.max(0, Math.floor(rect.top - input.clipPadding));
    const right = Math.min(input.viewportWidth, Math.ceil(rect.right + input.clipPadding));
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }, {
    clipPadding: options.clipPadding,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
  });

  if (clip.width <= 0 || clip.height <= 0) throw new Error(`invalid screenshot clip ${JSON.stringify(clip)}`);
  if (clip.width > DASHBOARD_CAPTURE_CLIP_WIDTH) {
    throw new Error(`content clip is too wide and would retain dead margins: ${JSON.stringify(clip)}`);
  }
  return clip;
}

async function applyStaticCaptureMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.dataset.staticCapture = "dashboard-real-traffic";
  });
}

async function addWatermarkInsideClip(page: Page, clip: CaptureClip): Promise<void> {
  const watermarkTop = await page.locator(".topbar").evaluate((topbar) =>
    Math.ceil((topbar as HTMLElement).getBoundingClientRect().bottom + 16),
  );
  await page.evaluate(({ captureClip, top }) => {
    const existing = document.getElementById("publicWatermark");
    if (existing) existing.remove();
    const watermark = document.createElement("div");
    watermark.id = "publicWatermark";
    watermark.textContent = "github.com/inferock/inferock-bench";
    watermark.setAttribute("aria-hidden", "true");
    Object.assign(watermark.style, {
      position: "fixed",
      left: `${captureClip.x + captureClip.width - 22}px`,
      top: `${top}px`,
      transform: "translateX(-100%)",
      width: "max-content",
      zIndex: "2147483647",
      padding: "7px 12px",
      border: "1px solid #D8D1C7",
      borderRadius: "6px",
      background: "#F7F5F2",
      color: "#3F3A33",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: "14px",
      fontWeight: "700",
      lineHeight: "1",
      letterSpacing: "0",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(watermark);
  }, { captureClip: clip, top: watermarkTop });
  const watermarkBox = await page.locator("#publicWatermark").boundingBox();
  if (!watermarkBox) throw new Error("watermark did not render");
  if (watermarkBox.x < clip.x || watermarkBox.x + watermarkBox.width > clip.x + clip.width) {
    throw new Error(`watermark is outside screenshot clip: ${JSON.stringify({ clip, watermarkBox })}`);
  }
  if (watermarkBox.y < clip.y || watermarkBox.y + watermarkBox.height > clip.y + clip.height) {
    throw new Error(`watermark is outside screenshot clip: ${JSON.stringify({ clip, watermarkBox })}`);
  }
}

async function captureDashboard(options: CaptureOptions): Promise<void> {
  const { paths, eventsHash, eventsBytes } = await assembleStore(options);
  const server = await startCaptureServer(paths);
  const browser = await playwright.chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({
      viewport: { width: options.viewportWidth, height: options.viewportHeight },
      deviceScaleFactor: captureDeviceScaleFactor,
    });
    await page.goto(`http://127.0.0.1:${server.port}/?token=${captureManagementAccessToken}`, { waitUntil: "networkidle" });
    await waitForDashboardValues(page);
    await applyStaticCaptureMode(page);
    await assertNoVisibleKeyPanel(page);
    await assertNoVisibleSecretsOrHostPaths(page);
    const clip = await contentColumnClip(page, options);
    await assertCaptureInvariants(page, options, clip);
    await addWatermarkInsideClip(page, clip);
    await page.waitForTimeout(300);
    await mkdir(dirname(options.outputPath), { recursive: true });
    await page.screenshot({ path: options.outputPath, fullPage: false, clip });

    const bytes = (await stat(options.outputPath)).size;
    const hash = createHash("sha256").update(await readFile(options.outputPath)).digest("hex");
    console.log(JSON.stringify({
      outputPath: options.outputPath,
      sha256: `sha256:${hash}`,
      bytes,
      dimensions: `${clip.width * captureDeviceScaleFactor} x ${clip.height * captureDeviceScaleFactor}`,
      cssDimensions: `${clip.width} x ${clip.height}`,
      deviceScaleFactor: captureDeviceScaleFactor,
      captureMethod: `${options.viewportWidth}x${options.viewportHeight} desktop viewport at ${captureDeviceScaleFactor}x DPR; Playwright screenshot clip of ${DASHBOARD_CAPTURE_PAGE_WIDTH}px .page bounding box plus ${options.clipPadding}px padding (${DASHBOARD_CAPTURE_CLIP_WIDTH}px CSS clip width), ending after the previous-results ledger`,
      clip,
      cumulativeEvents: 1268,
      eventsHash,
      eventsBytes,
    }, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

await captureDashboard(parseArgs(process.argv.slice(2)));
