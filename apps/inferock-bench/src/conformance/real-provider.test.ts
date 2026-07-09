import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBenchPaths, type BenchConfig } from "../config.js";
import type { ProviderFetch } from "../proxy.js";
import { buildConformanceEstimate } from "./estimate.js";
import { runAcceptedRealProviderConformance } from "./real-provider.js";

// Built at runtime so the OSS export key-material scan never sees a key-shaped literal.
const leakedTestSecret = ["sk", "test", "secret"].join("-");

describe("real-provider conformance runner", () => {
  it("substitutes unavailable hidden-token models and captures sanitized non-2xx bodies", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-conformance-real-"));
    const calls: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
    const config: BenchConfig = { openaiApiKey: "provider-openai" };
    const estimate = buildConformanceEstimate({
      modules: ["hidden_token"],
      providers: ["openai"],
      spendCapUsd: 1,
      eventTime: "2026-07-08T12:00:00.000Z",
    });

    const result = await runAcceptedRealProviderConformance({
      paths: resolveBenchPaths({ INFEROCK_BENCH_HOME: home }),
      config,
      env: {},
      modules: ["hidden_token"],
      providers: ["openai"],
      estimate,
      eventTime: "2026-07-08T12:00:00.000Z",
      providerFetch: providerFetchWithSubstitutionAndError(calls),
    });

    const ledger = (await readFile(join(result.artifactDir, "ledger.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        probeId: string;
        model: string;
        validationMetadata: string[];
        openability: { reason?: string };
        rawEvidence: { providerErrorBody?: { text?: string }; modelSelection?: { originalModel?: string; selectedModel?: string } };
      });
    const responses = ledger.find((entry) => entry.probeId === "hidden-token-openai-responses-positive-001");
    expect(responses).toBeTruthy();
    expect(responses?.model).toBe("gpt-5.4");
    expect(responses?.validationMetadata).toContain("probe_model_substituted");
    expect(responses?.rawEvidence.modelSelection).toMatchObject({
      originalModel: "gpt-5.4-mini",
      selectedModel: "gpt-5.4",
    });
    expect(responses?.openability.reason).toContain("provider returned HTTP 400");
    expect(responses?.openability.reason).toContain("[REDACTED]");
    expect(responses?.openability.reason).not.toContain(leakedTestSecret);
    expect(responses?.rawEvidence.providerErrorBody?.text).toContain("[REDACTED]");
    expect(responses?.rawEvidence.providerErrorBody?.text).not.toContain(leakedTestSecret);
    expect(await readFile(
      join(result.artifactDir, "raw", "hidden-token-openai-responses-positive-001.provider-error.json"),
      "utf8",
    )).toContain("[REDACTED]");
    expect(calls.some((call) => call.url.endsWith("/models"))).toBe(true);
    expect(calls.some((call) => call.body.model === "gpt-5.4")).toBe(true);
    const chatPositive = calls.find((call) =>
      call.url.endsWith("/chat/completions") && call.body.reasoning_effort === "low"
    );
    expect(chatPositive?.body).toMatchObject({
      model: "gpt-5.4",
      reasoning_effort: "low",
      max_completion_tokens: 1024,
    });
    expect(chatPositive?.body).not.toHaveProperty("reasoning");
  });

  it("sends Anthropic adaptive thinking shape and captures sanitized provider errors", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-conformance-anthropic-"));
    const calls: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
    const config: BenchConfig = { anthropicApiKey: "provider-anthropic" };
    const estimate = buildConformanceEstimate({
      modules: ["hidden_token"],
      providers: ["anthropic"],
      spendCapUsd: 1,
      eventTime: "2026-07-08T12:00:00.000Z",
    });

    const result = await runAcceptedRealProviderConformance({
      paths: resolveBenchPaths({ INFEROCK_BENCH_HOME: home }),
      config,
      env: {},
      modules: ["hidden_token"],
      providers: ["anthropic"],
      estimate,
      eventTime: "2026-07-08T12:00:00.000Z",
      providerFetch: anthropicProviderFetchWithPositiveError(calls),
    });

    const positive = calls.find((call) =>
      call.url.endsWith("/messages") && call.body.model === "claude-sonnet-5"
    );
    expect(positive?.body).toMatchObject({
      model: "claude-sonnet-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      max_tokens: 2048,
    });
    expect(positive?.body.thinking).not.toHaveProperty("budget_tokens");

    const providerError = await readFile(
      join(result.artifactDir, "raw", "hidden-token-anthropic-messages-positive-001.provider-error.json"),
      "utf8",
    );
    expect(providerError).toContain("[REDACTED]");
    expect(providerError).not.toContain(leakedTestSecret);
  });
});

function providerFetchWithSubstitutionAndError(
  calls: Array<{ readonly url: string; readonly body: Record<string, unknown> }>,
): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/responses")) {
      return new Response(JSON.stringify({
        error: {
          message: `model rejected test key ${leakedTestSecret}-1234567890`,
          type: "invalid_request_error",
        },
      }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const reasoningEffort = typeof body.reasoning_effort === "string" ? body.reasoning_effort : "";
    const reasoningTokens = reasoningEffort === "low" ? 4 : 0;
    return new Response(JSON.stringify({
      id: reasoningTokens > 0 ? "chatcmpl-hidden" : "chatcmpl-negative",
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
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function anthropicProviderFetchWithPositiveError(
  calls: Array<{ readonly url: string; readonly body: Record<string, unknown> }>,
): ProviderFetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({
        data: [
          { id: "claude-sonnet-5" },
          { id: "claude-haiku-4-5" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (body.model === "claude-sonnet-5") {
      return new Response(JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: `provider fixture rejected test key ${leakedTestSecret}-1234567890`,
        },
      }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "msg-anthropic-negative",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 1,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
