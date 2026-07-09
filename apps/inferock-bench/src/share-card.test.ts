import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalEventAny, CanonicalEventV2 } from "@inferock/measure/canonical-event";
import { countOpenAiOutputTokens } from "@inferock/measure/billing-integrity";
import { createReceiptBundle } from "./receipt.js";
import {
  createShareCardModel,
  renderShareCard,
  SHARE_CARD_FOOTER,
} from "./share-card.js";
import { summarizeBenchEvents } from "./summary.js";
import type { StoredBenchEvent } from "./storage.js";

const SHARE_CARD_FIXTURE_DIR = new URL("./__fixtures__/share-card/", import.meta.url);

describe("share card", () => {
  it("renders the clean-run case as a first-class share card", () => {
    const receipt = createReceiptBundle(summarizeBenchEvents([stored(v2Event())]));

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("$0.00 lost across 1 calls — receipts to prove it");
    expect(rendered).toContain("standard loss: $0.00");
    expect(rendered).toContain("provider-recognized: $0.00");
    expect(rendered).toContain("recognition gap: $0.00");
    expect(rendered).toContain("surfaces watched");
    expect(rendered).toContain("keys stayed local");
    expect(rendered).toContain(SHARE_CARD_FOOTER);
  });

  it("uses the one-decimal percent headline for a sanitized measured receipt", () => {
    const receipt = measuredReceipt("benchtest-017r3-receipt.json");

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("65.4% of observed spend failed the Inferock Standard");
    expect(rendered).not.toContain("standard loss; provider-recognized");
    expectEveryLineAtMost(rendered, 68);
  });

  it("falls back to the dollar headline when percent exceeds 100", () => {
    const receipt = measuredReceipt("benchtest-017-aggregate-receipt.json");

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("$4.62 standard loss on failed LLM calls");
    expect(rendered).not.toContain("% of observed spend failed");
  });

  it("falls back to the dollar headline when percent would round to 0.0", () => {
    const receipt = measuredReceipt("r6-speedtest-receipt.json");
    const highSpendReceipt = measuredReceipt("benchtest-017-aggregate-receipt.json");
    if (!receipt.totals.money) throw new Error("fixture missing money totals");
    receipt.totals.providerSpendUsd = highSpendReceipt.totals.providerSpendUsd;
    receipt.totals.money.providerSpendUsd = highSpendReceipt.totals.providerSpendUsd;
    delete receipt.totals.duration;

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("$0.000531 standard loss on failed LLM calls");
    expect(rendered).not.toContain("0.0% of observed spend failed");
  });

  it("keeps latency and downtime time-primary", () => {
    const receipt = measuredReceipt("r6-speedtest-receipt.json");

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(receipt.totals.money?.standardLossUsd).toBeGreaterThan(0);
    expect(rendered).toContain("~13s time lost");
    expect(rendered).toContain("time lost: ~13s");
    expect(rendered).toContain("standard loss: $0.000531");
    expect(rendered).toContain("provider-recognized time: ~0s");
    expect(rendered).toContain("time gap: ~13s");
    expect(rendered).toContain("approx $0.32 at your rate");
    expect(rendered).not.toContain("% of observed spend failed");
    expect(rendered).not.toContain("standard loss on failed LLM calls");
    expect(rendered).not.toContain("money and time");
  });

  it("renders pricing unknown as add-model-price work, not zero-dollar no-loss", () => {
    const receipt = createReceiptBundle(summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-pricing-unknown-json",
          model: "missing-model-price",
          requestedModel: "missing-model-price",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
    ]));

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 96 });

    expect(rendered).toContain("standard loss not in receipt");
    expect(rendered).toContain("standard loss: pricing unknown - add model price");
    expect(rendered.replace(/\s+/gu, " ")).toContain("pricing unknown — add model price");
    expect(rendered).not.toContain("% of observed spend failed");
    expect(rendered).not.toContain("standard loss on failed LLM calls");
    expect(rendered).not.toContain("$0.00 lost across 1 calls — receipts to prove it");
    expect(rendered).not.toContain("standard loss: $0.00");
  });

  it("labels a known dollar floor when additional failures are unpriced", () => {
    const receipt = createReceiptBundle(summarizeBenchEvents([
      stored(v2Event({
        request: {
          requestId: "req-priced-json",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
      stored(v2Event({
        request: {
          requestId: "req-unpriced-json",
          model: "missing-model-price",
          requestedModel: "missing-model-price",
          generation: { response_format: { type: "json_object" } },
        },
        response: {
          content: "not json",
        },
      })),
    ]));

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 96 });

    expect(rendered).toContain("standard loss on failed LLM calls (+1 unpriced)");
    expect(rendered).toContain("(+1 unpriced failures)");
    expect(rendered).not.toContain("% of observed spend failed");
  });

  it("does not invent provider-recognized dollars when the field is absent", () => {
    const receipt = measuredReceipt("benchtest-017r3-receipt.json");
    if (!receipt.totals.money) throw new Error("fixture missing money totals");
    delete receipt.totals.money.providerRecognizedUsd;

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("provider-recognized: provider-recognized not in receipt");
  });

  it("does not clamp a negative derived recognition gap to zero", () => {
    const receipt = measuredReceipt("benchtest-017r3-receipt.json");
    if (!receipt.totals.money?.standardLossUsd) throw new Error("fixture missing standard loss");
    receipt.totals.money.providerRecognizedUsd = receipt.totals.money.standardLossUsd * 2;
    delete receipt.totals.money.recognitionGapUsd;

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).toContain("recognition gap: gap not in receipt");
    expect(rendered).not.toContain("recognition gap: $0.00");
  });

  it("omits coverage instead of claiming cleanliness when coverage is absent", () => {
    const receipt = measuredReceipt("benchtest-017r3-receipt.json");
    delete receipt.coverage;

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 68 });

    expect(rendered).not.toContain("surfaces watched");
    expect(rendered).not.toContain("clean");
  });

  it("renders the static canonical footer for legacy receipts", () => {
    const legacyReceipt = {
      schemaVersion: "inferock-bench-receipt-v1",
      title: "legacy zero receipt",
      generatedAt: "2026-07-04T00:00:00.000Z",
      totals: {
        measuredCalls: 1,
        failures: 0,
        standardLossUsd: 0,
        totalLostUsd: 0,
        providerRecognizedUsd: 0,
        recognitionGapUsd: 0,
        unrecognizedUsd: 0,
        providerSpendUsd: 0,
      },
      watermark: {
        name: "legacy",
        url: "https://legacy.example.invalid",
      },
    };

    const rendered = renderShareCard(createShareCardModel(legacyReceipt), { width: 68 });

    expect(rendered).toContain(SHARE_CARD_FOOTER);
    expect(rendered).not.toContain("legacy.example.invalid");
  });

  it("does not invent migrated values for sparse legacy receipts", () => {
    const legacyReceipt = {
      schemaVersion: "inferock-bench-receipt-v1",
      title: "legacy sparse receipt",
      generatedAt: "2026-07-04T00:00:00.000Z",
    };

    const rendered = renderShareCard(createShareCardModel(legacyReceipt), { width: 68 });

    expect(rendered).toContain("standard loss not in receipt");
    expect(rendered).toContain("provider-recognized: provider-recognized not in receipt");
    expect(rendered).toContain("recognition gap: gap not in receipt");
    expect(rendered).toContain("top cause: failure rows not in receipt");
    expect(rendered).toContain(SHARE_CARD_FOOTER);
    expect(rendered).not.toContain("$0.00 lost across");
    expect(rendered).not.toContain("surfaces watched 0/0");
  });

  it("truncates long selected model names within the configured width", () => {
    const receipt = measuredReceipt("r7-speedtest-receipt.json");
    if (!receipt.run) throw new Error("fixture missing run");
    receipt.run.selectedModels = [{
      provider: "openai",
      model: "gpt-very-long-frontier-model-name-with-audit-suffix-and-routing-metadata",
    }];

    const rendered = renderShareCard(createShareCardModel(receipt), { width: 54 });

    expect(rendered).toContain("…");
    expectEveryLineAtMost(rendered, 54);
  });
});

