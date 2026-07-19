import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalEventAny } from "@inferock/measure/canonical-event";
import type { ProviderFetch } from "./proxy.js";
import { BENCH_PACKAGE_VERSION } from "./version.js";
import { loadCoverageTokenBaselineFromValue } from "./coverage-suite/baseline.js";
import { loadCoverageSuiteManifest } from "./coverage-suite/manifest.js";
import {
  dashboardSetupState,
  dashboardStateFor,
  recentCallsFromRecords,
  renderDashboardHtml,
} from "./dashboard.js";
import { ensureGeneratedBenchKey, maskSecret, resolveBenchPaths } from "./config.js";
import { createBenchApp } from "./proxy.js";
import type { EventStore, StoredBenchEvent } from "./storage.js";
import { summarizeBenchEvents } from "./summary.js";
import { planAgentProvisioning } from "./agent-mode/provisioner.js";
import { SPEEDTEST_RECEIPT_SCHEMA_VERSION } from "./receipt-schema.js";

class MemoryStore implements EventStore {
  constructor(readonly records: StoredBenchEvent[] = []) {}

  async append(record: StoredBenchEvent): Promise<void> {
    this.records.push(record);
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    return [...this.records];
  }
}

async function dashboardManagementHeaders(app: ReturnType<typeof createBenchApp>): Promise<Record<string, string>> {
  const html = await (await app.request("/")).text();
  const token = html.match(/const MANAGEMENT_ACCESS_TOKEN = "([^"]+)";/)?.[1];
  if (!token) throw new Error("dashboard management authorization token missing");
  return { "x-inferock-bench-management": token };
}

