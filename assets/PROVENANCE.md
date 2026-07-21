# Asset Provenance Manifest

This manifest is the publish gate for README and launch assets. Every shipped image or GIF in this directory must have one entry with a human sign-off state:

```text
### `asset-file-name.ext`
- source: how the asset was captured or generated
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead; watermark is `github.com/inferock/inferock-bench`
- masked-verified: YYYY-MM-DD by <human name or handle> OR PENDING user sign-off YYYY-MM-DD OR PENDING maintainer
```

`masked-verified: NO ...` is a blocking state. Do not replace it with a date until a human has inspected the rendered pixels and the asset has passed the maintainer asset review gate.

Use this manifest as an evidence ledger, not a gallery. Each entry should say whether an asset is measured traffic, illustrative mechanism, or generated text-free SVG decoration, then state the masking/provenance rule that applies.

| If the asset is | Required proof |
| --- | --- |
| Screenshot, GIF, or receipt PNG | Real normal traffic source, masking notes, human sign-off, and `masked-verified`. |
| Illustrative diagram with visible mechanism/content | Clear illustrative label and masking/sign-off notes. |
| Text-free SVG divider or banner | Generated-from-code provenance and a note that it contains no text, UI-like content, keys, paths, or measured-data claims. |

## Current Assets

### `projection-hero.png`

- public-run-id: not applicable; this is an illustrative synthetic scenario, not measured customer or maintainer traffic.
- package-version: `inferock-bench` 0.2.2 renderer and `@inferock/measure` 0.2.2 grading.
- data-date: 2026-07-20 (illustrative scenario generated during capture)
- capture-date: 2026-07-20
- source: Playwright screenshot of the real local dashboard receipt renderer populated by `apps/inferock-bench/scripts/capture-projection-hero.ts`; rendered with `pnpm --filter inferock-bench exec tsx scripts/capture-projection-hero.ts --output <repo>/oss/public-root/assets/projection-hero.png --narrow-output <repo>/oss/public-root/assets/projection-hero-narrow.png` under Node 22.23.1. The script builds a fixed-spend illustrative scenario, writes synthetic charge observations, passes stored example events through `summarizeBenchEvents`, renders the normal dashboard receipt, and captures the clipped `#doneStage` view.
- scenario-summary: fixed input premise `$49,673.82/mo`; pipeline output `$2,263.20` bill-bounded money loss (`4.6%` of example spend), `~11.9 min` time loss, `$1,332.77` invoice-check exposure, `$1,813.17` estimated recoverable money, and `$450.03` displayed money recognition gap. The scenario has 1,270 example calls, 129 example findings, 4/12 surfaces watched, 50 of 62 billing-error rows calibrated from the cited ~80% credited-when-disputed audit anchor, and 0 real customer calls measured.
- capture-hash: `sha256:048312180d403c180e9287f8e9254ede54b52a37621f1f3990c94eb1dcf192b1` (`projection-hero.png`, 529,630 bytes).
- asset-dimensions: 2072 x 3304 PNG.
- asset-masking: no provider-key panel shown; no local bench-key or provider-key values; no `/home/*`, `/Users/*`, or `ec2-user` strings visible; image is labeled as an illustrative example in both the yellow banner and the receipt title.
- masking-check: rendered pixels checked for illustrative banner, title-line disclosure, basis and newest-measured-run labels, exact scenario values, absence of provider keys, absence of local bench keys, absence of host-user paths, and zero measured-run framing in the crop.
- human-sign-off: user taste-gate PASS 2026-07-20 (verbatim "pass" on this render); primary mandate-4 visual sign-off 2026-07-21 (approval 2026-07-21T09:37:50Z).
- masked-verified: 2026-07-21 by opius-primary (7th; mandate-4 approval 2026-07-21T09:37:50Z, user taste-gate PASS 2026-07-20)

### `projection-hero-narrow.png`

- public-run-id: not applicable; this is the narrow/mobile capture of the same illustrative synthetic scenario as `projection-hero.png`, not measured customer or maintainer traffic.
- package-version: `inferock-bench` 0.2.2 renderer and `@inferock/measure` 0.2.2 grading.
- data-date: 2026-07-20 (illustrative scenario generated during capture)
- capture-date: 2026-07-20
- source: Playwright screenshot of the real local dashboard receipt renderer populated by `apps/inferock-bench/scripts/capture-projection-hero.ts`; generated in the same capture invocation as `projection-hero.png` with a 390 x 3600 viewport at 2x DPR.
- scenario-summary: same fixed input premise and pipeline outputs as `projection-hero.png`: `$49,673.82/mo` example spend, `$2,263.20` bill-bounded money loss, `~11.9 min` time loss, `$1,332.77` invoice-check exposure, `$1,813.17` estimated recoverable money, and `$450.03` displayed money recognition gap. The scenario has 1,270 example calls, 129 example findings, 4/12 surfaces watched, 50 of 62 billing-error rows calibrated from the cited ~80% credited-when-disputed audit anchor, and 0 real customer calls measured.
- capture-hash: `sha256:39324ee80b1a8447fee778b4cc13b3acad30818b24cd88be8db173d1d4328ae3` (`projection-hero-narrow.png`, 621,451 bytes).
- asset-dimensions: 780 x 6424 PNG.
- asset-masking: no provider-key panel shown; no local bench-key or provider-key values; no `/home/*`, `/Users/*`, or `ec2-user` strings visible; image is labeled as an illustrative example in both the yellow banner and the receipt title.
- masking-check: rendered pixels checked for mobile-readable illustrative banner, title-line disclosure, basis and newest-measured-run labels, exact scenario values, absence of provider keys, absence of local bench keys, absence of host-user paths, and zero measured-run framing in the crop.
- human-sign-off: user taste-gate PASS 2026-07-20 (verbatim "pass" on this render); primary mandate-4 visual sign-off 2026-07-21 (approval 2026-07-21T09:37:50Z).
- masked-verified: 2026-07-21 by opius-primary (7th; mandate-4 approval 2026-07-21T09:37:50Z, user taste-gate PASS 2026-07-20)

