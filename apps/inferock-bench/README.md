# inferock-bench

Local benchmark proxy for OpenAI, Anthropic, Gemini, and pinned OpenRouter calls. Provider keys are not sent to Inferock; attached only to provider requests. It accepts a generated local `ibl_` bench key from your SDK and writes per-call receipts with spent dollars, bill-bounded money loss, time loss, provider-recognized recovery, recognition gap, and invoice-check exposure kept separate.

Use it when you want to audit an AI/LLM bill, measure Claude or GPT token usage locally, or answer whether a failed API call was still billed. It helps investigate OpenAI overcharging-token questions and Anthropic billing-error questions by preserving local token usage, cost, retry, and failure evidence without sending provider keys to a hosted service.

Full docs, screenshots, and the public standard live at https://github.com/inferock/inferock-bench.

| Need | Start here |
| --- | --- |
| Run the local proxy | [Quickstart](#quickstart) |
| See command surface | [Commands](#commands) |
| Understand the trust boundary | [What leaves your machine](../../docs/what-leaves-your-machine.md) |
| Read the receipt rulebook | [The Inferock Standard](../../spec/standard.md) |

## Quickstart

```sh
npx inferock-bench
```

Open `http://127.0.0.1:4318/`, save your provider key locally, then copy the local bench key into your SDK config with the local base URL.

OpenAI:

```ts
const openai = new OpenAI({
  apiKey: process.env.INFEROCK_BENCH_KEY ?? "ibl_your_generated_local_key",
  baseURL: "http://127.0.0.1:4318/v1",
});
```

Anthropic:

```ts
const anthropic = new Anthropic({
  apiKey: process.env.INFEROCK_BENCH_KEY ?? "ibl_your_generated_local_key",
  baseURL: "http://127.0.0.1:4318",
});
```

Gemini:

```ts
await fetch("http://127.0.0.1:4318/v1beta/models/gemini-2.5-flash:generateContent", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.INFEROCK_BENCH_KEY ?? "ibl_your_generated_local_key",
  },
  body: JSON.stringify({
    contents: [{ parts: [{ text: "Write one sentence about local receipts." }] }],
  }),
});
```

OpenRouter:

```ts
const openrouter = new OpenAI({
  apiKey: process.env.INFEROCK_BENCH_KEY ?? "ibl_your_generated_local_key",
  baseURL: "http://127.0.0.1:4318/openrouter/v1",
});
```

The terminal prints `first call measured ✓` after the first successful proxied call.

`inferock-bench init --patch path/to/client.ts --yes` can patch simple `new OpenAI({ ... })` and `new Anthropic({ ... })` constructors. It updates both `apiKey` and `baseURL`; if it cannot do that safely, it refuses and tells you what to change by hand. Gemini and OpenRouter setup are supported through `inferock-bench setup`, the dashboard, and their local proxy paths.

## Commands

```sh
inferock-bench start
inferock-bench start --host 0.0.0.0 --allow-external-host
inferock-bench init
inferock-bench test --providers all
inferock-bench test --generator agent
inferock-bench report --last 24h
inferock-bench receipt --compact
inferock-bench telemetry enable --reliability-index
```

The default server host is `127.0.0.1`. Non-loopback hosts are refused unless
`--allow-external-host` is present; that mode prints a warning because the
proxy and management APIs become reachable from other machines that can connect
to the host.

`inferock-bench test` shows the full-battery estimated price before any
provider call. Agent mode auto-provisions pinned `opencode-ai@1.17.13` locally
only after explicit consent, or uses `--agent-cmd` as a user-supplied agent.

Production routing, secure key custody, invoice reconciliation, provider leverage, and audit workflows belong in hosted Inferock: https://inferock.opiusai.com.

## What to read next

- [Root README](../../README.md) for screenshots, the public run card, and the docs map.
- [Key handling](../../docs/key-handling.md) before saving provider credentials.
- [Coverage test methodology](../../docs/coverage-test-methodology.md) before running the complete test battery.
