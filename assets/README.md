# Asset Provenance

No assets in this folder may be mocked. Every number-bearing screenshot, hosted sample report, and receipt image must be generated through the real `inferock-bench` pipeline from either real measured traffic or explicitly labeled illustrative data with a documented basis.

Real proof assets still require real normal traffic. Illustrative number renders are allowed only when the data payload carries the illustrative marker, the image and README caption clearly label the render as illustrative, and a basis page documents the calibration.

Masking sign-offs live in [PROVENANCE.md](./PROVENANCE.md). No image or GIF ships without a provenance entry and at least `masked-verified: PENDING user sign-off YYYY-MM-DD` or `masked-verified: PENDING maintainer`; publish enforcement requires a completed human sign-off.

Read this before adding or replacing a visual. The rule is simple: product proof assets come from real normal traffic; explanatory diagrams must label themselves as illustrative.

| Asset type | Public requirement |
| --- | --- |
| Real proof screenshot, GIF, receipt image, hosted sample report | Real normal traffic, masking sign-off, provenance entry, asset scan. |
| Illustrative number render | Real pipeline snapshot from labeled synthetic data, basis page, masking sign-off, provenance entry, asset scan. |
| Explanatory SVG diagram | No measured-data presentation unless it is explicitly sourced; label illustrative when it is not measured. |
| Future capture request | Queue the spec until a real run can produce it. |

## Illustrative 2026-07-02

- `silent-overcharge-anatomy.svg` - explanatory mechanism diagram, not measured data. The diagram is labeled "illustrative mechanism — not measured data" inside the SVG and in the README caption.

## Captured 2026-07-20

- `projection-hero.png` and `projection-hero-narrow.png` - 2x-DPR Playwright screenshots of the real dashboard receipt renderer, populated by the projection-hero synthetic scenario through `summarizeBenchEvents`, clipped to the illustrative receipt. They are the README lead visual pair and are explicitly labeled "Illustrative example - synthetic scenario through the real bench pipeline" in the images and README alt/caption text.
- `dashboard-real-traffic.png` - 2x-DPR Playwright screenshot of the local dashboard at `http://127.0.0.1:4318/`, loaded from the cumulative event store after the previous-results view and fade-in animation settled, clipped to the dashboard content column through the previous-results ledger plus capture padding.
- `receipt-real-traffic.png` - terminal-style PNG rendered by Playwright from the 0.2.3 `receipt --compact` output against the cumulative event store.
- Projection result: `$49,673.82/mo` example spend, `$2,263.20` bill-bounded money loss, `~11.9 min` time loss, `$1,332.77` invoice-check exposure, `$1,813.17` estimated recoverable, and `$450.03` displayed recognition gap. This is illustrative, not a measured run, not a guarantee, and not a bill audit; see [Projection basis](../docs/projection-basis.md).
- Traffic: 1,268 measured calls routed through `inferock-bench` since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints, using maintainer-owned development provider keys; key values were never committed.
- Result: 564 failures/signals, provider spend observed `$7.15`, bill-bounded money loss `$0.03` (stored exact `$0.026464`), provider-recognized `$0.01` (stored exact `$0.005484`), recognition gap `$0.02`, time loss `~2.9 min`, and invoice-check exposure `$16.80` across 202 cache-discount-at-risk signals. This is an issue-weighted adaptive traffic mix; failures/signals are receipt findings rather than unique calls, and invoice-check exposure stays separate from money loss.
- Binary assets were manually inspected under the public no-mock and masking guardrails; no local bench-key or provider-key value is visible.
- No mocked rows, no manufactured failures, no adversarial prompts, no forced truncation, no tiny token caps.

## Terminal GIF

- Length: <=30 seconds.
- Source: real normal sample-app traffic routed through localhost.
- Must show: `npx inferock-bench`, SDK/framework base-URL setup, `first call measured ✓`, and a live report generated from real measured calls.
- Must not show: fake terminal output, seeded failures, fabricated dollar figures, prompts, raw responses, keys, raw traces, or identifiers.
- Watched-clean zero is valid: `$0.00 measured N calls, 0 failures`, with spent, bill-bounded money loss, time loss, invoice-check exposure, provider-recognized, and bill-bounded recognition-gap shown separately. A real priced failure must still show bill-bounded money loss when it is tied to observed spend or charge evidence.

## Receipt PNG

- Style: terminal aesthetic.
- Hierarchy: the headline order is `spent $X · money loss $Y · time loss Z · invoice-check exposure $E`.
- Detail rows: period plus per-class rows with evidence grade, primary impact, provider-recognized, bill-bounded recognition-gap, and separate exposure rows when applicable.
- Watermark: include `inferock-bench` plus `github.com/inferock/inferock-bench`.
- Source: generated by `inferock-bench receipt --compact` from real measured traffic only.
- Must not rank providers or imply that every signal fires in a quick demo.

## Real-Data Generation Rule

Use `TODO-REAL-ASSET` placeholders until a real asset is recorded. If real normal traffic produces no measured failures, publish watched-clean/provider-recognized `$0` explicitly instead of forcing a failure; do not label a real priced failure as zero loss.

## What to read next

- [PROVENANCE.md](./PROVENANCE.md) for the current asset-by-asset manifest.
- [Public run card: 2026-07-10](../docs/public-run-2026-07-10.md) for run15 and cumulative-store reconciliation behind the current real-traffic visuals.
- [Public run card: 2026-07-09](../docs/public-run-2026-07-09.md) for the first 0.1.10 public component in the cumulative receipt.
- Approved visual ideas that still need real traffic stay queued until a real run can produce them.
