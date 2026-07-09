import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export function createAgentChildEnv(input) {
    const env = {
        PATH: input.inheritedEnv.PATH ?? "",
        HOME: input.home,
        XDG_CONFIG_HOME: join(input.home, ".config"),
        XDG_CACHE_HOME: join(input.home, ".cache"),
        XDG_DATA_HOME: join(input.home, ".local", "share"),
        INFEROCK_AGENT_LOCAL_KEY: input.localKey,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_MODEL: `${input.provider}/${input.model}`,
    };
    if (input.inheritedEnv.SystemRoot)
        env.SystemRoot = input.inheritedEnv.SystemRoot;
    if (input.inheritedEnv.ComSpec)
        env.ComSpec = input.inheritedEnv.ComSpec;
    return env;
}
export async function writeOpenCodeWorkspaceConfig(input) {
    if (input.provider === "gemini") {
        throw new Error("Agent-mode OpenCode workspace config does not support Gemini provider routing yet.");
    }
    await mkdir(input.workspace, { recursive: true });
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
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return configPath;
}
export function buildOpenCodeLaunch(input) {
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
//# sourceMappingURL=opencode-adapter.js.map