interface FixtureReceipt extends Record<string, unknown> {
  readonly schemaVersion: string;
  totals: {
    providerSpendUsd?: number;
    money?: {
      standardLossUsd?: number;
      providerRecognizedUsd?: number;
      recognitionGapUsd?: number;
      unrecognizedUsd?: number;
      providerSpendUsd?: number;
    };
    duration?: {
      timeLossMs?: number;
      providerRecognizedTimeLossMs?: number;
      recognitionGapTimeMs?: number;
      dollarTranslationUsd?: number;
    };
    measuredCalls?: number;
    failures?: number;
  };
  coverage?: Record<string, unknown>;
  run?: {
    selectedModels?: { provider: string; model: string }[];
  };
}

function measuredReceipt(fileName: string): FixtureReceipt {
  return JSON.parse(readFileSync(new URL(fileName, SHARE_CARD_FIXTURE_DIR), "utf8")) as FixtureReceipt;
}

function expectEveryLineAtMost(rendered: string, width: number): void {
  for (const line of rendered.split("\n")) {
    expect([...line].length).toBeLessThanOrEqual(width);
  }
}

function stored(
  event: CanonicalEventAny,
  metadata: Partial<Pick<StoredBenchEvent, "runId" | "suiteTaskId">> = {},
): StoredBenchEvent {
  return {
    schemaVersion: "inferock-bench-event-v1",
    capturedAt: "2026-06-14T12:00:02.000Z",
    ...metadata,
    event,
  };
}

