import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { detectSdks, runInit } from "./init.js";

describe("init", () => {
  it("detects supported SDK dependencies", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
      },
      devDependencies: {
        "@anthropic-ai/sdk": "^0.40.0",
      },
    }), "utf8");

    await expect(detectSdks(cwd)).resolves.toEqual(["openai", "anthropic"]);
  });

  it("prints concrete base URL changes and only patches when confirmed by flag", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
      },
    }), "utf8");
    await writeFile(
      join(cwd, "client.ts"),
      "const openai = new OpenAI({\n  apiKey: process.env.INFEROCK_BENCH_KEY,\n});\n",
      "utf8",
    );
    const lines: string[] = [];

    await runInit({
      cwd,
      patchFile: "client.ts",
      yes: true,
      benchKey: "local_bench_key_test_0000000000",
      log: (line) => lines.push(line),
    });

    const patched = await readFile(join(cwd, "client.ts"), "utf8");
    expect(patched).toContain('apiKey: process.env.INFEROCK_BENCH_KEY ?? "local_bench_key_test_0000000000"');
    expect(patched).toContain('baseURL: "http://127.0.0.1:4318/v1"');
    expect(lines.join("\n")).toContain("OpenAI SDK change:");
    expect(lines.join("\n")).toContain("Updated SDK apiKey");
  });

  it("patches Anthropic auth and baseURL together", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        "@anthropic-ai/sdk": "^0.40.0",
      },
    }), "utf8");
    await writeFile(
      join(cwd, "client.ts"),
      "const anthropic = new Anthropic({\n  apiKey: process.env.ANTHROPIC_API_KEY,\n  baseURL: \"https://api.anthropic.com\",\n});\n",
      "utf8",
    );

    await runInit({
      cwd,
      patchFile: "client.ts",
      yes: true,
      benchKey: "local_bench_key_anthropic_0000",
      log: () => {},
    });

    const patched = await readFile(join(cwd, "client.ts"), "utf8");
    expect(patched).toContain('apiKey: process.env.INFEROCK_BENCH_KEY ?? "local_bench_key_anthropic_0000"');
    expect(patched).toContain('baseURL: "http://127.0.0.1:4318"');
    expect(patched).not.toContain("ANTHROPIC_API_KEY");
    expect(patched).not.toContain("https://api.anthropic.com");
  });

  it("patches literal and env-fallback auth shapes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
        "@anthropic-ai/sdk": "^0.40.0",
      },
    }), "utf8");
    await writeFile(
      join(cwd, "client.ts"),
      [
        "const openai = new OpenAI({",
        "  apiKey: process.env.OPENAI_API_KEY ?? \"local-openai-key\",",
        "});",
        "const anthropic = new Anthropic({",
        "  apiKey: \"local-anthropic-key\",",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    await runInit({
      cwd,
      patchFile: "client.ts",
      yes: true,
      benchKey: "local_bench_key_simple_0000",
      log: () => {},
    });

    const patched = await readFile(join(cwd, "client.ts"), "utf8");
    expect(patched).toContain('apiKey: process.env.INFEROCK_BENCH_KEY ?? "local_bench_key_simple_0000"');
    expect(patched).toContain('baseURL: "http://127.0.0.1:4318/v1"');
    expect(patched).toContain('baseURL: "http://127.0.0.1:4318"');
    expect(patched).not.toContain("OPENAI_API_KEY");
    expect(patched).not.toContain("local-anthropic-key");
  });

  it("refuses to patch computed apiKey expressions and leaves the file untouched", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
      },
    }), "utf8");
    const original = [
      "const openai = new OpenAI({",
      "  apiKey: getTenantScopedKey(user),",
      "  baseURL: \"https://api.openai.com/v1\",",
      "});",
      "",
    ].join("\n");
    await writeFile(join(cwd, "client.ts"), original, "utf8");
    const lines: string[] = [];

    await expect(runInit({
      cwd,
      patchFile: "client.ts",
      yes: true,
      benchKey: "local_bench_key_manual_0000",
      log: (line) => lines.push(line),
    })).rejects.toThrow(/Refused to patch/);

    await expect(readFile(join(cwd, "client.ts"), "utf8")).resolves.toBe(original);
    expect(lines.join("\n")).toContain("Patch it manually with:");
    expect(lines.join("\n")).toContain('apiKey: process.env.INFEROCK_BENCH_KEY ?? "local_bench_key_manual_0000",');
    expect(lines.join("\n")).toContain('baseURL: "http://127.0.0.1:4318/v1",');
  });

  it("refuses to patch constructors that do not use an options object", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "inferock-bench-init-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      dependencies: {
        openai: "^4.0.0",
      },
    }), "utf8");
    await writeFile(join(cwd, "client.ts"), "const openai = new OpenAI();\n", "utf8");

    await expect(runInit({
      cwd,
      patchFile: "client.ts",
      yes: true,
      benchKey: "local_bench_key_test_0000000000",
      log: () => {},
    })).rejects.toThrow(/Refused to patch/);
    await expect(readFile(join(cwd, "client.ts"), "utf8")).resolves.toBe("const openai = new OpenAI();\n");
  });
});
