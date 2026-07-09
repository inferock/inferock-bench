import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptedBenchKeysFromConfig,
  benchKeyFromConfig,
  ensureGeneratedBenchKey,
  maskSecret,
  readBenchConfig,
  resolveBenchPaths,
} from "./config.js";
import { createBenchApp } from "./proxy.js";
import type { EventStore, StoredBenchEvent } from "./storage.js";

class MemoryStore implements EventStore {
  async append(_record: StoredBenchEvent): Promise<void> {}

  async readAll(): Promise<StoredBenchEvent[]> {
    return [];
  }
}

describe("local bench config", () => {
  it("masks local and provider keys without exposing usable prefixes", () => {
    const benchKey = ["i", "b", "l", "_"].join("") + "1234567890abcdef12345678";
    const providerKey = ["s", "k", "-", "proj", "-", "secret", "-", "1234567890"].join("");
    const shortProviderKey = ["s", "k", "-", "a"].join("");
    const shortBenchKey = ["i", "b", "l", "_", "a"].join("");

    expectMaskedSecret("", "***");
    expectMaskedSecret("a", "***");
    expectMaskedSecret("abcd", "***");
    expectMaskedSecret(["i", "b", "l", "_"].join(""), "***");
    expectMaskedSecret(["s", "k", "-"].join(""), "***");
    expectMaskedSecret(shortProviderKey, "sk-***");
    expectMaskedSecret(shortBenchKey, "ibl_***");
    expectMaskedSecret("abcde", "***");
    expectMaskedSecret("abcdefghijk", "***");
    expect(maskSecret(benchKey)).toBe("ibl_...5678");
    expect(maskSecret(providerKey)).toBe("sk-...7890");
    expect(maskSecret(providerKey)).not.toContain("proj");
    expect(maskSecret("provider-local-abcdef")).toBe("...cdef");
    expectMaskedSecret(benchKey, "ibl_...5678");
    expectMaskedSecret(providerKey, "sk-...7890");
    expectMaskedSecret("provider-local-abcdef", "...cdef");
  });

  it("generates and persists a stable ibl_ local key with 0600 permissions", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-config-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });

    const config = await ensureGeneratedBenchKey({ paths, config: {} });

    expect(config.benchKey).toMatch(/^ibl_[0-9a-f]{24}$/);
    await expect(readBenchConfig(paths)).resolves.toEqual(config);
    expect(JSON.parse(await readFile(paths.configFile, "utf8"))).toMatchObject({
      benchKey: config.benchKey,
    });
    expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);

    await expect(ensureGeneratedBenchKey({ paths, config })).resolves.toEqual(config);
    expect(benchKeyFromConfig(config, { INFEROCK_BENCH_KEY: "local_bench_key_override" })).toBe("local_bench_key_override");
    expect(acceptedBenchKeysFromConfig(config, { INFEROCK_BENCH_KEY: "local_bench_key_override" })).toEqual([
      config.benchKey,
      "local_bench_key_override",
    ]);
  });

  it("parses coverage test charge and drift replay config", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-coverage-config-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    await writeFile(paths.configFile, `${JSON.stringify({
      coverageTest: {
        chargeObservationFile: "/tmp/provider-charges.jsonl",
        driftReplayContract: {
          contractId: "suite.single-window",
          matcher: "exact",
          repeatGroupId: "suite-repeat",
          threshold: 0,
        },
      },
    })}\n`, "utf8");

    await expect(readBenchConfig(paths)).resolves.toMatchObject({
      coverageTest: {
        chargeObservationFile: "/tmp/provider-charges.jsonl",
        driftReplayContract: {
          contractId: "suite.single-window",
          matcher: "exact",
          repeatGroupId: "suite-repeat",
          threshold: 0,
        },
      },
    });
  });

  it("rejects the wrong local key with a message that names the config path", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-auth-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const config = await ensureGeneratedBenchKey({ paths, config: {} });
    const app = createBenchApp({
      config,
      paths,
      store: new MemoryStore(),
      env: { INFEROCK_BENCH_OPENAI_API_KEY: "provider-key" },
      providerFetch: async () => new Response("{}"),
      log: () => {},
    });

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
    });

    expect(response.status).toBe(401);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toContain(paths.configFile);
  });
});

function expectMaskedSecret(secret: string, expected: string): void {
  const masked = maskSecret(secret);
  expect(masked).toBe(expected);
  if (secret.length > 0) expect(masked).not.toContain(secret);
}