describe("dashboard", () => {
  it("serves self-contained HTML and honest-zero JSON endpoint shapes", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-dashboard-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const config = await ensureGeneratedBenchKey({ paths, config: {} });
    const app = createBenchApp({ config, paths, store: new MemoryStore(), env: {}, log: () => {} });

    const html = await app.request("/");
    expect(html.status).toBe(200);
    const htmlText = await html.text();
    expect(htmlText).toContain("Inferock Bench");
    expect(htmlText).toContain("data-key-card");
    expect(htmlText).toContain("Find the loss your provider did not recognize");
    expect(htmlText).toContain("Ready to spend");
    expect(htmlText).toContain("Loss measured by the standard");
    expect(htmlText).toContain("Surfaces watched");
    expect(htmlText).toContain("data-testid=\"money-loss-spend-share\"");
    expect(htmlText).toContain("data-testid=\"invoice-check-exposure-headline\"");
    expect(htmlText.match(/class="headline-card"/g) ?? []).toHaveLength(4);
    expect(htmlText.match(/class="headline-card-gloss small muted"/g) ?? []).toHaveLength(4);
    expect(htmlText.match(/class="headline-card-value money-headline"/g) ?? []).toHaveLength(4);
    expect(htmlText).toContain("what providers charged");
    expect(htmlText).toContain("lost within that bill");
    expect(htmlText).toContain("latency & downtime");
    expect(htmlText).toContain("double-check on your bill");
    expect(htmlText).toContain(".headline-card-value");
    expect(htmlText).toContain("white-space: nowrap;");
    expect(htmlText).toContain("data-testid=\"receipt-invoice-check-exposure\"");
    expect(htmlText).toContain("What should I do about it?");
    expect(htmlText).toContain("data-testid=\"exposure-card\"");
    expect(htmlText).toContain("invoice-check exposure, not standard-loss or recognition-gap dollars");
    expect(htmlText).toContain("consentDialog");
    expect(htmlText).toContain("agentInstallConsent");
    expect(htmlText).toContain("agentInstallAck");
    expect(htmlText).toContain("state.agentInstallAcknowledgedHash");
    expect(htmlText).not.toContain("body.agentInstallConsentHash = payload.agentInstall.consentHash");
    expect(htmlText).toContain("displayedEstimateUsd");
    expect(htmlText).toContain("displayedConsentHash");
    expect(htmlText).not.toContain("Test my loss");
    expect(htmlText).not.toContain("Run test with a real coding agent");
    expect(htmlText).not.toContain("$ lost so far");
    expect(htmlText).not.toContain("Surface coverage");
    expect(htmlText).not.toContain("Recent calls");
    expect(htmlText).not.toContain("Coverage test receipt");
    expect(htmlText).toContain('status === "queued" || status === "running" || status === "draining"');
    expect(htmlText).toContain('if (run.receiptReady || (isCoverageRunTerminal(run) && run.status === "failed")) source.close();');
    expect(htmlText).not.toContain("if (isCoverageRunTerminal(run)) source.close();");
    expect(htmlText).not.toContain("measure.verdict");
    expect(htmlText).not.toContain("evidence grade");
    expect(htmlText).not.toContain("consent hash");
    expect(htmlText).not.toContain("ibl_");
    expect(htmlText).not.toContain("cdn.");

    const summary = await (await app.request("/api/summary")).json() as {
      summary: {
        measuredCalls: number;
        failureCount: number;
        standardLossUsd: number;
        totalLostUsd: number;
        moneyLossObservedSpendLine: string;
        slaAssumptions: { impactFooterLines: readonly string[] };
      };
      setup: { maskedBenchKey: string | null; canRevealBenchKey: boolean };
      dashboardState: string;
    };
    expect(summary.summary).toMatchObject({
      measuredCalls: 0,
      failureCount: 0,
      standardLossUsd: 0,
      totalLostUsd: 0,
      moneyLossObservedSpendLine: "money loss = no priced spend measured",
    });
    expect(summary.summary.slaAssumptions.impactFooterLines[0])
      .toContain("no impact figures computed");
    expect(summary.setup.maskedBenchKey).toBe(maskSecret(config.benchKey ?? ""));
    expect(summary.setup.canRevealBenchKey).toBe(true);
    expect(summary.dashboardState).toBe("no-provider");

    await expect((await app.request("/api/rows")).json()).resolves.toEqual({ rows: [] });
    await expect((await app.request("/api/calls?limit=2")).json()).resolves.toMatchObject({
      limit: 2,
      calls: [],
    });
    const receipt = await (await app.request("/api/receipt")).json() as { compactText: string };
    expect(receipt.compactText.split("\n")[0]).toBe("spent $0.00 · money loss $0.00 · time loss ~0s · invoice-check exposure $0.00");
    expect(receipt.compactText.split("\n")[1]).toBe("provider-recognized $0.00 · recognition gap $0.00 · money loss = no priced spend measured");
  });

  it("serves direct health status", async () => {
    const app = createBenchApp({
      config: { benchKey: "local_bench_key_health" },
      store: new MemoryStore(),
      env: {},
      log: () => undefined,
    });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "inferock-bench",
    });
  });

  it("feeds dashboard money-loss headline percent from the observed-spend line", async () => {
    const app = createBenchApp({
      config: { benchKey: "local_bench_key_ratio" },
      store: new MemoryStore([
        storedCall({
          requestId: "req-dashboard-ratio-loss",
          generation: { response_format: { type: "json_object" } },
          responseContent: "not json",
          usage: { input: 200_000, output: 50_000 },
        }),
        storedCall({
          requestId: "req-dashboard-ratio-spend",
          usage: { input: 2_000_000, output: 0 },
        }),
      ]),
      env: {},
      log: () => undefined,
    });

    const summary = await (await app.request("/api/summary")).json() as {
      summary: { moneyLossObservedSpendLine: string | null };
    };
    expect(summary.summary.moneyLossObservedSpendLine).toMatch(/^money loss = \d+\.\d% of observed spend/);
    const percent = summary.summary.moneyLossObservedSpendLine?.match(/^money loss = (\d+\.\d)%/)?.[1];
    if (!percent) throw new Error("dashboard fixture should expose a percent");

    const receipt = await (await app.request("/api/receipt")).json() as { compactText: string };
    expect(receipt.compactText.split("\n")[0]).toContain(` (${percent}%)`);
    expect(receipt.compactText.split("\n")[1]).toContain(summary.summary.moneyLossObservedSpendLine);
  });

  it("feeds dashboard money-loss headline without percent when the ratio is guard-suppressed", async () => {
    const app = createBenchApp({
      config: { benchKey: "local_bench_key_ratio_guard" },
      store: new MemoryStore([
        storedCall({
          requestId: "req-dashboard-rounded-zero-loss",
          generation: { response_format: { type: "json_object" } },
          responseContent: "not json",
        }),
        storedCall({
          requestId: "req-dashboard-rounded-zero-spend",
          usage: { input: 3_000_000, output: 0 },
        }),
      ]),
      env: {},
      log: () => undefined,
    });

    const summary = await (await app.request("/api/summary")).json() as {
      summary: { moneyLossObservedSpendLine: string | null };
    };
    expect(summary.summary.moneyLossObservedSpendLine).toBeNull();

    const receipt = await (await app.request("/api/receipt")).json() as { compactText: string };
    const headline = receipt.compactText.split("\n")[0] ?? "";
    expect(headline).toContain("money loss $");
    expect(headline).not.toMatch(/money loss [^·]+\(\d+\.\d%\)/);
  });

  it("feeds dashboard money-loss headline without percent when pricing is unknown", async () => {
    const app = createBenchApp({
      config: { benchKey: "local_bench_key_pricing_unknown" },
      store: new MemoryStore([
        storedCall({
          requestId: "req-dashboard-pricing-unknown",
          model: "missing-model-price",
          generation: { response_format: { type: "json_object" } },
          responseContent: "not json",
        }),
      ]),
      env: {},
      log: () => undefined,
    });

    const summary = await (await app.request("/api/summary")).json() as {
      summary: { moneyLossObservedSpendLine: string | null; pricingUnknownCount: number };
    };
    expect(summary.summary.pricingUnknownCount).toBeGreaterThan(0);
    expect(summary.summary.moneyLossObservedSpendLine).toBeNull();

    const receipt = await (await app.request("/api/receipt")).json() as { compactText: string };
    expect(receipt.compactText.split("\n")[0]).toBe("spent $0.00 · money loss pricing unknown · time loss ~0s · invoice-check exposure $0.00");
  });

  it("streams Anthropic SSE through the bench server with a mocked provider", async () => {
    const rawProviderKey = ["s", "k", "-ant-stream-secret"].join("");
    const rawBenchKey = ["i", "b", "l", "_anthropic_stream_secret"].join("");
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const app = createBenchApp({
      config: { benchKey: rawBenchKey, anthropicApiKey: rawProviderKey },
      store,
      env: {},
      providerFetch: async (url, init) => {
        providerCalls.push({
          url,
          body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
        });
        return anthropicStreamResponse();
      },
      log: () => undefined,
    });

    const response = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": rawBenchKey,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        stream: true,
        max_tokens: 64,
        messages: [{ role: "user", content: "Write one sentence." }],
      }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("message_start");
    expect(text).toContain("message_stop");
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.url).toContain("/messages");
    expect(JSON.stringify(providerCalls)).not.toContain(rawProviderKey);

    const records = await store.readAll();
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toMatchObject({
      request: { provider: "anthropic", requestedModel: "claude-haiku-4-5-20251001" },
      response: {
        statusCode: 200,
        content: "streamed answer",
        servedModel: "claude-haiku-4-5-20251001",
      },
      usage: { input: 12, output: 7 },
    });
  });

  it("requires explicit rendered agent-install consent before dashboard start", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-agent-consent-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const rawProviderKey = ["s", "k", "-openai-agent-consent-secret"].join("");
    const rawBenchKey = ["i", "b", "l", "_agent_consent_secret"].join("");
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    let providerCalls = 0;
    const app = createBenchApp({
      config: { benchKey: rawBenchKey, openaiApiKey: rawProviderKey },
      paths,
      store: new MemoryStore(),
      env: {},
      coverageTest: { suite, baseline },
      providerFetch: async () => {
        providerCalls += 1;
        return coverageProviderResponse("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o-mini-2024-07-18",
        });
      },
      log: () => undefined,
    });
    const startBody = {
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      generator: "agent",
      spendCapUsd: 1,
    };

    const estimate = await (await app.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(startBody),
    })).json() as {
      consentHash: string;
      agentInstall: {
        consentHash: string;
        benchVersion: string;
        whyText: string;
        platform: string;
        packages: readonly { name: string; version: string; tarballUrl: string; integrity: string; unpackedSize: number }[];
        installRoot: string;
      };
    };
    expect(estimate.agentInstall.consentHash).toMatch(/^sha256:/);
    expect(estimate.agentInstall.benchVersion).toBe(BENCH_PACKAGE_VERSION);
    expect(estimate.agentInstall.whyText).toContain("local coding agent");
    expect(estimate.agentInstall.whyText).toContain("localhost");
    expect(estimate.agentInstall.platform).toContain(process.platform);
    expect(estimate.agentInstall.packages[0]).toMatchObject({
      name: "opencode-ai",
      version: "1.17.13",
    });
    expect(estimate.agentInstall.packages[0]?.tarballUrl).toContain("https://registry.npmjs.org/");
    expect(estimate.agentInstall.packages[0]?.integrity).toMatch(/^sha512-/);
    expect(estimate.agentInstall.installRoot).toContain("agents/opencode-ai/1.17.13");

    const rejected = await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...startBody, consentHash: estimate.consentHash }),
    });

    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({
      error: "agent_install_consent_required",
      agentInstall: { consentHash: estimate.agentInstall.consentHash },
    });
    expect(providerCalls).toBe(0);

    const staleWhyHash = planAgentProvisioning({
      benchHome: paths.homeDir,
      whyText: `${estimate.agentInstall.whyText} stale`,
    }).consentHash;
    expect(staleWhyHash).not.toBe(estimate.agentInstall.consentHash);
    const staleWhy = await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...startBody,
        consentHash: estimate.consentHash,
        agentInstallConsentHash: staleWhyHash,
      }),
    });
    expect(staleWhy.status).toBe(409);
    await expect(staleWhy.json()).resolves.toMatchObject({
      error: "agent_install_consent_required",
      agentInstall: { consentHash: estimate.agentInstall.consentHash },
    });
    expect(providerCalls).toBe(0);

    const staleBenchVersionHash = planAgentProvisioning({
      benchHome: paths.homeDir,
      benchVersion: "0.1.2",
    }).consentHash;
    expect(staleBenchVersionHash).not.toBe(estimate.agentInstall.consentHash);
    const staleBenchVersion = await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...startBody,
        consentHash: estimate.consentHash,
        agentInstallConsentHash: staleBenchVersionHash,
      }),
    });
    expect(staleBenchVersion.status).toBe(409);
    await expect(staleBenchVersion.json()).resolves.toMatchObject({
      error: "agent_install_consent_required",
      agentInstall: { consentHash: estimate.agentInstall.consentHash },
    });
    expect(providerCalls).toBe(0);
  });

  it("surfaces a built-in-driver offer after dashboard agent provisioning failure without swapping generators", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-agent-provision-fail-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    let providerCalls = 0;
    const app = createBenchApp({
      config: {
        benchKey: ["i", "b", "l", "_agent_provision_fail"].join(""),
        openaiApiKey: ["s", "k", "-openai-agent-provision-fail"].join(""),
      },
      paths,
      store: new MemoryStore(),
      env: {},
      coverageTest: { suite, baseline },
      providerFetch: async () => {
        providerCalls += 1;
        return coverageProviderResponse("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o-mini-2024-07-18",
        });
      },
      agentProvisioner: async () => {
        throw new Error("registry offline");
      },
      log: () => undefined,
    });
    const startBody = {
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      generator: "agent",
      spendCapUsd: 1,
    };
    const estimate = await (await app.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(startBody),
    })).json() as { consentHash: string; agentInstall: { consentHash: string } };

    const start = await (await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...startBody,
        consentHash: estimate.consentHash,
        agentInstallConsentHash: estimate.agentInstall.consentHash,
      }),
    })).json() as { run: { runId: string; generator: string } };

    expect(start.run.generator).toBe("agent");
    const failed = await waitForRun(app, start.run.runId);
    expect(failed).toMatchObject({
      status: "failed",
      fallbackOffer: {
        generator: "built-in",
        label: "Run built-in driver instead",
        packageName: "opencode-ai",
        packageVersion: "1.17.13",
        tarballUrl: "https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.17.13.tgz",
        reason: "registry offline",
      },
    });
    expect(providerCalls).toBe(0);
  });

  it("persists setup updates, emits masked-only default payloads, and rewrites config with 0600 permissions", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-setup-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const fullBenchKey = ["i", "b", "l", "_"].join("") + "1234567890abcdef12345678";
    const rawOpenAiKey = ["s", "k", "-", "proj", "-", "benchrender", "-", "1234567890"].join("");
    const rawAnthropicKey = ["s", "k", "-", "ant", "-", "benchrender", "-", "abcdefghij"].join("");
    const config = await ensureGeneratedBenchKey({ paths, config: { benchKey: fullBenchKey } });
    const app = createBenchApp({ config, paths, store: new MemoryStore(), env: {}, log: () => {} });
    const managementHeaders = await dashboardManagementHeaders(app);

    const summaryBefore = await (await app.request("/api/summary")).json();
    const summaryBeforeText = JSON.stringify(summaryBefore);
    expect(summaryBeforeText).not.toContain(fullBenchKey);
    expect(summaryBeforeText).not.toContain(rawOpenAiKey);
    expect(summaryBefore).toMatchObject({
      setup: {
        maskedBenchKey: "ibl_...5678",
        canRevealBenchKey: true,
      },
    });

    const unauthReveal = await app.request("/api/key");
    expect(unauthReveal.status).toBe(401);
    expect(await unauthReveal.text()).not.toContain(fullBenchKey);

    const crossOriginReveal = await app.request("http://127.0.0.1/api/key", {
      headers: {
        "x-api-key": fullBenchKey,
        origin: "https://example.invalid",
      },
    });
    expect(crossOriginReveal.status).toBe(403);
    expect(await crossOriginReveal.text()).not.toContain(fullBenchKey);

    const managementReveal = await (await app.request("/api/key", {
      headers: managementHeaders,
    })).json() as { benchKey: string; maskedBenchKey: string };
    expect(managementReveal).toEqual({
      benchKey: fullBenchKey,
      maskedBenchKey: "ibl_...5678",
    });

    const saved = await app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json", ...managementHeaders },
      body: JSON.stringify({
        openaiApiKey: rawOpenAiKey,
        anthropicApiKey: rawAnthropicKey,
      }),
    });

    expect(saved.status).toBe(200);
    const savedBody = await saved.json() as {
      setup: {
        maskedBenchKey: string | null;
        canRevealBenchKey: boolean;
        providers: {
          openai: { configured: boolean; maskedKey: string };
          anthropic: { configured: boolean; maskedKey: string };
        };
      };
      dashboardState: string;
    };
    const savedText = JSON.stringify(savedBody);
    expect(savedText).not.toContain(rawOpenAiKey);
    expect(savedText).not.toContain(rawAnthropicKey);
    expect(savedText).not.toContain(fullBenchKey);
    expect(savedText).not.toContain("proj");
    expect(savedBody).toMatchObject({
      setup: {
        maskedBenchKey: "ibl_...5678",
        canRevealBenchKey: true,
        providers: {
          openai: { configured: true, maskedKey: "sk-...7890" },
          anthropic: { configured: true, maskedKey: "sk-...ghij" },
        },
      },
      dashboardState: "configured",
    });
    expect(savedBody.dashboardState).toBe("configured");

    const persisted = JSON.parse(await readFile(paths.configFile, "utf8")) as {
      openaiApiKey?: string;
      anthropicApiKey?: string;
    };
    expect(persisted.openaiApiKey).toBe(rawOpenAiKey);
    expect(persisted.anthropicApiKey).toBe(rawAnthropicKey);
    expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);

    const summaryAfter = await (await app.request("/api/summary")).json();
    expect(JSON.stringify(summaryAfter)).not.toContain(rawOpenAiKey);
    expect(JSON.stringify(summaryAfter)).not.toContain(rawAnthropicKey);
    expect(JSON.stringify(summaryAfter)).not.toContain(fullBenchKey);

    const receipt = await (await app.request("/api/receipt")).json();
    expect(JSON.stringify(receipt)).not.toContain(rawOpenAiKey);
    expect(JSON.stringify(receipt)).not.toContain(rawAnthropicKey);
    expect(JSON.stringify(receipt)).not.toContain(fullBenchKey);

    const reveal = await (await app.request("/api/key", { headers: { "x-api-key": fullBenchKey } }))
      .json() as { benchKey: string; maskedBenchKey: string };
    expect(reveal).toEqual({
      benchKey: fullBenchKey,
      maskedBenchKey: "ibl_...5678",
    });

    const removed = await app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json", ...managementHeaders },
      body: JSON.stringify({ openaiApiKey: null }),
    });
    const removedBody = await removed.json() as {
      setup: { providers: { openai: { configured: boolean }; anthropic: { configured: boolean } } };
    };
    expect(removedBody.setup.providers.openai.configured).toBe(false);
    expect(removedBody.setup.providers.anthropic.configured).toBe(true);
    expect(await readFile(paths.configFile, "utf8")).not.toContain(rawOpenAiKey);
  });

  it("renders key-card states for no-provider, configured, and calls-flowing", () => {
    const zeroSummary = summarizeBenchEvents([]);
    const noProvider = dashboardSetupState({ config: { benchKey: "local_bench_key_zero" }, env: {} });
    expect(dashboardStateFor(noProvider, zeroSummary)).toBe("no-provider");

    const configured = dashboardSetupState({
      config: {
        benchKey: "local_bench_key_zero",
        openaiApiKey: "openailocalabcd",
      },
      env: {},
    });
    expect(dashboardStateFor(configured, zeroSummary)).toBe("configured");

    const callSummary = summarizeBenchEvents([storedCall()]);
    expect(dashboardStateFor(configured, callSummary)).toBe("calls-flowing");
    expect(recentCallsFromRecords([storedCall()], 1)).toMatchObject([{
      provider: "openai",
      model: "gpt-4o-mini",
      statusCode: 200,
      totalTokens: 10,
    }]);
    expect(renderDashboardHtml()).toContain("data-key-card");
  });

  it("coverage-test options fail closed for no-key and bootstrap-required baseline states", async () => {
    const noKeyApp = createBenchApp({
      config: { benchKey: "local_bench_key_zero" },
      store: new MemoryStore(),
      env: {},
      log: () => undefined,
    });

    const noKeyOptions = await (await noKeyApp.request("/api/coverage-test/options")).json() as {
      runnable: boolean;
      disabledReason: string;
      baseline: { status: string };
    };
    expect(noKeyOptions.runnable).toBe(false);
    expect(noKeyOptions.disabledReason).toBe("provider_key_needed");
    expect(JSON.stringify(noKeyOptions)).not.toContain("local_bench_key_zero");

    // The bootstrap fail-closed mechanism is probed via an injected fixture:
    // the checked-in baseline is real measured data since 2026-07-04.
    const suite = await loadCoverageSuiteManifest();
    const bootstrapDir = await mkdtemp(join(tmpdir(), "inferock-bench-bootstrap-"));
    const bootstrapPath = join(bootstrapDir, "coverage-suite-v1.tokens.json");
    await writeFile(bootstrapPath, JSON.stringify(bootstrapBaselineForSuite(suite)), "utf8");
    const bootstrapApp = createBenchApp({
      config: { benchKey: "local_bench_key_zero", openaiApiKey: ["s", "k", "-openai-bootstrap-required"].join("") },
      store: new MemoryStore(),
      env: {},
      log: () => undefined,
      coverageTest: { baselineUrl: bootstrapPath },
    });
    const bootstrapOptions = await (await bootstrapApp.request("/api/coverage-test/options")).json() as {
      runnable: boolean;
      disabledReason: string;
      disabledMessage: string;
      baseline: { status: string };
    };
    expect(bootstrapOptions.runnable).toBe(false);
    expect(bootstrapOptions.disabledReason).toBe("baseline_not_measured");
    expect(bootstrapOptions.disabledMessage).toMatch(/baseline not measured yet/i);
    expect(bootstrapOptions.baseline.status).toBe("bootstrap_required");

    const estimateResponse = await bootstrapApp.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini-2024-07-18", generator: "built-in" }),
    });
    expect(estimateResponse.status).toBe(409);
  });

  it("coverage-test model options expose every priced compatible frontier model and estimate them", async () => {
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const app = createBenchApp({
      config: {
        benchKey: "local_bench_key_frontier_options",
        openaiApiKey: ["s", "k", "-openai-frontier-options"].join(""),
        anthropicApiKey: ["s", "k", "-anthropic-frontier-options"].join(""),
      },
      store: new MemoryStore(),
      env: {},
      log: () => undefined,
      coverageTest: { suite, baseline },
    });

    const options = await (await app.request("/api/coverage-test/options")).json() as {
      runnable: boolean;
      providerOptions: readonly {
        provider: string;
        model: string;
        routeCapabilities: readonly string[];
      }[];
    };
    expect(options.runnable).toBe(true);
    const optionKeys = options.providerOptions.map((option) => `${option.provider}:${option.model}`);
    expect(optionKeys).toContain("openai:gpt-5.5");
    expect(optionKeys).toContain("anthropic:claude-opus-4-8");
    expect(options.providerOptions.find((option) => option.provider === "openai" && option.model === "gpt-5.5")?.routeCapabilities)
      .toEqual(expect.arrayContaining(["chat.completions", "responses"]));
    expect(options.providerOptions.find((option) => option.provider === "anthropic" && option.model === "claude-opus-4-8")?.routeCapabilities)
      .toEqual(expect.arrayContaining(["messages"]));

    const estimateResponse = await app.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedModels: [
          { provider: "openai", model: "gpt-5.5" },
          { provider: "anthropic", model: "claude-opus-4-8" },
        ],
        generator: "built-in",
      }),
    });
    expect(estimateResponse.status).toBe(200);
    const estimate = await estimateResponse.json() as {
      estimate: {
        selectedModels: readonly { provider: string; model: string }[];
        estimatedUsd: number;
        pricing: readonly { provider: string; model: string; pricingStatus: string }[];
      };
    };
    expect(estimate.estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.estimate.selectedModels).toEqual(expect.arrayContaining([
      { provider: "openai", model: "gpt-5.5" },
      { provider: "anthropic", model: "claude-opus-4-8" },
    ]));
    expect(estimate.estimate.pricing).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", model: "gpt-5.5", pricingStatus: "priced" }),
      expect.objectContaining({ provider: "anthropic", model: "claude-opus-4-8", pricingStatus: "priced" }),
    ]));
  });

  it("coverage-test APIs bind start to the current estimate hash, stream masked events, and expose run-scoped receipt", async () => {
    const rawProviderKey = ["s", "k", "-openai-coverage-dashboard-secret"].join("");
    const rawBenchKey = ["i", "b", "l", "_coverage_dashboard_secret"].join("");
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const app = createBenchApp({
      config: { benchKey: rawBenchKey, openaiApiKey: rawProviderKey },
      store,
      env: {},
      coverageTest: { suite, baseline },
      providerFetch: mockCoverageProviderFetch(providerCalls),
      log: () => undefined,
    });

    const options = await (await app.request("/api/coverage-test/options")).json() as {
      runnable: boolean;
      defaults: { selectedModels: readonly { provider: string; model: string }[]; generator: string };
    };
    expect(options.runnable).toBe(true);
    expect(options.defaults.selectedModels).toMatchObject([{
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
    }]);

    const estimate = await (await app.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
        generator: "built-in",
        spendCapUsd: 1,
      }),
    })).json() as {
      consentHash: string;
      consentToken: string;
      estimate: {
        estimateHash: string;
        estimatedUsd: number;
        estimatedTokensByCategory: Record<string, number>;
        spendCapUsd: number;
      };
    };
    expect(estimate.consentHash).toMatch(/^sha256:/);
    expect(estimate.consentToken).toBe(estimate.consentHash);
    expect(estimate.estimate.estimateHash).toBe(estimate.consentHash);
    expect(estimate.estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.estimate.estimatedTokensByCategory.input).toBeGreaterThan(0);
    expect(providerCalls).toHaveLength(0);

    const badStart = await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
        generator: "built-in",
        spendCapUsd: 2,
        consentHash: estimate.consentHash,
      }),
    });
    expect(badStart.status).toBe(409);
    const badStartPayload = await badStart.json();
    expect(providerCalls).toHaveLength(0);

    const start = await (await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
        generator: "built-in",
        spendCapUsd: 1,
        consentHash: estimate.consentHash,
      }),
    })).json() as { run: { runId: string; status: string; progress: { totalSurfaceCount: number } } };
    expect(start.run.runId).toMatch(/^speedtest_/);
    expect(["queued", "running", "completed"]).toContain(start.run.status);
    expect(start.run.progress.totalSurfaceCount).toBe(12);

    const completed = await waitForRun(app, start.run.runId);
    expect(completed.status).toBe("completed");
    expect(completed.progress.measuredCalls).toBeGreaterThan(0);
    expect(completed.progress.surfacesWatchedCount).toBeGreaterThan(0);
    expect(completed.progress.totalSurfaceCount).toBe(12);
    expect(completed.progress.actualSpendUsd).toBeGreaterThan(0);
    expect(completed.progress.tasks.some((task) => task.status === "completed")).toBe(true);

    const receipt = await (await app.request(`/api/coverage-test/runs/${start.run.runId}/receipt`)).json() as {
      compactText: string;
      bundle: { schemaVersion: string; coverage: { runId: string; watchedCount: number; totalSurfaceCount: number } };
    };
    expect(receipt.bundle.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(receipt.bundle.coverage.runId).toBe(start.run.runId);
    expect(receipt.compactText).toContain("surfaces watched");
    expect(receipt.bundle.coverage.watchedCount).toBeGreaterThan(0);
    expect(receipt.bundle.coverage.totalSurfaceCount).toBeGreaterThan(0);

    const eventText = await (await app.request(`/api/coverage-test/runs/${start.run.runId}/events`)).text();
    expect(eventText).toContain("event: snapshot");
    expect(eventText).toContain(start.run.runId);

    const abortAfterComplete = await (await app.request(`/api/coverage-test/runs/${start.run.runId}/abort`, {
      method: "POST",
    })).json() as { status: string };
    expect(abortAfterComplete.status).toBe("completed");

    const noLeakPayload = JSON.stringify({
      options,
      estimate,
      badStart: badStartPayload,
      start,
      completed,
      receipt,
      abortAfterComplete,
    }) + eventText;
    expect(noLeakPayload).not.toContain(rawProviderKey);
    expect(noLeakPayload).not.toContain(rawBenchKey);
    expect(noLeakPayload).not.toContain("coverage_dashboard_secret");

    const summary = await (await app.request(`/api/summary?runId=${start.run.runId}`)).json() as {
      summary: { measuredCalls: number; coverage: { runId: string } };
    };
    expect(summary.summary.coverage.runId).toBe(start.run.runId);
    expect(summary.summary.measuredCalls).toBe(completed.progress.measuredCalls);
  });

  it("coverage-test abort drains in-flight provider calls before another start is allowed", async () => {
    const rawProviderKey = ["s", "k", "-openai-coverage-drain-secret"].join("");
    const rawBenchKey = ["i", "b", "l", "_coverage_drain_secret"].join("");
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const store = new MemoryStore();
    const providerCalls: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const firstProviderResponse = deferred<Response>();
    let inFlight = 0;
    const app = createBenchApp({
      config: { benchKey: rawBenchKey, openaiApiKey: rawProviderKey },
      store,
      env: {},
      coverageTest: { suite, baseline },
      providerFetch: async (url, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        providerCalls.push({ url, body });
        inFlight += 1;
        try {
          if (providerCalls.length === 1) return await firstProviderResponse.promise;
          return coverageProviderResponse(url, body);
        } finally {
          inFlight -= 1;
        }
      },
      log: () => undefined,
    });
    const startBody = {
      selectedModels: [{ provider: "openai", model: "gpt-4o-mini-2024-07-18" }],
      generator: "built-in",
      spendCapUsd: 1,
    };
    const estimate = await (await app.request("/api/coverage-test/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(startBody),
    })).json() as { consentHash: string };

    const start = await (await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...startBody, consentHash: estimate.consentHash }),
    })).json() as { run: { runId: string } };
    await waitUntil(() => inFlight === 1, "provider call did not enter flight");

    const abort = await (await app.request(`/api/coverage-test/runs/${start.run.runId}/abort`, {
      method: "POST",
    })).json() as { status: string; receiptReady: boolean; drained: boolean };
    expect(abort).toMatchObject({
      status: "draining",
      receiptReady: false,
      drained: false,
    });

    const inFlightAtSecondStart = inFlight;
    const secondStart = await app.request("/api/coverage-test/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...startBody, consentHash: estimate.consentHash }),
    });
    expect(secondStart.status).toBe(409);
    await expect(secondStart.json()).resolves.toMatchObject({ error: "run_already_active" });
    expect(inFlightAtSecondStart).toBe(1);
    expect(providerCalls).toHaveLength(1);

    const firstCall = providerCalls[0];
    if (!firstCall) throw new Error("expected first provider call");
    firstProviderResponse.resolve(coverageProviderResponse(firstCall.url, firstCall.body));
    const killed = await waitForRun(app, start.run.runId);
    expect(killed).toMatchObject({
      status: "killed",
      statusReason: "aborted_by_user",
      receiptReady: true,
      drained: true,
    });
    expect(inFlight).toBe(0);
    const receipt = await (await app.request(`/api/coverage-test/runs/${start.run.runId}/receipt`)).json() as {
      bundle: { run: { status: string; statusReason?: string } };
    };
    expect(receipt.bundle.run).toMatchObject({
      status: "killed",
      statusReason: "aborted_by_user",
    });
  });

  it("dashboard-runmeta-scope: scopes mixed stores by run ID unless all-store is explicit", async () => {
    const store = new MemoryStore([
      storedCall({ requestId: "req-legacy", model: "legacy-model", capturedAt: "2026-07-02T00:00:00.000Z" }),
      storedCall({
        requestId: "req-run-a",
        model: "run-a-model",
        capturedAt: "2026-07-02T00:01:00.000Z",
        runId: "run-a",
      }),
      storedCall({
        requestId: "req-run-b",
        model: "run-b-model",
        capturedAt: "2026-07-02T00:02:00.000Z",
        runId: "run-b",
      }),
    ]);
    const app = createBenchApp({
      config: { benchKey: "local_bench_key_zero" },
      store,
      env: {},
      log: () => undefined,
    });

    const defaultSummary = await (await app.request("/api/summary")).json() as {
      summary: { measuredCalls: number; coverage: { runId: string } };
    };
    expect(defaultSummary.summary.measuredCalls).toBe(1);
    expect(defaultSummary.summary.coverage.runId).toBe("run-b");

    const runSummary = await (await app.request("/api/summary?runId=run-a")).json() as {
      summary: { measuredCalls: number; coverage: { runId: string } };
    };
    expect(runSummary.summary.measuredCalls).toBe(1);
    expect(runSummary.summary.coverage.runId).toBe("run-a");

    const receipt = await (await app.request("/api/receipt?runId=run-a")).json() as {
      bundle: { totals: { measuredCalls: number }; coverage: { runId: string } };
    };
    expect(receipt.bundle.totals.measuredCalls).toBe(1);
    expect(receipt.bundle.coverage.runId).toBe("run-a");

    const calls = await (await app.request("/api/calls?runId=run-a&limit=5")).json() as {
      calls: readonly { model: string }[];
    };
    expect(calls.calls.map((call) => call.model)).toEqual(["run-a-model"]);

    const allSummary = await (await app.request("/api/summary?scope=all")).json() as {
      summary: { measuredCalls: number; coverage: { runId: string } };
    };
    expect(allSummary.summary.measuredCalls).toBe(3);
    expect(allSummary.summary.coverage.runId).toBe("local-summary");
  });
});

