import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SLA_DEFAULTS } from "@inferock/measure/sla-defaults";
import type { CanonicalEventV2 } from "@inferock/measure/canonical-event";
import { runCli } from "./cli.js";
import type { StoredBenchEvent } from "./storage.js";
import type { ProviderFetch } from "./proxy.js";
import {
  loadCoverageTokenBaselineFromValue,
  resolveCoverageBaselineSourceCommit,
} from "./coverage-suite/baseline.js";
import {
  estimateCoverageSuite,
  resolveCoverageModelPreset,
} from "./coverage-suite/estimate.js";
import { loadCoverageSuiteManifest } from "./coverage-suite/manifest.js";
import { SPEEDTEST_RECEIPT_SCHEMA_VERSION } from "./receipt-schema.js";
import { BENCH_PACKAGE_VERSION } from "./version.js";

const execFileAsync = promisify(execFile);

function fakeOpenAiKey(suffix: string): string {
  return ["sk", suffix].join("-");
}

function fakeAnthropicKey(suffix: string): string {
  return ["sk", `ant-${suffix}`].join("-");
}

function fakeGeminiClassicKey(): string {
  return `AIza${"A".repeat(35)}`;
}

function fakeGeminiExpressKey(): string {
  return `AQ.${"B".repeat(32)}`;
}

