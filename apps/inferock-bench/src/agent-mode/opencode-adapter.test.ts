import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOpenCodeLaunch,
  createAgentChildEnv,
  writeOpenCodeWorkspaceConfig,
} from "./opencode-adapter.js";

describe("opencode adapter", () => {
  it("uses an allowlisted child env and confines cwd/config to the run scratch workspace", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "inferock-agent-run-"));
    const workspace = join(runRoot, "provider-openai", "workspace");
    const home = join(runRoot, "provider-openai", "home");
    const localKey = ["ibl", "_agentlocal1234567890abcd"].join("");
    const openAiApiKeyName = "OPENAI_API_KEY";
    const anthropicApiKeyName = "ANTHROPIC_API_KEY";
    const awsSecretAccessKeyName = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
    const inherited = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      SHELL: "/bin/zsh",
      [openAiApiKeyName]: ["s", "k-real-openai-secret"].join(""),
      [anthropicApiKeyName]: ["s", "k-ant-real-anthropic-secret"].join(""),
      [awsSecretAccessKeyName]: "aws-secret",
    };

    const env = createAgentChildEnv({
      inheritedEnv: inherited,
      workspace,
      home,
      localKey,
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      INFEROCK_AGENT_LOCAL_KEY: localKey,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_MODEL: "openai/gpt-4o-mini-2024-07-18",
    });
    expect(JSON.stringify(env)).not.toContain("sk-real");
    expect(JSON.stringify(env)).not.toContain("sk-ant-real");
    expect(JSON.stringify(env)).not.toContain(awsSecretAccessKeyName);

    const configPath = await writeOpenCodeWorkspaceConfig({
      workspace,
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      proxyBaseUrl: "http://127.0.0.1:4318",
    });
    expect(dirname(configPath)).toBe(workspace);
    const configText = await readFile(configPath, "utf8");
    expect(configText).toContain('"enabled_providers"');
    expect(configText).toContain('"autoupdate": false');
    expect(configText).toContain('"share": "disabled"');
    expect(configText).toContain('"apiKey": "{env:INFEROCK_AGENT_LOCAL_KEY}"');
    expect(configText).not.toContain(runRoot.replaceAll("\\", "\\\\"));

    const launch = buildOpenCodeLaunch({
      executablePath: join(runRoot, "agent", "bin", "opencode"),
      workspace,
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      prompt: "Fix the failing test.",
      env,
    });
    expect(launch.cwd).toBe(workspace);
    expect(launch.args).toEqual([
      "run",
      "--model",
      "openai/gpt-4o-mini-2024-07-18",
      "--dir",
      workspace,
      "--format",
      "json",
      "--auto",
      "Fix the failing test.",
    ]);
  });
});
