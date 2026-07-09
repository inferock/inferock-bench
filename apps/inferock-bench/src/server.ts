import { serve } from "@hono/node-server";
import {
  benchKeyFromConfig,
  DEFAULT_HOST,
  DEFAULT_PORT,
  providerKeyStatus,
  type BenchConfig,
  type BenchPaths,
} from "./config.js";
import { createBenchApp } from "./proxy.js";
import { JsonlEventStore } from "./storage.js";
import { renderLiveCounter, summarizeBenchEvents } from "./summary.js";

export interface StartServerInput {
  readonly paths: BenchPaths;
  readonly config: BenchConfig;
  readonly host?: string;
  readonly port?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdinIsTty?: boolean;
  readonly stdoutIsTty?: boolean;
  readonly log?: (line: string) => void;
}

export async function startServer(input: StartServerInput): Promise<void> {
  const log = input.log ?? console.log;
  const env = input.env ?? process.env;
  const host = input.host ?? env.INFEROCK_BENCH_HOST ?? DEFAULT_HOST;
  const port = input.port ?? portFromEnv(env) ?? DEFAULT_PORT;
  const store = new JsonlEventStore(input.paths.eventsFile);
  const app = createBenchApp({
    config: input.config,
    paths: input.paths,
    store,
    env,
    log,
    reliabilityIndexPrompt: {
      paths: input.paths,
      stdinIsTty: input.stdinIsTty,
      stdoutIsTty: input.stdoutIsTty,
    },
  });

  const summary = summarizeBenchEvents(await store.readAll(), {}, { config: input.config });
  const dashboardUrl = `http://${host}:${port}/`;
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

function portFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.INFEROCK_BENCH_PORT;
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}
