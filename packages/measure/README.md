# @inferock/measure

TypeScript primitives behind `inferock-bench`: canonical provider events, token-count checks, billing-integrity signals, pricing, and receipt-ready loss rows.

Use it for local Claude/GPT token usage checks, OpenAI/Anthropic/Gemini/OpenRouter cost evidence (OpenRouter dollar pricing is endpoint-evidence-gated in the public app), billing-integrity tests, and receipt math when you do not need the local proxy process.

Use this package when you want the measurement math without running the local proxy.

| Need | Start here |
| --- | --- |
| Event shape | [Canonical Event Schema](../../spec/event-schema.md) |
| Signal semantics | [Public Signal Semantics](../../spec/signals.md) |
| Receipt ledgers | [The Inferock Standard](../../spec/standard.md) |
| Local proxy and captures | [inferock-bench README](../../apps/inferock-bench/README.md) |

```ts
import { estimateCostUsd, runStatelessDetectors } from "@inferock/measure/stateless";

const costUsd = estimateCostUsd(canonicalEvent);
const signals = runStatelessDetectors(canonicalEvent);
```

The CLI and full public docs live at https://github.com/inferock/inferock-bench.

## What ships

- Canonical provider event types, including OpenAI, Anthropic, Gemini, and OpenRouter-compatible events; OpenRouter public-app dollar pricing is restricted to pinned observed endpoints.
- Broken-output, billed-empty, refusal, latency, availability, token-count, and billing-integrity detectors.
- Pricing helpers for observed provider usage.
- Receipt-oriented signal fields for spent dollars, bill-bounded money loss, time loss, provider-recognized recovery, recognition gap, and separate invoice-check exposure accounting.

## Anthropic Token Recount

Anthropic output-token cross-checks use `anthropic_count_tokens_recount_v1` only after runtime per-model calibration against Anthropic `messages/count_tokens`. Evidence is capped at provider-assisted grade B. Offline estimates use the vendored MIT `Xenova/claude-tokenizer` at revision `cae688821ea05490de49a6d3faa36468a4672fad`; see `src/vendor/claude-tokenizer/LICENSE-Xenova-claude-tokenizer.md`.

Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.

`@inferock/measure` is Apache-2.0. The `inferock-bench` CLI is the local proxy that captures real calls and feeds this library.

## What to read next

- [Pricing methodology](../../docs/pricing-methodology.md) for source dates, pricing versions, and `pricing_unknown`.
- [Evidence grade methodology](../../docs/evidence-grade-methodology.md) for how detector posture affects provider-recognized recovery.
- [Coverage test methodology](../../docs/coverage-test-methodology.md) for the local benchmark path that produces receipt evidence.

`inferock-bench` is source-available under FSL-1.1-ALv2, and `@inferock/measure` is Apache-2.0. Together they are the source-available measurement layer of [Inferock](https://inferock.opiusai.com), the hosted billing-integrity and reliability gateway.
