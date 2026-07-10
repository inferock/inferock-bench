# Pricing Methodology

Read this when a receipt has a dollar figure, a missing price, or a `pricing_unknown` row. Pricing is treated as computation evidence: the rate table version must be visible enough that old receipts can be reproduced instead of silently repriced.

| Pricing state | Receipt behavior |
| --- | --- |
| Static row is present | The row can contribute a dollar figure under the applicable signal rules. |
| Model or billed category is missing or partial | The receipt must show `pricing_unknown` or `partial` and contribute no dollar figure until a price row is added. |
| Provider support is broader than public app support | Compatible records can use additional rows only when source URL, retrieved date, and effective date are present. |

Prices are static registry rows with provider source URL, `sourceRetrievedAt`, effective date, model, tier or plane, and `pricingVersion`.

If a model or billed category is missing or partial, receipts must show `pricing_unknown` or `partial` and contribute no dollar figure until a price row is added. Silent zero-dollar fallback is not allowed.

The registry is not a claim that every accepted canonical provider enum is a public bench provider. Public app support is OpenAI, Anthropic, Gemini, and pinned OpenRouter endpoints; additional pricing rows support compatible records only when source URL, retrieved date, effective date, and required endpoint evidence are present. OpenRouter model-only or requested-pin-only records remain `pricing_unknown` until router metadata and a matching endpoint price snapshot are captured. The current pinned OpenRouter price rows cover meta-llama, deepseek, qwen, mistral, moonshot/kimi, and z-ai/glm families only when observed endpoint metadata matches the cited endpoint snapshot.

Pricing evidence is part of the computation trace, not a background assumption. When provider prices change, the registry row and pricing version must change so old receipts can remain tied to the rate table that produced them.

## What to read next

- [Evidence grade methodology](evidence-grade-methodology.md) for how pricing status affects provider-recognized recovery.
- [Public Signal Semantics](../spec/signals.md) for signal-specific pricing requirements.
- [The Inferock Standard](../spec/standard.md#denominator-rules) for spend-denominator handling.
