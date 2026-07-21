<!--
Maintainer source map: oss/public-root/README.md step 5 Claude Code snippet;
apps/inferock-bench/src/proxy.ts Anthropic route and local bench-key auth;
apps/inferock-bench/src/server.ts startup output; apps/inferock-bench/src/config.ts
provider-key and local-key storage; apps/inferock-bench/src/provider.ts provider names.
-->

# Claude Code integration

## What this is

`inferock-bench` is a local diagnostic proxy for metered LLM API traffic. For Claude Code, it measures Anthropic Messages traffic when Claude Code is pointed at the local bench URL with the local `ibl_` bench key.

This is for metered API calls. A Claude subscription or OAuth login is not a supported mechanism for measuring calls.

## Prerequisites

- Node.js 22+ with npm.
- `inferock-bench` running locally on `http://127.0.0.1:4318`.
- An Anthropic API key saved in `inferock-bench` with `npx inferock-bench setup anthropic` or through the local dashboard.
- The local `ibl_` bench key from `npx inferock-bench key reveal` or the dashboard.
- Claude Code installed:

```sh
npm i -g @anthropic-ai/claude-code
```

Read [Key handling](../key-handling.md) before saving provider credentials. For the receipt boundary, see the main [README receipt contract](../../README.md#receipt-contract) and [How this compares](../how-this-compares.md).

## Setup

Start the local benchmark:

```sh
npx inferock-bench
```

If you use the CLI setup path, save the Anthropic provider key before starting the server, or restart the server after setup:

```sh
npx inferock-bench setup anthropic
```

Get the local bench key:

```sh
npx inferock-bench key reveal
```

The Anthropic provider key stays in local config or environment. Claude Code receives the local `ibl_` bench key as `ANTHROPIC_API_KEY`, and `inferock-bench` attaches the saved Anthropic provider key only when it forwards the provider request.

## First call

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:4318 ANTHROPIC_API_KEY=ibl_your_local_bench_key claude -p "Draft a five-bullet checklist for reviewing an AI invoice."
```

## What you'll see

Observation: after the first successful proxied call, the terminal running `inferock-bench` prints:

```text
first call measured ✓
```

Observation: the dashboard and local event log now include the measured Anthropic call. Interpretation: `npx inferock-bench receipt --compact` renders spend, bill-bounded money loss, time loss, provider-recognized recovery, recognition gap, and invoice-check exposure from the stored event records under the shipped measurement rules.

## Troubleshooting

If Claude Code uses your subscription login instead of the local API route, the call is outside the benchmark and will not appear in the receipt. Use a saved Anthropic API key in `inferock-bench`, then pass the local `ibl_` key as shown above.

If the proxy returns `invalid_local_bench_key`, rerun `npx inferock-bench key reveal` and update `ANTHROPIC_API_KEY`. If it returns `missing_provider_key`, save an Anthropic provider key locally and restart the server if the key was saved by a separate CLI setup process.