describe("cli", () => {
  it("prints help without starting the proxy for top-level help flags", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    await runCli(["--help"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toContain("inferock-bench");
    expect(lines.join("\n")).toContain("receipt --compact");
    expect(lines.join("\n")).toContain("key reveal");
    await expect(readFile(join(home, "config"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("prints version without creating config or starting the proxy", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["--version"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
      providerFetch: async () => {
        throw new Error("provider fetch should not run for --version");
      },
    });

    expect(lines).toEqual([BENCH_PACKAGE_VERSION]);
    await expect(readFile(join(home, "config"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("prints experimental conformance help without creating config", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["conformance", "--help"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
    });

    const output = lines.join("\n");
    expect(output).toContain("conformance --module stream-sse|hidden-token");
    expect(output).toContain("--provider openai|anthropic");
    expect(output).toContain("--fixture-only");
    expect(output).toContain("--spend-cap-usd N");
    expect(output).toContain("--accept-estimate hash");
    expect(output).toContain("--json");
    expect(output).toContain("experimental");
    await expect(readFile(join(home, "config"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("published entry fast-exits --help and --version with no local server side effects", async () => {
    const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
    for (const flag of ["--help", "--version"]) {
      const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-entry-"));
      const result = await execFileAsync(process.execPath, ["--import", "tsx", entry, flag], {
        env: { ...process.env, INFEROCK_BENCH_HOME: home },
        // Hang-guard only: a --help that accidentally boots the server blocks forever and
        // must still fail here. "Fast-exit" is asserted behaviorally (no config written, no
        // server side effects) — a tight wall-clock bound tracks host load and coverage
        // instrumentation, not the contract (tripped 3x locally + 1x CI coverage at 2s).
        timeout: 30_000,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toContain(flag === "--version" ? BENCH_PACKAGE_VERSION : "inferock-bench");
      await expect(readFile(join(home, "config"), "utf8")).rejects.toThrow(/ENOENT/);
    }
  });

  it("reveals only the local ibl_ bench key with a local-only warning", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    const errors: string[] = [];

    await runCli(["key", "reveal"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: fakeOpenAiKey("proj-provider-secret-1234567890"),
      },
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ibl_[0-9a-f]{24}$/);
    expect(lines.join("\n")).not.toContain("provider-secret");
    expect(errors.join("\n")).toContain("local-only");
  });

  it("copies the local ibl_ key without printing it when a clipboard is available", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    const errors: string[] = [];
    let copied = "";

    await runCli(["key", "copy"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
      clipboardWrite: async (text) => {
        copied = text;
        return true;
      },
    });

    expect(copied).toMatch(/^ibl_[0-9a-f]{24}$/);
    expect(lines.join("\n")).toBe("Local inferock-bench key copied to the clipboard.");
    expect(lines.join("\n")).not.toContain(copied);
    expect(errors).toEqual([]);
  });

  it("falls back to printing key copy output in headless clipboard environments", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    const errors: string[] = [];

    await runCli(["key", "copy"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
      clipboardWrite: async () => false,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ibl_[0-9a-f]{24}$/);
    expect(errors.join("\n")).toContain("No clipboard is available");
    expect(errors.join("\n")).toContain("local-only");
  });

  it("sets up a provider key from stdin without echoing the key", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const providerKey = fakeOpenAiKey("proj-cli-stdin-1234567890");
    const lines: string[] = [];

    await runCli(["setup", "openai"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      readStdin: async () => `${providerKey}\n`,
      log: (line) => lines.push(line),
    });

    const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
      openaiApiKey?: string;
      anthropicApiKey?: string;
      geminiApiKey?: string;
    };
    expect(config.openaiApiKey).toBe(providerKey);
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.geminiApiKey).toBeUndefined();
    expect(lines.join("\n")).toContain("OpenAI key saved locally");
    expect(lines.join("\n")).not.toContain(providerKey);
  });

  it("sets up a provider key through hidden interactive entry", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const providerKey = fakeAnthropicKey("cli-hidden-abcdefghij");
    const lines: string[] = [];
    const prompts: string[] = [];

    await runCli(["setup", "anthropic"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: true,
      stdoutIsTty: true,
      secretPrompt: async (question) => {
        prompts.push(question);
        return providerKey;
      },
      prompt: async () => {
        throw new Error("plain prompt must not collect provider keys");
      },
      log: (line) => lines.push(line),
    });

    const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
      anthropicApiKey?: string;
    };
    expect(config.anthropicApiKey).toBe(providerKey);
    expect(prompts).toEqual(["Anthropic API key: "]);
    expect(lines.join("\n")).not.toContain(providerKey);
  });

  it("setup-gemini-key-shapes: accepts classic AIza and AQ-prefixed Gemini keys", async () => {
    for (const providerKey of [fakeGeminiClassicKey(), fakeGeminiExpressKey()]) {
      const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
      const lines: string[] = [];
      const errors: string[] = [];

      await runCli(["setup", "gemini"], {
        env: { INFEROCK_BENCH_HOME: home },
        stdinIsTty: false,
        stdoutIsTty: false,
        readStdin: async () => `${providerKey}\n`,
        log: (line) => lines.push(line),
        error: (line) => errors.push(line),
      });

      const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
        geminiApiKey?: string;
      };
      expect(config.geminiApiKey).toBe(providerKey);
      expect(lines.join("\n")).toContain("Gemini key saved locally");
      expect(lines.join("\n")).not.toContain(providerKey);
      expect(errors).toEqual([]);
    }
  });

  it("setup-gemini-unknown-shape-headless-rejects: refuses unknown shapes from stdin", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const providerKey = "GoogleFutureGeminiKeyShape_1234567890";
    const errors: string[] = [];

    await expect(runCli(["setup", "gemini"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      readStdin: async () => `${providerKey}\n`,
      error: (line) => errors.push(line),
    })).rejects.toThrow(/shape validation/i);

    const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
      geminiApiKey?: string;
    };
    expect(config.geminiApiKey).toBeUndefined();
    expect(errors.join("\n")).toContain("Non-interactive setup only accepts known Gemini key shapes");
  });

  it("setup-gemini-unknown-shape-interactive-confirm: saves Google-plausible unknown shapes after confirmation", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const providerKey = "GoogleFutureGeminiKeyShape_1234567890";
    const errors: string[] = [];
    const prompts: string[] = [];

    await runCli(["setup", "gemini"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: true,
      stdoutIsTty: true,
      secretPrompt: async () => providerKey,
      prompt: async (question) => {
        prompts.push(question);
        return "SAVE";
      },
      log: () => undefined,
      error: (line) => errors.push(line),
    });

    const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
      geminiApiKey?: string;
    };
    expect(config.geminiApiKey).toBe(providerKey);
    expect(errors.join("\n")).toContain("Warning:");
    expect(errors.join("\n")).toContain("not a known AIza or AQ. format");
    expect(prompts).toEqual(["Type SAVE to store this Gemini key: "]);
  });

  it("rejects setup keys with the wrong provider shape before storing them", async () => {
    for (const badKey of [
      "not-a-gemini-key",
      "this-is-not-a-gemini-key-garbage",
      ["sk", "proj", "not", "gemini"].join("-"),
    ]) {
      const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
      const errors: string[] = [];

      await expect(runCli(["setup", "gemini"], {
        env: { INFEROCK_BENCH_HOME: home },
        stdinIsTty: false,
        stdoutIsTty: false,
        readStdin: async () => `${badKey}\n`,
        error: (line) => errors.push(line),
      })).rejects.toThrow(/shape validation/i);

      expect(errors.join("\n")).toContain("Gemini");
      const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
        geminiApiKey?: string;
      };
      expect(config.geminiApiKey).toBeUndefined();
    }
  });

  it("prints status with version, store paths, server state, and masked provider keys", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const openaiKey = fakeOpenAiKey("proj-status-secret-1234567890");
    const anthropicKey = fakeAnthropicKey("status-secret-abcdefghij");
    await writeFile(join(home, "config"), `${JSON.stringify({
      benchKey: "local_bench_key_status",
      openaiApiKey: openaiKey,
    })}\n`, "utf8");
    const lines: string[] = [];
    const probes: string[] = [];

    await runCli(["status"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_ANTHROPIC_API_KEY: anthropicKey,
        INFEROCK_BENCH_PORT: "4321",
      },
      log: (line) => lines.push(line),
      serverProbe: async (url) => {
        probes.push(url);
        return true;
      },
    });

    const output = lines.join("\n");
    expect(output).toContain(`inferock-bench ${BENCH_PACKAGE_VERSION}`);
    expect(output).toContain(`store: ${home}`);
    expect(output).toContain(`config: ${join(home, "config")}`);
    expect(output).toContain("server: running at http://127.0.0.1:4321");
    expect(output).toContain("openai: configured from config (sk-...7890)");
    expect(output).toContain("anthropic: configured from env (sk-...ghij)");
    expect(output).toContain("gemini: not configured");
    expect(output).not.toContain(openaiKey);
    expect(output).not.toContain(anthropicKey);
    expect(probes).toEqual(["http://127.0.0.1:4321/health"]);
  });

  it("does not ask reliability-index opt-in during init setup", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-cli-project-"));
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
      },
    }), "utf8");
    const lines: string[] = [];

    await runCli(["init"], {
      cwd,
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).not.toContain("Reliability index opt-in");
    const config = JSON.parse(await readFile(join(home, "config"), "utf8")) as {
      reliabilityIndex?: unknown;
    };
    expect(config.reliabilityIndex).toBeUndefined();
  });

  it("prints latency assumptions with latency-inclusive report totals", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    await writeFile(join(home, "events.jsonl"), `${JSON.stringify(storedLatencyBreach())}\n`, "utf8");
    const lines: string[] = [];

    await runCli(["report"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
    });

    const output = lines.join("\n");
    expect(output).toContain("money loss so far");
    expect(output).toContain("time lost so far");
    expect(output).toContain("how computed: observed");
    expect(output).toContain(SLA_DEFAULTS.timeValueRate.oneLineWhy);
    expect(output).toContain(SLA_DEFAULTS.latencySegments.interactive_streaming_non_reasoning.oneLineWhy);
  });

  it("receipt --share-card writes a text card without host paths or ANSI when disabled", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["receipt", "--share-card", "--no-color"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
    });

    const output = lines.join("\n");
    expect(output).toContain("spent $0.00 · money loss $0.00 · time loss ~0s");
    expect(output).toContain("github.com/inferock/inferock-bench");
    expect(output).toContain("Share card: receipts/share-card-");
    expect(output).not.toContain(home);
    expect(output).not.toMatch(new RegExp(String.raw`\u001B\[[0-9;]*m`, "u"));
    const receipts = await readdir(join(home, "receipts"));
    const shareCard = receipts.find((entry) => entry.startsWith("share-card-") && entry.endsWith(".txt"));
    expect(shareCard).toBeDefined();
    const written = await readFile(join(home, "receipts", shareCard ?? ""), "utf8");
    expect(written).toContain("github.com/inferock/inferock-bench");
  });

  it("receipt --share-card --output - prints only stdout and writes no card file", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["receipt", "--share-card", "--output", "-", "--no-color"], {
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toContain("github.com/inferock/inferock-bench");
    expect(lines.join("\n")).not.toContain("Share card:");
    await expect(readdir(join(home, "receipts"))).rejects.toThrow(/ENOENT/);
  });

  it("receipt rejects --json with --share-card before writing a card", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const errors: string[] = [];

    await expect(runCli(["receipt", "--json", "--share-card"], {
      env: { INFEROCK_BENCH_HOME: home },
      error: (line) => errors.push(line),
    })).rejects.toThrow();

    expect(errors.join("\n")).toContain("Use either `--json` or `--share-card`, not both.");
    await expect(readdir(join(home, "receipts"))).rejects.toThrow(/ENOENT/);
  });

  it("test command explains offline mode without provider keys and makes zero calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    let providerCalls = 0;

    await runCli(["test"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    });

    expect(lines.join("\n")).toContain("No provider key configured");
    expect(lines.join("\n")).toContain("zero provider calls");
    expect(providerCalls).toBe(0);
  });

  it("test command rejects bare --yes before any baseline or provider call", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli(["test", "--yes"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      error: (line) => errors.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    })).rejects.toThrow(/--accept-estimate <hash>/i);

    expect(errors.join("\n")).toContain("--accept-estimate <hash>");
    expect(providerCalls).toBe(0);
  });

  it("test command surfaces a bootstrap baseline as not measured yet", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const errors: string[] = [];
    // The mechanism is tested against an injected bootstrap fixture: the
    // checked-in baseline is real measured data since 2026-07-04.
    const suite = await loadCoverageSuiteManifest();
    const baselineDir = await mkdtemp(join(tmpdir(), "inferock-bench-bootstrap-"));
    const bootstrapPath = join(baselineDir, "coverage-suite-v1.tokens.json");
    await writeFile(bootstrapPath, JSON.stringify(bootstrapBaselineForSuite(suite)), "utf8");

    await expect(runCli(["test"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      stdinIsTty: true,
      stdoutIsTty: true,
      coverageBaselineUrl: bootstrapPath,
      error: (line) => errors.push(line),
      prompt: async () => "RUN",
    })).rejects.toThrow(/baseline not measured yet/i);

    expect(errors.join("\n")).toContain("baseline not measured yet");
  });

  it("test command aborts at consent with zero provider calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const lines: string[] = [];
    let providerCalls = 0;

    await runCli(["test"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: true,
      stdoutIsTty: true,
      log: (line) => lines.push(line),
      prompt: async () => "NO",
      coverageBaseline: baseline,
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    });

    expect(lines.join("\n")).toContain("estimate hash:");
    expect(lines.join("\n")).toContain("aborted before provider calls");
    expect(providerCalls).toBe(0);
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("conformance real mode requires accepted estimate before provider calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli(["conformance", "--module", "stream-sse", "--provider", "openai"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      eventTime: "2026-07-08T12:00:00.000Z",
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    })).rejects.toThrow(/--accept-estimate <hash>/i);

    const output = lines.join("\n");
    expect(output).toContain("real-provider conformance estimate");
    expect(output).toContain("spend cap: $1.00");
    expect(output).toContain("estimate hash:");
    expect(errors.join("\n")).toContain("--accept-estimate <hash>");
    expect(providerCalls).toBe(0);
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("conformance cap override requires accepted estimate before provider calls", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli([
      "conformance",
      "--module",
      "stream-sse",
      "--provider",
      "openai",
      "--spend-cap-usd",
      "0.50",
    ], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      eventTime: "2026-07-08T12:00:00.000Z",
      error: (line) => errors.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    })).rejects.toThrow(/spend-cap-usd override requires --accept-estimate/i);

    expect(errors.join("\n")).toContain("--spend-cap-usd override requires --accept-estimate");
    expect(providerCalls).toBe(0);
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("conformance accepted real-mode command path executes probes and writes evidence", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const estimateLines: string[] = [];
    const errors: string[] = [];

    await expect(runCli(["conformance", "--providers", "openai"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => estimateLines.push(line),
      error: (line) => errors.push(line),
      providerFetch: async () => {
        throw new Error("provider fetch must not run before estimate acceptance");
      },
    })).rejects.toThrow(/--accept-estimate <hash>/i);

    const estimateHash = /estimate hash: (sha256:[a-f0-9]+)/.exec(estimateLines.join("\n"))?.[1];
    expect(estimateHash).toBeTruthy();

    const lines: string[] = [];
    const providerCalls: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
    await runCli(["conformance", "--providers", "openai", "--accept-estimate", estimateHash as string, "--json"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
      providerFetch: conformanceProviderFetch(providerCalls),
    });

    const result = JSON.parse(lines.join("\n")) as {
      artifactDir: string;
      summary: {
        status: string;
        probeCount: number;
        moduleProviders: Array<{ module: string; provider: string; probeCount: number }>;
      };
    };
    const probeCalls = providerCalls.filter((call) => !call.url.endsWith("/models"));
    const preflightCalls = providerCalls.filter((call) => call.url.endsWith("/models"));
    expect(probeCalls).toHaveLength(5);
    expect(preflightCalls.length).toBeGreaterThan(0);
    expect(result.summary.status).toBe("watched_clean");
    expect(result.summary.probeCount).toBe(5);
    expect(result.summary.moduleProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: "stream_sse", provider: "openai", probeCount: 2 }),
      expect.objectContaining({ module: "hidden_token", provider: "openai", probeCount: 3 }),
    ]));

    const ledger = await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8");
    const ledgerLines = ledger.trim().split("\n");
    expect(ledgerLines).toHaveLength(5);
    expect(ledger).toContain("\"mode\":\"real_provider\"");
    expect(ledger).toContain("\"conformanceStatus\":\"conformant\"");
    expect(ledger).toContain("spend_accounted_preflight_estimate");
    expect(await readFile(join(result.artifactDir, "summary.json"), "utf8")).toContain("\"probeCount\": 5");
    const rawFiles = await readdir(join(result.artifactDir, "raw"));
    expect(rawFiles.filter((file) => file.endsWith(".sse.ndjson")).length).toBe(2);
    expect(rawFiles.filter((file) => file.endsWith(".usage.json")).length).toBe(5);
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
    await expect(readdir(join(home, "receipts"))).rejects.toThrow(/ENOENT/);
  });

  it("conformance fixture-only does not read local provider config or call providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    await writeFile(join(home, "config"), "{not-json-with-provider-secret", "utf8");
    const lines: string[] = [];
    let providerCalls = 0;

    await runCli(["conformance", "--fixture-only", "--module", "stream-sse", "--json"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      eventTime: "2026-07-08T12:00:00.000Z",
      log: (line) => lines.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    });

    const result = JSON.parse(lines.join("\n")) as {
      runId: string;
      artifactDir: string;
      summary: { status: string; probeCount: number; signalCount: number; dashboardEligible: boolean };
    };
    expect(result.runId).toMatch(/^conformance_20260708T120000Z_/);
    expect(result.artifactDir).toContain(join(home, "validation", "real-provider-conformance"));
    expect(result.summary).toMatchObject({
      status: "signal",
      probeCount: 4,
      signalCount: 4,
      dashboardEligible: false,
    });
    expect(providerCalls).toBe(0);
    expect(await readFile(join(home, "config"), "utf8")).toBe("{not-json-with-provider-secret");
    expect(await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8")).toContain("\"mode\":\"fixture_control\"");
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("conformance fixture-only dry run succeeds without provider keys", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["conformance", "--fixture-only", "--json"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      eventTime: "2026-07-08T12:00:00.000Z",
      log: (line) => lines.push(line),
      providerFetch: async () => {
        throw new Error("fixture-only conformance must not call providers");
      },
    });

    const result = JSON.parse(lines.join("\n")) as {
      artifactDir: string;
      summary: { status: string; probeCount: number; signalCount: number };
    };
    expect(result.summary).toMatchObject({
      status: "signal",
      probeCount: 9,
      signalCount: 4,
    });
    expect(await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8")).toContain("synthetic_fixture_fault");
    expect(await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8")).toContain("\"module\":\"hidden_token\"");
    await expect(readFile(join(home, "config"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("conformance hidden-token fixture-only produces probes and ledger through the CLI path", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const lines: string[] = [];

    await runCli(["conformance", "--fixture-only", "--module", "hidden-token", "--providers", "both", "--json"], {
      env: { INFEROCK_BENCH_HOME: home },
      stdinIsTty: false,
      stdoutIsTty: false,
      eventTime: "2026-07-08T12:00:00.000Z",
      log: (line) => lines.push(line),
      providerFetch: async () => {
        throw new Error("hidden-token fixture-only conformance must not call providers");
      },
    });

    const result = JSON.parse(lines.join("\n")) as {
      artifactDir: string;
      summary: {
        status: string;
        probeCount: number;
        moduleProviders: Array<{ module: string; provider: string; probeCount: number }>;
      };
    };
    expect(result.summary).toMatchObject({
      status: "watched_clean",
      probeCount: 5,
    });
    expect(result.summary.moduleProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: "hidden_token", provider: "openai", probeCount: 3 }),
      expect.objectContaining({ module: "hidden_token", provider: "anthropic", probeCount: 2 }),
    ]));
    const ledger = await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8");
    expect(ledger).toContain("\"mode\":\"fixture_control\"");
    expect(ledger).toContain("\"module\":\"hidden_token\"");
    expect(ledger).toContain("synthetic_fixture_control");
    const rawFiles = await readdir(join(result.artifactDir, "raw"));
    expect(rawFiles.filter((file) => file.endsWith(".usage.json"))).toHaveLength(5);
    await expect(readFile(join(home, "events.jsonl"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("test command accepts the bound estimate hash non-interactively and emits JSON receipt", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = resolveCoverageModelPreset({
      configuredProviders: ["openai"],
      suite,
      baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const firstEstimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 1,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: firstEstimate.estimatedUsd * suite.estimateDefaults.defaultSpendCapMultiplier,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const lines: string[] = [];

    await runCli(["test", "--accept-estimate", estimate.estimateHash, "--json"], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
      coverageBaseline: baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
      providerFetch: minimalProviderFetch(),
    });

    const receipt = JSON.parse(lines.join("\n")) as {
      schemaVersion: string;
      run: { status: string };
      consent: { estimate: { estimateHash: string } };
      coverage: { runId: string; totalSurfaceCount: number };
    };
    expect(receipt.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(receipt.run.status).toBe("completed");
    expect(receipt.consent.estimate.estimateHash).toBe(estimate.estimateHash);
    expect(receipt.coverage.runId).toMatch(/^speedtest_/);
    expect(receipt.coverage.totalSurfaceCount).toBeGreaterThan(0);
  });

  it("test command exits loudly after writing a partial receipt when the spend cap is reached", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = resolveCoverageModelPreset({
      configuredProviders: ["openai"],
      suite,
      baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "built-in",
      spendCapUsd: 0.000001,
      eventTime: "2026-07-04T00:00:00.000Z",
    });
    const lines: string[] = [];
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli([
      "test",
      "--spend-cap-usd",
      "0.000001",
      "--accept-estimate",
      estimate.estimateHash,
      "--json",
    ], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
      coverageBaseline: baseline,
      eventTime: "2026-07-04T00:00:00.000Z",
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    })).rejects.toThrow("spend cap reached — run incomplete");

    const receipt = JSON.parse(lines.join("\n")) as {
      run: { status: string; statusReason: string };
      totals: { measuredCalls: number };
    };
    expect(receipt.run).toMatchObject({
      status: "killed",
      statusReason: "spend cap reached — run incomplete",
    });
    expect(receipt.totals.measuredCalls).toBe(0);
    expect(errors.join("\n")).toContain("spend cap reached — run incomplete");
    expect(providerCalls).toBe(0);
  });

  it("test command requires explicit agent install consent before auto-provisioning", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = resolveCoverageModelPreset({
      configuredProviders: ["openai"],
      suite,
      baseline,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const firstEstimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: firstEstimate.estimatedUsdBand.high,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli(["test", "--generator", "agent", "--accept-estimate", estimate.estimateHash], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      coverageBaseline: baseline,
      eventTime: "2026-07-05T00:00:00.000Z",
      log: () => undefined,
      error: (line) => errors.push(line),
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
    })).rejects.toThrow(/--accept-agent-install <hash>/i);

    expect(errors.join("\n")).toContain("--accept-agent-install <hash>");
    expect(providerCalls).toBe(0);
  });

  it("test command labels user-supplied agent receipts with traffic mix", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const suite = await loadCoverageSuiteManifest();
    const baseline = loadCoverageTokenBaselineFromValue(completeBaselineForSuite(suite), suite);
    const selectedModels = resolveCoverageModelPreset({
      configuredProviders: ["openai"],
      suite,
      baseline,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const firstEstimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: 1,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const estimate = estimateCoverageSuite({
      selectedModels,
      suite,
      baseline,
      generator: "agent",
      spendCapUsd: firstEstimate.estimatedUsdBand.high,
      eventTime: "2026-07-05T00:00:00.000Z",
    });
    const lines: string[] = [];

    await runCli([
      "test",
      "--generator",
      "agent",
      "--agent-cmd",
      "/tmp/mock-agent",
      "--accept-estimate",
      estimate.estimateHash,
      "--json",
    ], {
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
      },
      stdinIsTty: false,
      stdoutIsTty: false,
      log: (line) => lines.push(line),
      coverageBaseline: baseline,
      eventTime: "2026-07-05T00:00:00.000Z",
      providerFetch: minimalProviderFetch(),
      agentProcessRunner: async (launch) => {
        expect(launch.cwd).toContain("workspace");
        expect(JSON.stringify(launch.env)).not.toContain("provider-openai");
        return { exitCode: 0, stdout: "ok", version: "mock-agent-1.0.0" };
      },
    });

    const receipt = JSON.parse(lines.join("\n")) as {
      schemaVersion: string;
      run: { generator: string };
      agent: { name: string; version: string; source: string };
      trafficMix: { organicAgentTasks: number; harnessPreconditionTasks: number };
    };
    expect(receipt.schemaVersion).toBe(SPEEDTEST_RECEIPT_SCHEMA_VERSION);
    expect(receipt.run.generator).toBe("agent");
    expect(receipt.agent).toEqual({
      name: "opencode-ai",
      version: "mock-agent-1.0.0",
      source: "user-supplied",
    });
    expect(receipt.trafficMix.organicAgentTasks).toBe(6);
    expect(receipt.trafficMix.harnessPreconditionTasks).toBe(suite.tasks.length);
  });

  it("test command record-baseline uses a conservative consent estimate and writes measured artifact", async () => {
    const cwd = await createGitRepo();
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const outputDir = await mkdtemp(join(tmpdir(), "inferock-bench-cli-baseline-"));
    const outputPath = join(outputDir, "coverage-suite-v1.tokens.json");
    const sourceCommit = await resolveCoverageBaselineSourceCommit(cwd);
    const lines: string[] = [];

    await runCli(["test", "--record-baseline", "--baseline-output", outputPath], {
      cwd,
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      stdinIsTty: true,
      stdoutIsTty: true,
      log: (line) => lines.push(line),
      prompt: async () => "RUN",
      providerFetch: minimalProviderFetch(),
      eventTime: "2026-07-04T00:00:00.000Z",
    });

    const output = lines.join("\n");
    expect(output).toContain("temporary conservative per-call bound");
    expect(output).toContain("Measured token baseline written");
    const baseline = JSON.parse(await readFile(outputPath, "utf8")) as {
      provenance: { sourceCommit: string };
    };
    expect(baseline.provenance.sourceCommit).toBe(sourceCommit);
    expect(await readFile(outputPath, "utf8")).toContain("\"covrun_measured\"");
    // Spawns a real git repo + CLI process; 5.3s under local coverage instrumentation,
    // deterministically past the 10s default on the shared CI runner — budget = measured × CI factor + headroom.
  }, 30_000);

  it("test command record-baseline fails without git provenance before provider calls or writes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-cli-no-git-"));
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-cli-home-"));
    const outputDir = await mkdtemp(join(tmpdir(), "inferock-bench-cli-baseline-"));
    const outputPath = join(outputDir, "coverage-suite-v1.tokens.json");
    const errors: string[] = [];
    let providerCalls = 0;

    await expect(runCli(["test", "--record-baseline", "--baseline-output", outputPath], {
      cwd,
      env: {
        INFEROCK_BENCH_HOME: home,
        INFEROCK_BENCH_OPENAI_API_KEY: "provider-openai",
        INFEROCK_BENCH_ANTHROPIC_API_KEY: "provider-anthropic",
      },
      stdinIsTty: true,
      stdoutIsTty: true,
      error: (line) => errors.push(line),
      prompt: async () => {
        throw new Error("prompt should not run without git provenance");
      },
      providerFetch: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
      eventTime: "2026-07-04T00:00:00.000Z",
    })).rejects.toThrow(/without git source commit/i);

    expect(errors.join("\n")).toContain("without git source commit");
    expect(providerCalls).toBe(0);
    await expect(readFile(outputPath, "utf8")).rejects.toThrow(/ENOENT/);
  });
});

