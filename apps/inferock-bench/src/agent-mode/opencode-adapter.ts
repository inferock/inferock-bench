import { join } from "node:path";
import { ensurePrivateDir, writePrivateTextFile } from "../private-files.js";
import type { ProviderName } from "../provider.js";

export interface AgentChildEnvInput {
  readonly inheritedEnv: NodeJS.ProcessEnv;
  readonly workspace: string;
  readonly home: string;
  readonly localKey: string;
  readonly provider: ProviderName;
  readonly model: string;
}

export interface OpenCodeLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export function createAgentChildEnv(input: AgentChildEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    PATH: input.inheritedEnv.PATH ?? "",
    HOME: input.home,
    XDG_CONFIG_HOME: join(input.home, ".config"),
    XDG_CACHE_HOME: join(input.home, ".cache"),
    XDG_DATA_HOME: join(input.home, ".local", "share"),
    INFEROCK_AGENT_LOCAL_KEY: input.localKey,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_MODEL: `${input.provider}/${input.model}`,
  };
  if (input.inheritedEnv.SystemRoot) env.SystemRoot = input.inheritedEnv.SystemRoot;
  if (input.inheritedEnv.ComSpec) env.ComSpec = input.inheritedEnv.ComSpec;
  return env;
}

export async function writeOpenCodeWorkspaceConfig(input: {
  readonly workspace: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly proxyBaseUrl: string;
}): Promise<string> {
  if (input.provider === "gemini") {
    throw new Error("Agent-mode OpenCode workspace config does not support Gemini provider routing yet.");
  }
  await ensurePrivateDir(input.workspace);
  const configPath = join(input.workspace, "opencode.json");
  const baseURL = `${input.proxyBaseUrl.replace(/\/$/, "")}/v1`;
  const otherProvider = input.provider === "openai" ? "anthropic" : "openai";
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: `${input.provider}/${input.model}`,
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    enabled_providers: [input.provider],
    disabled_providers: [otherProvider],
    provider: {
      [input.provider]: {
        options: {
          baseURL,
          apiKey: "{env:INFEROCK_AGENT_LOCAL_KEY}",
        },
        models: {
          [input.model]: {
            name: input.model,
          },
        },
      },
    },
    permission: {
      edit: "allow",
      bash: "allow",
      read: "allow",
      webfetch: "deny",
      websearch: "deny",
    },
    watcher: {
      ignore: ["node_modules/**", ".git/**", "dist/**"],
    },
  };
  await writePrivateTextFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

export function buildOpenCodeLaunch(input: {
  readonly executablePath: string;
  readonly workspace: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly prompt: string;
  readonly env: Record<string, string>;
}): OpenCodeLaunch {
  return {
    command: input.executablePath,
    args: [
      "run",
      "--model",
      `${input.provider}/${input.model}`,
      "--dir",
      input.workspace,
      "--format",
      "json",
      "--auto",
      input.prompt,
    ],
    cwd: input.workspace,
    env: input.env,
  };
}
