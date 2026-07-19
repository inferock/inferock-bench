import { serve } from "@hono/node-server";
import { isIP } from "node:net";
import { benchKeyFromConfig, DEFAULT_HOST, DEFAULT_PORT, providerKeyStatus, } from "./config.js";
import { createBenchApp } from "./proxy.js";
import { JsonlEventStore } from "./storage.js";
import { renderLiveCounter, summarizeBenchEvents } from "./summary.js";
export class ExternalHostRefusedError extends Error {
    constructor(host) {
        super(`Refusing to bind inferock-bench to non-loopback host ${host}. ` +
            "Use --allow-external-host only when you intend to expose the local proxy and management APIs to the network.");
        this.name = "ExternalHostRefusedError";
    }
}
export async function startServer(input) {
    const log = input.log ?? console.log;
    const env = input.env ?? process.env;
    const bind = resolveServerBindOptions({
        host: input.host,
        port: input.port,
        env,
        allowExternalHost: input.allowExternalHost ?? false,
    });
    const { host, port } = bind;
    const store = new JsonlEventStore(input.paths.eventsFile);
    const app = createBenchApp({
        config: input.config,
        paths: input.paths,
        store,
        env,
        log,
        allowExternalManagementHost: bind.externalHost,
        reliabilityIndexPrompt: {
            paths: input.paths,
            stdinIsTty: input.stdinIsTty,
            stdoutIsTty: input.stdoutIsTty,
        },
    });
    const summary = summarizeBenchEvents(await store.readAll(), {}, { config: input.config });
    const dashboardUrl = `http://${host}:${port}/`;
    for (const warning of bind.warnings)
        log(warning);
    log(`inferock-bench listening at http://${host}:${port}`);
    log(`Dashboard: ${dashboardUrl}`);
    log(`OpenAI SDK baseURL: http://${host}:${port}/v1`);
    log(`Anthropic SDK baseURL: http://${host}:${port}`);
    log(`Gemini GenerateContent baseURL: http://${host}:${port}/v1beta`);
    log((input.config.benchKey ?? benchKeyFromConfig(input.config, env))
        ? "Local bench key: configured (masked)"
        : "Local bench key: missing");
    if (env.INFEROCK_BENCH_KEY && input.config.benchKey) {
        log("INFEROCK_BENCH_KEY override is also accepted for proxy requests.");
    }
    log(`Config: ${input.paths.configFile}`);
    if (!providerKeyStatus("openai", input.config, env).configured &&
        !providerKeyStatus("anthropic", input.config, env).configured &&
        !providerKeyStatus("gemini", input.config, env).configured) {
        log(`Provider setup: open ${dashboardUrl} and save an OpenAI, Anthropic, or Gemini key locally.`);
    }
    log(renderLiveCounter(summary));
    serve({
        fetch: app.fetch,
        hostname: host,
        port,
    });
}
export function resolveServerBindOptions(input) {
    const env = input.env ?? process.env;
    const host = input.host ?? env.INFEROCK_BENCH_HOST ?? DEFAULT_HOST;
    const port = input.port ?? portFromEnv(env) ?? DEFAULT_PORT;
    const externalHost = !isLoopbackHost(host);
    if (externalHost && !input.allowExternalHost)
        throw new ExternalHostRefusedError(host);
    return {
        host,
        port,
        externalHost,
        warnings: externalHost ? [externalHostWarning(host)] : [],
    };
}
export function isLoopbackHost(host) {
    const normalized = normalizeHost(host);
    if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1")
        return true;
    if (isIP(normalized) === 4) {
        const parts = normalized.split(".");
        return parts.length === 4 && parts[0] === "127";
    }
    return false;
}
export function externalHostWarning(host) {
    return `WARNING: --allow-external-host is enabled for ${host}. The inferock-bench proxy and management APIs are reachable from other machines that can connect to this host.`;
}
function normalizeHost(host) {
    const lower = host.trim().toLowerCase();
    const unbracketed = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
    return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed;
}
function portFromEnv(env) {
    const value = env.INFEROCK_BENCH_PORT;
    if (!value)
        return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}
//# sourceMappingURL=server.js.map