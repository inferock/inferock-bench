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

### `bench-demo.gif`

- public-run-id: `inferock-bench-0.1.10-cumulative-ledger-2026-07-09-through-run15-2026-07-10`.
- package-version: `inferock-bench` 0.1.10.
- source: Terminal GIF rendered from sanitized cumulative-ledger evidence: startup/version, provider scope, first measured call, and the post-merge `src/index.ts receipt --compact` output. Watermark overlaid during rendering.
- traffic-summary: 1,268 measured calls since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints; 565 failures/signals; observed spend `$7.15`; bill-bounded money loss `$0.07` (stored exact `$0.073875`); provider-recognized `$0.05`; recognition gap `$0.02`; time loss `~2.9 min`; at-rate translation `$4.449810`; invoice-check exposure `$16.80` across 202 signals; surfaces watched 12/13. Invoice-check exposure is separate and not summed into money loss.
- asset-dimensions: 1280 x 720 GIF, 4 frames.
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead; watermark is `github.com/inferock/inferock-bench`.
- masking-check: asset strings and rendered pixels were checked for local bench keys, provider keys, host-user paths, sanitized receipt path, four-element headline, and watermark correctness.
- human-sign-off: pending user sign-off, 2026-07-10.
- masked-verified: 2026-07-10 by maintainer visual inspection (24th lineage; 4-element headline, % line, exposure detail, ~ paths, watermark, zero key shapes confirmed per-image)

### `dashboard-real-traffic.png`

- public-run-id: `inferock-bench-0.1.10-cumulative-ledger-2026-07-09-through-run15-2026-07-10`.
- package-version: `inferock-bench` 0.1.10.
- source: Playwright screenshot of the local dashboard loaded from the rebuilt cumulative event store after prior results opened and the fade-in animation settled; rendered by `pnpm --filter inferock-bench capture:dashboard-real-traffic` with a 1280 x 1100 desktop viewport at 2x DPR and a reproducible screenshot clip around the 1052px `.page` content container plus 24px padding, ending after the previous-results ledger (`x=90`, `y=0`, CSS `w=1100`, CSS `h=784`). Store assembly used 107 newrun events plus 1,162 run15 extracted-store events with the run15 seed/carry-forward row `speedtest_20f50256-1816-4078-97af-2b9582c15c44` dropped. The dashboard headline includes the inline money-loss observed-spend percent and the four plain-English gloss sublines. Watermark overlaid inside the clipped frame during capture.
- traffic-summary: 1,268 measured calls since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints; 565 failures/signals; observed spend `$7.15`; bill-bounded money loss `$0.07` (`1.0%` of observed spend; stored exact `$0.073875`); provider-recognized `$0.05`; recognition gap `$0.02`; time loss `~2.9 min`; at-rate translation `$4.449810`; invoice-check exposure `$16.80` across 202 signals; surfaces watched 12/13. Invoice-check exposure is separate and not summed into money loss.
- capture-hash: `sha256:0cffbac1ead196edc61d99199f9941bb4e4b8ae35c9144b9363da237996f6b11` (`dashboard-real-traffic.png`, 201,317 bytes).
- asset-dimensions: 2200 x 1568 PNG.
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead where paths appear; watermark is `github.com/inferock/inferock-bench`.
- masking-check: provider-key panel and capture-only interactive controls hidden; rendered pixels checked for local bench keys, provider keys, host-user paths, settled dashboard state, four-element one-line headline labels, clipped 1100px content-column framing, shared-grid previous-results ledger row alignment, previous-results ledger crop, and watermark correctness.
- human-sign-off: pending user sign-off, 2026-07-10.
- masked-verified: 2026-07-10 by maintainer visual inspection (25th; headline-% + gloss re-render 61b312b @2200x1568, four-criteria + masking + GitHub-width legibility pass; capture invariants CI-asserted)

### `receipt-real-traffic.png`

- public-run-id: `inferock-bench-0.1.10-cumulative-ledger-2026-07-09-through-run15-2026-07-10`.
- package-version: `inferock-bench` 0.1.10.
- source: Terminal-style PNG rendered by Playwright from the post-merge `src/index.ts receipt --compact` output against the cumulative event store. Receipt path sanitized to `~/.inferock-bench`; watermark overlaid during rendering.
- traffic-summary: 1,268 measured calls since 2026-07-09 across OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter endpoints; 565 failures/signals; observed spend `$7.15`; bill-bounded money loss `$0.07` (stored exact `$0.073875`); provider-recognized `$0.05`; recognition gap `$0.02`; time loss `~2.9 min`; at-rate translation `$4.449810`; invoice-check exposure `$16.80` across 202 signals; surfaces watched 12/13. Invoice-check exposure is separate and not summed into money loss.
- asset-dimensions: 1440 x 1100 PNG.
- asset-masking: key panel hidden; no `ibl_`/`sk-` strings; no `/home/*`, `/Users/*`, or `ec2-user`; `~/.inferock-bench` rendered instead; watermark is `github.com/inferock/inferock-bench`.
- masking-check: rendered receipt checked for local bench keys, provider keys, host-user paths, sanitized receipt path, four-element headline, and watermark correctness.
- human-sign-off: pending user sign-off, 2026-07-10.
- masked-verified: 2026-07-10 by maintainer visual inspection (24th lineage; 4-element headline, % line, exposure detail, ~ paths, watermark, zero key shapes confirmed per-image)

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