async function waitForRun(app: ReturnType<typeof createBenchApp>, runId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await app.request(`/api/coverage-test/runs/${runId}`);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      status: string;
      progress: {
        measuredCalls: number;
        actualSpendUsd: number;
        surfacesWatchedCount: number;
        totalSurfaceCount: number;
        tasks: readonly { status: string }[];
      };
      statusReason?: string;
      receiptReady: boolean;
      fallbackOffer?: {
        generator: "built-in";
        label: string;
        packageName: string;
        packageVersion: string;
        reason: string;
      };
      drained: boolean;
    };
    if (["completed", "failed", "killed", "aborted_before_calls"].includes(payload.status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("coverage-test run did not complete");
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function storedCall(input: {
  readonly requestId?: string;
  readonly model?: string;
  readonly capturedAt?: string;
  readonly runId?: string;
  readonly generation?: Record<string, unknown>;
  readonly responseContent?: string;
  readonly usage?: CanonicalEventAny["usage"];
} = {}): StoredBenchEvent {
  const startedAt = input.capturedAt ?? "2026-07-02T00:00:00.000Z";
  const endedAt = input.capturedAt ?? "2026-07-02T00:00:01.000Z";
  const model = input.model ?? "gpt-4o-mini";
  const event: CanonicalEventAny = {
    request: {
      tenantId: "local",
      provider: "openai",
      model,
      requestId: input.requestId ?? "req-local",
      expectCompletion: true,
      ...(input.generation ? { generation: input.generation } : {}),
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: input.responseContent ?? "ok",
    },
    usage: input.usage ?? {
      input: 8,
      output: 2,
    },
    timing: {
      startedAt,
      endedAt,
      latencyMs: 1000,
    },
    meta: {
      attemptIndex: 0,
      schemaVersion: "v1",
    },
  };
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: endedAt,
    ...(input.runId ? { runId: input.runId } : {}),
    event,
  };
}

function bootstrapBaselineForSuite(suite: Awaited<ReturnType<typeof loadCoverageSuiteManifest>>) {
  const complete = completeBaselineForSuite(suite);
  return {
    ...complete,
    provenance: {
      ...complete.provenance,
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 0])),
    },
    tasks: complete.tasks.map((task) => ({
      ...task,
      provenance: "bootstrap_required",
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    })),
  };
}

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
      providerModelsMeasured: ["openai:gpt-4o-mini-2024-07-18"],
      sampleCountByTask: Object.fromEntries(suite.tasks.map((task) => [task.taskId, 1])),
      notes: "dashboard test fixture",
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

