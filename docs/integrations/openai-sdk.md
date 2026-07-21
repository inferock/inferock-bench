<!--
Maintainer source map: oss/public-root/README.md step 5 OpenAI SDK snippet;
apps/inferock-bench/src/proxy.ts OpenAI Chat Completions and Responses routes;
apps/inferock-bench/src/init.ts OpenAI constructor baseURL; apps/inferock-bench/src/server.ts
startup output; apps/inferock-bench/src/config.ts provider-key and local-key storage.
-->

# OpenAI SDK integration

## What this is

`inferock-bench` is a local diagnostic proxy for metered LLM API traffic. For the OpenAI JavaScript SDK, it measures calls when the SDK uses the local `ibl_` bench key and `http://127.0.0.1:4318/v1` as its `baseURL`.

The request still goes to OpenAI through the local proxy. Receipts are local unless you share them.

## Prerequisites

- Node.js 22+ with npm.
- A JavaScript or TypeScript project that uses the `openai` SDK.
- `inferock-bench` running locally on `http://127.0.0.1:4318`.
- An OpenAI provider key saved in `inferock-bench` with `npx inferock-bench setup openai` or through the local dashboard.
- The local `ibl_` bench key from `npx inferock-bench key reveal` or the dashboard.

Read [Key handling](../key-handling.md) before saving provider credentials. For category boundaries, see [How this compares](../how-this-compares.md).

## Setup

Start the local benchmark:

```sh
npx inferock-bench
```

If you use the CLI setup path, save the OpenAI provider key before starting the server, or restart the server after setup:

```sh
npx inferock-bench setup openai
```

Get the local bench key:

```sh
npx inferock-bench key reveal
```

Set the SDK `apiKey` to the local `ibl_` bench key and set `baseURL` to the local OpenAI-compatible route. The OpenAI SDK base URL includes `/v1`.

## First call

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.INFEROCK_BENCH_KEY ?? "ibl_your_local_bench_key",
  baseURL: "http://127.0.0.1:4318/v1",
});

await openai.chat.completions.create({
  model: "gpt-4o-mini-2024-07-18",
  messages: [{ role: "user", content: "Draft a five-bullet checklist for reviewing an AI invoice." }],
});
```

## What you'll see

Observation: after the first successful proxied call, the terminal running `inferock-bench` prints:

```text
first call measured ✓
```

Observation: the dashboard and local event log now include the measured OpenAI call. Interpretation: `npx inferock-bench receipt --compact` computes the receipt from observed usage, timing, pricing evidence, response metadata, and detector signals; dollar figures are the benchmark's measurement arithmetic, not provider admissions.

## Troubleshooting

If you get `invalid_local_bench_key`, the SDK is not sending the current local `ibl_` key. Rerun `npx inferock-bench key reveal` or copy the key from the dashboard.

If you get `missing_provider_key`, save an OpenAI provider key locally and restart the server if the key was saved by a separate CLI setup process.

If your code already has an OpenAI constructor, `npx inferock-bench init` prints the OpenAI constructor settings, and `npx inferock-bench init --patch path/to/client.ts --yes` patches simple constructors only when it can update both `apiKey` and `baseURL`.