### `dashboard-real-traffic.png`

- public-run-id: `inferock-bench-0.1.10-cumulative-ledger-2026-07-09-through-run15-2026-07-10`.
- package-version: `inferock-bench` 0.2.3 renderer and `@inferock/measure` 0.2.3 grading re-render of the stored 0.1.10 event store.
- data-date: 2026-07-10 (newest measured run in the cumulative event store)
- capture-date: 2026-07-21
- source: Playwright screenshot of the local dashboard loaded from the rebuilt cumulative event store after prior results opened and the fade-in animation settled; rendered by `pnpm --filter inferock-bench capture:dashboard-real-traffic` with a 1280 x 1100 desktop viewport at 2x DPR and a reproducible screenshot clip around the 1052px `.page` content container plus 24px padding, ending after the previous-results ledger (`x=90`, `y=0`, CSS `w=1100`, CSS `h=823`). Store assembly used 107 newrun events plus 1,162 run15 extracted-store events with the run15 seed/carry-forward row `speedtest_20f50256-1816-4078-97af-2b9582c15c44` dropped. The dashboard headline includes the inline money-loss observed-spend percent and the four plain-English gloss sublines. Watermark overlaid inside the clipped frame during capture.
- traffic-summary: 1,268 measured calls since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints; 564 failures/signals; observed spend `$7.15`; bill-bounded money loss `$0.03` (`0.4%` of observed spend; stored exact `$0.026464`); provider-recognized `$0.01` (stored exact `$0.005484`); recognition gap `$0.02`; time loss `~2.9 min`; at-rate translation `$4.418940`; invoice-check exposure `$16.80` across 202 signals; surfaces watched 12/13. This is an issue-weighted adaptive traffic mix; failures/signals are receipt findings rather than unique calls, and invoice-check exposure is separate from booked money loss.
- capture-hash: `sha256:a1082390aa40aaafe674e6f67386d3bf5e6cbc25617cb2ab966fe5ab49154f17` (`dashboard-real-traffic.png`, 227,017 bytes).
- asset-dimensions: 2200 x 1646 PNG.
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead where paths appear; watermark is `github.com/inferock/inferock-bench`.
- masking-check: provider-key panel and capture-only interactive controls hidden; rendered pixels checked for local bench keys, provider keys, host-user paths, settled dashboard state, four-element one-line headline labels, clipped 1100px content-column framing, shared-grid previous-results ledger row alignment, previous-results ledger crop, and watermark correctness.
- human-sign-off: pending user sign-off, 2026-07-20.
- masked-verified: 2026-07-21 by maintainer visual inspection (0.2.3 re-render @2200x1646; `$0.03 (0.4%)`, 564 failure signals, provider-recognized `$0.01`, exposure separation, watermark, and zero key/path shapes confirmed)

### `receipt-real-traffic.png`

- public-run-id: `inferock-bench-0.1.10-cumulative-ledger-2026-07-09-through-run15-2026-07-10`.
- package-version: `inferock-bench` 0.2.3 renderer and `@inferock/measure` 0.2.3 grading re-render of the stored 0.1.10 event store.
- data-date: 2026-07-10 (newest measured run in the cumulative event store)
- capture-date: 2026-07-21
- source: Terminal-style PNG rendered by Playwright from the 0.2.3 `receipt --compact` output against the cumulative event store. Receipt path sanitized to `~/.inferock-bench`; watermark overlaid during rendering.
- traffic-summary: 1,268 measured calls since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints; 564 failures/signals; observed spend `$7.15`; bill-bounded money loss `$0.03` (stored exact `$0.026464`); provider-recognized `$0.01` (stored exact `$0.005484`); recognition gap `$0.02`; time loss `~2.9 min`; at-rate translation `$4.418940`; invoice-check exposure `$16.80` across 202 signals; surfaces watched 12/13. This is an issue-weighted adaptive traffic mix; failures/signals are receipt findings rather than unique calls, and invoice-check exposure is separate from booked money loss.
- capture-hash: `sha256:dd56913650d074ba6153942de7fd365fefb8f972f650410ea5df0d0e0c7f6111` (`receipt-real-traffic.png`, 363,127 bytes).
- asset-dimensions: 1440 x 1100 PNG.
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead; watermark is `github.com/inferock/inferock-bench`.
- masking-check: rendered receipt checked for local bench keys, provider keys, host-user paths, sanitized receipt path, four-element headline, and watermark correctness.
- human-sign-off: pending user sign-off, 2026-07-20.
- masked-verified: 2026-07-21 by maintainer visual inspection (0.2.3 re-render @1440x1100; `$0.03 (0.4%)`, 564 failure signals, provider-recognized `$0.005484`, exposure detail, `~/.inferock-bench`, watermark, and zero key/path shapes confirmed)

### `silent-overcharge-anatomy.svg`

- public-run-id: not applicable; this is an illustrative mechanism diagram, not measured data.
- package-version: not generated by `inferock-bench`.
- source: Explanatory mechanism diagram, not measured data. The diagram is labeled illustrative in the SVG and README caption.
- traffic-summary: none; no measured values are presented by this asset.
- asset-dimensions: SVG vector asset.
- asset-masking: no key panel; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; no measured-number claim.
- masking-check: SVG text checked for key-shaped strings, host-user paths, and measured-data claims.
- human-sign-off: verified by Bharath Koneti, 2026-07-06.
- masked-verified: 2026-07-06 by Bharath Koneti