function mockCoverageProviderFetch(
  calls: { readonly url: string; readonly body: Record<string, unknown> }[],
): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return coverageProviderResponse(url, body);
  };
}

function coverageProviderResponse(url: string, body: Record<string, unknown>): Response {
  if (url.endsWith("/responses")) return openAiResponsesResponse(body);
  if (body.stream === true) return openAiStreamResponse(body);
  return openAiChatResponse(body);
}

function anthropicStreamResponse(): Response {
  const lines = [
    ["message_start", {
      type: "message_start",
      message: {
        id: "msg-stream",
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    }],
    ["content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "streamed answer" },
    }],
    ["message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 7 },
    }],
    ["message_stop", { type: "message_stop" }],
  ] as const;
  const body = lines.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n`
  ).join("\n");
  return new Response(`${body}\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "anthropic-stream-request" },
  });
}

function openAiChatResponse(body: Record<string, unknown>): Response {
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
  return new Response(JSON.stringify({
    id: "chatcmpl-suite",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    choices: [{ finish_reason: hasTools ? "tool_calls" : "stop", message }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      prompt_tokens_details: body.metadata ? { cached_tokens: 15 } : undefined,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-chat" },
  });
}

function openAiResponsesResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "resp-suite",
    object: "response",
    created_at: 1782993603,
    status: "completed",
    model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
    output_text: "{\"title\":\"checkpoint\",\"status\":\"on track\",\"nextAction\":\"ship\"}",
    output: [{
      id: "msg-suite",
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
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "provider-responses" },
  });
}

function openAiStreamResponse(body: Record<string, unknown>): Response {
  const model = String(body.model ?? "gpt-4o-mini-2024-07-18");
  const text = [
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      model,
      choices: [{ delta: { content: "review " }, finish_reason: null }],
    })}`,
    "",
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
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
    headers: { "content-type": "text/event-stream", "x-request-id": "provider-stream" },
  });
}

function responseContentForBody(body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (serialized.includes("invoice reconciliation")) return "Billing Reliability";
  if (serialized.includes("json_schema")) {
    return "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}";
  }
  return "The maintenance note is ready for review.";
}
