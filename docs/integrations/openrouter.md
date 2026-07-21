<!--
Maintainer source map: apps/inferock-bench/README.md OpenRouter snippet;
oss/public-root/README.md OpenRouter boundary text; apps/inferock-bench/src/proxy.ts
OpenRouter route; apps/inferock-bench/src/openrouter-pins.ts pinned endpoint set;
apps/inferock-bench/src/adapters/openrouter.ts endpoint evidence and request construction;
apps/inferock-bench/src/dashboard.ts OpenRouter local-app snippet.
-->

# OpenRouter integration

## What this is

`inferock-bench` is a local diagnostic proxy for metered LLM API traffic. For OpenRouter, it measures only the current pinned OpenAI-compatible endpoint plane, not arbitrary OpenRouter model routing.

OpenRouter requests use the local `/openrouter/v1` base URL. The proxy owns the OpenRouter `provider` routing block so the request can be pinned before it is forwarded.

## Prerequisites

- Node.js 22+ with npm.
- A JavaScript or TypeScript project that uses the `openai` SDK for OpenAI-compatible chat completions.
- `inferock-bench` running locally on `http://127.0.0.1:4318`.
- An OpenRouter provider key saved in `inferock-bench` with `npx inferock-bench setup openrouter` or through the local dashboard.
- The local `ibl_` bench key from `npx inferock-bench key reveal` or the dashboard.

Read [Key handling](../key-handling.md) before saving provider credentials. For why OpenRouter is narrower than general provider support, see the main [README key boundary](../../README.md#how-provider-keys-are-used) and [How this compares](../how-this-compares.md).

## Setup

Start the local benchmark:

```sh
npx inferock-bench
```

If you use the CLI setup path, save the OpenRouter provider key before starting the server, or restart the server after setup:

```sh
npx inferock-bench setup openrouter
```

Get the local bench key:

```sh
npx inferock-bench key reveal
```

The current pinned endpoint set is:

- `meta-llama/llama-4-maverick` on `parasail/fp8`
- `deepseek/deepseek-v4-pro` on `deepseek`
- `deepseek/deepseek-v3.2` on `deepinfra/fp4`
- `qwen/qwen3-235b-a22b-2507` on `deepinfra/fp8`
- `mistralai/mistral-large-2512` on `mistral`
- `moonshotai/kimi-k2.7-code` on `moonshotai/int4`
- `z-ai/glm-5.2` on `z-ai/fp8`

## First call

```ts
import OpenAI from "openai";

const openrouter = new OpenAI({
  apiKey: process.env.INFEROCK_BENCH_KEY ?? "ibl_your_local_bench_key",
  baseURL: "http://127.0.0.1:4318/openrouter/v1",
});

await openrouter.chat.completions.create({
  model: "meta-llama/llama-4-maverick",
  messages: [{ role: "user", content: "Draft a five-bullet checklist for reviewing an AI invoice." }],
});
```

Do not add a `provider` field to the request body. `inferock-bench` adds the pinned OpenRouter provider block and rejects requests that try to own provider routing themselves.

## What you'll see

Observation: after the first successful proxied call, the terminal running `inferock-bench` prints:

```text
first call measured ✓
```

Observation: the dashboard and local event log now include OpenRouter endpoint evidence when the route can capture it. Interpretation: OpenRouter traffic is priced as measured support only when the requested pin, served endpoint metadata, and cited pricing evidence match; otherwise the receipt preserves the limitation instead of treating unknown pricing as zero.

## Troubleshooting

If the proxy returns `openrouter_endpoint_pin_required`, use one of the pinned model IDs above and remove any request-body `provider` field.

If the proxy returns `invalid_local_bench_key`, update the SDK `apiKey` to the current local `ibl_` key. If it returns `missing_provider_key`, save an OpenRouter provider key locally and restart the server if the key was saved by a separate CLI setup process.
