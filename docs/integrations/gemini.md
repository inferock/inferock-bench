<!--
Maintainer source map: oss/public-root/README.md step 5 Gemini snippet;
apps/inferock-bench/src/proxy.ts Gemini GenerateContent route and route-model mapping;
apps/inferock-bench/src/config.ts Gemini key env vars and default base URL;
apps/inferock-bench/src/provider.ts Gemini key-shape checks; apps/inferock-bench/src/dashboard.ts
Gemini local-app snippet.
-->

# Gemini integration

## What this is

`inferock-bench` is a local diagnostic proxy for metered LLM API traffic. For Gemini, it measures Gemini Developer API `generateContent` traffic sent through the local `/v1beta` route with the local `ibl_` bench key.

The request still goes to the Gemini Developer API through the local proxy. Receipts are local unless you share them.

## Prerequisites

- Node.js 22+ with npm.
- `inferock-bench` running locally on `http://127.0.0.1:4318`.
- A Gemini or Google AI provider key saved in `inferock-bench` with `npx inferock-bench setup gemini` or through the local dashboard.
- The local `ibl_` bench key from `npx inferock-bench key reveal` or the dashboard.

Read [Key handling](../key-handling.md) before saving provider credentials. For measurement limits and category boundaries, see [MEASUREMENT-PHILOSOPHY.md](../../MEASUREMENT-PHILOSOPHY.md) and [How this compares](../how-this-compares.md).

## Setup

Start the local benchmark:

```sh
npx inferock-bench
```

If you use the CLI setup path, save the Gemini provider key before starting the server, or restart the server after setup:

```sh
npx inferock-bench setup gemini
```

Get the local bench key:

```sh
npx inferock-bench key reveal
```

Provider keys can also come from `INFEROCK_BENCH_GEMINI_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`. The local proxy defaults upstream Gemini traffic to `https://generativelanguage.googleapis.com/v1beta`.

## First call

```ts
await fetch("http://127.0.0.1:4318/v1beta/models/gemini-2.5-flash:generateContent", {
  method: "POST",
  headers: {
    authorization: "Bearer " + (process.env.INFEROCK_BENCH_KEY ?? "ibl_your_local_bench_key"),
    "content-type": "application/json",
  },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Draft a five-bullet checklist for reviewing an AI invoice." }] }],
  }),
});
```

## What you'll see

Observation: after the first successful proxied call, the terminal running `inferock-bench` prints:

```text
first call measured ✓
```

Observation: the dashboard and local event log now include the measured Gemini call. Interpretation: `npx inferock-bench receipt --compact` computes receipt values from observed traffic and the shipped standard; a clean zero only counts for surfaces the run actually watched.

## Troubleshooting

If non-interactive `npx inferock-bench setup gemini` rejects a key shape, rerun setup in an interactive terminal for Google-plausible unknown shapes, or provide a known Gemini key shape. The CLI accepts known `AIza...` and `AQ.` formats non-interactively.

If the proxy returns `invalid_local_bench_key`, update the bearer token to the current local `ibl_` key. If it returns `missing_provider_key`, save a Gemini provider key locally and restart the server if the key was saved by a separate CLI setup process.