type V2Overrides = {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly response?: Partial<CanonicalEventV2["response"]>;
  readonly usage?: Partial<CanonicalEventV2["usage"]>;
  readonly timing?: Partial<CanonicalEventV2["timing"]>;
  readonly attempts?: CanonicalEventV2["attempts"];
};

function v2Event(overrides: V2Overrides = {}): CanonicalEventV2 {
  const request = {
    tenantId: "tenant-bench",
    provider: "openai" as const,
    requestId: "req-bench",
    requestedModel: "gpt-4o-mini",
    model: "gpt-4o-mini",
    attemptIndex: 0,
    expectCompletion: true,
    route: "chat.completions",
    workloadClass: "interactive",
    ...overrides.request,
  };
  const response = {
    statusCode: 200,
    finishReason: "stop",
    content: "completed",
    servedModel: request.model ?? request.requestedModel,
    ...overrides.response,
  };
  const outputTokens = request.provider === "openai"
    ? countOpenAiOutputTokens(request.model ?? request.requestedModel ?? "gpt-4o-mini", response.content)
    : 10;
  const usage = {
    input: 100,
    output: outputTokens,
    cache: { read: 0, creation: 0 },
    categories: [
      { category: "input", tokens: 100, provider: request.provider },
      { category: "output", tokens: outputTokens, provider: request.provider },
    ],
    usageSource: "provider" as const,
    ...overrides.usage,
  };
  const timing = {
    startedAt: "2026-06-14T12:00:00.000Z",
    endedAt: "2026-06-14T12:00:01.000Z",
    latencyMs: 1_000,
    chunkCount: 0,
    terminalStatus: "complete" as const,
    ...overrides.timing,
  };
  return {
    schemaVersion: "v2",
    request,
    response,
    usage,
    timing,
    attempts: overrides.attempts ?? [{
      attemptNumber: 0,
      provider: request.provider,
      model: request.model ?? request.requestedModel,
      status: "success",
      timing: {
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        latencyMs: timing.latencyMs,
      },
      finalSelected: true,
    }],
  };
}