function storedLatencyBreach(): StoredBenchEvent {
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: "2026-06-14T12:01:27.700Z",
    event: {
      schemaVersion: "v2",
      request: {
        tenantId: "tenant-bench",
        provider: "openai",
        requestId: "req-latency-cli",
        requestedModel: "gpt-4o-mini",
        model: "gpt-4o-mini",
        attemptIndex: 0,
        expectCompletion: true,
        route: "chat.completions",
        workloadClass: "interactive",
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "completed",
        servedModel: "gpt-4o-mini",
      },
      usage: {
        input: 100,
        output: 0,
        cache: { read: 0, creation: 0 },
        categories: [
          { category: "input", tokens: 100, provider: "openai" },
          { category: "output", tokens: 0, provider: "openai" },
        ],
        usageSource: "provider",
      },
      timing: {
        startedAt: "2026-06-14T12:00:00.000Z",
        endedAt: "2026-06-14T12:01:27.700Z",
        latencyMs: 87_700,
        chunkCount: 0,
        terminalStatus: "complete",
      },
      attempts: [{
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-4o-mini",
        status: "success",
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:01:27.700Z",
          latencyMs: 87_700,
        },
        finalSelected: true,
      }],
    } satisfies CanonicalEventV2,
  };
}

function minimalProviderFetch(): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/messages")) {
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      return new Response(JSON.stringify({
        id: "msg_cli",
        type: "message",
        role: "assistant",
        model: String(body.model ?? "claude-haiku-4-5-20251001"),
        content: hasTools
          ? [{
              type: "tool_use",
              id: "toolu_cli",
              name: "record_plan",
              input: {
                component: "proxy",
                riskLevel: "low",
                checks: ["one", "two"],
              },
            }]
          : [{ type: "text", text: responseContentForBody(body) }],
        stop_reason: hasTools ? "tool_use" : "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/responses")) {
      return new Response(JSON.stringify({
        id: "resp-cli",
        object: "response",
        created_at: 1782993603,
        status: "completed",
        model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
        output_text: "{\"title\":\"checkpoint\",\"status\":\"done\",\"nextAction\":\"review\"}",
        output: [{
          id: "msg-cli",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "{\"title\":\"checkpoint\",\"status\":\"done\",\"nextAction\":\"review\"}",
            annotations: [],
          }],
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (body.stream === true) {
      const model = String(body.model ?? "gpt-4o-mini-2024-07-18");
      return new Response([
        `data: ${JSON.stringify({ id: "chatcmpl-cli-stream", model, choices: [{ delta: { content: "ok" }, finish_reason: null }] })}`,
        "",
        `data: ${JSON.stringify({ id: "chatcmpl-cli-stream", model, choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify({
      id: "chatcmpl-cli",
      model: String(body.model ?? "gpt-4o-mini-2024-07-18"),
      choices: [{
        finish_reason: Array.isArray(body.tools) ? "tool_calls" : "stop",
        message: Array.isArray(body.tools)
          ? {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_cli",
                type: "function",
                function: {
                  name: "record_plan",
                  arguments: JSON.stringify({
                    component: "proxy",
                    riskLevel: "low",
                    checks: ["one", "two"],
                  }),
                },
              }],
            }
          : { role: "assistant", content: responseContentForBody(body) },
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: body.metadata ? { cached_tokens: 2 } : undefined,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function conformanceProviderFetch(
  calls: Array<{ readonly url: string; readonly body: Record<string, unknown> }>,
): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-5.4-mini" },
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/responses") && body.stream === true) {
      return new Response([
        "event: response.created",
        `data: ${JSON.stringify({ id: "resp-cli-stream", status: "in_progress" })}`,
        "",
        "event: response.output_text.delta",
        `data: ${JSON.stringify({ id: "resp-cli-stream", delta: "ok" })}`,
        "",
        "event: response.completed",
        `data: ${JSON.stringify({
          response: {
            id: "resp-cli-stream",
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        })}`,
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-openai-responses-stream" },
      });
    }
    if (url.endsWith("/responses")) {
      return new Response(JSON.stringify({
        id: "resp-cli-hidden",
        status: "completed",
        model: String(body.model ?? "gpt-5-mini"),
        output_text: "ok",
        output: [{
          type: "message",
          status: "completed",
          content: [{ type: "output_text", text: "ok" }],
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          output_tokens_details: { reasoning_tokens: 4 },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-openai-responses-hidden" },
      });
    }
    if (body.stream === true) {
      return new Response([
        `data: ${JSON.stringify({
          id: "chatcmpl-cli-stream",
          model: String(body.model ?? "gpt-5-mini"),
          choices: [{ delta: { content: "ok" }, finish_reason: null }],
        })}`,
        "",
        `data: ${JSON.stringify({
          id: "chatcmpl-cli-stream",
          model: String(body.model ?? "gpt-5-mini"),
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-openai-chat-stream" },
      });
    }
    const reasoningEffort = typeof body.reasoning_effort === "string" ? body.reasoning_effort : "";
    const reasoningTokens = reasoningEffort === "low" ? 4 : 0;
    return new Response(JSON.stringify({
      id: reasoningTokens > 0 ? "chatcmpl-cli-hidden" : "chatcmpl-cli-negative",
      model: String(body.model ?? "gpt-5-mini"),
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "ok" },
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: reasoningTokens > 0 ? 5 : 1,
        total_tokens: reasoningTokens > 0 ? 15 : 11,
        ...(reasoningTokens > 0
          ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } }
          : {}),
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-openai-chat-hidden" },
    });
  };
}

function responseContentForBody(body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  if (serialized.includes("invoice reconciliation")) return "Billing Reliability";
  if (serialized.includes("deployment checks")) return "1. Check migrations\n2. Check rollback\n3. Check metrics";
  if (serialized.includes("json_schema")) {
    return "{\"serviceName\":\"gateway\",\"environment\":\"dev\",\"owner\":\"platform\",\"featureFlags\":[\"receipts\"]}";
  }
  return "done";
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
      notes: "test fixture",
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

async function createGitRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-cli-git-"));
  await execFileAsync("git", ["init", "-q"], { cwd });
  await execFileAsync("git", ["config", "user.email", "ci@example.test"], { cwd });
  await execFileAsync("git", ["config", "user.name", "CI Fixture"], { cwd });
  await writeFile(join(cwd, "README.md"), "fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-q", "-m", "fixture"], { cwd });
  return cwd;
}
