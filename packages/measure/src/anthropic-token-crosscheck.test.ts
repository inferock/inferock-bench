import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
  ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
  ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  buildAnthropicTokenCrossCheckSignal,
  createAnthropicTokenCalibrationCache,
  crossCheckAnthropicOutputTokens,
  estimateAnthropicOfflineOutputTokens,
} from "./anthropic-token-crosscheck.js";
import { applyStandardLossEconomicsToSignals } from "./standard-loss.js";

describe("Anthropic token cross-check", () => {
  it("anthropic-crosscheck-count-tokens-verified-dollarized: subtracts thinking and calibrated overhead before pricing the delta", () => {
    const content = "Here is a concise answer with enough visible output to price.";
    const model = "claude-haiku-4-5-20251001";
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-anthropic-crosscheck",
        provider: "anthropic",
        model,
        requestId: "req-anthropic-verified-dollarized",
      },
      response: { content },
      usage: {
        input: 100,
        output: 112,
      },
    });
    const eventWithThinking = {
      ...event,
      usage: {
        ...event.usage,
        categories: [
          { category: "provider:anthropic:output_tokens_details.thinking_tokens", tokens: 12 },
        ],
      },
    };

    const crossCheck = crossCheckAnthropicOutputTokens(eventWithThinking, {
      countTokens: {
        outputTokens: 78,
        source: "anthropic.messages.count_tokens",
      },
      calibration: {
        model,
        status: "verified",
        sampleCount: 8,
        minSampleCount: 8,
        ratio: 1.38,
        overheadTokens: 3,
        toleranceTokens: 10,
        provenance: {
          source: "runtime_count_tokens",
          countTokensSource: "anthropic.messages.count_tokens",
          localEstimator: "Xenova/claude-tokenizer",
          localEstimatorRevision: "cae688821ea05490de49a6d3faa36468a4672fad",
          updatedAt: "2026-07-04T12:00:00.000Z",
        },
      },
    });

    expect(crossCheck).toMatchObject({
      provider: "anthropic",
      mode: "count_tokens_recount",
      methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
      billedOutputTokens: 112,
      thinkingTokens: 12,
      billedVisibleOutputTokens: 100,
      countedOutputTokens: 78,
      overheadTokens: 3,
      recountedVisibleOutputTokens: 75,
      toleranceTokens: 10,
      billedVsRecountDeltaTokens: 25,
      overBilledOutputTokens: 25,
      outputRateUsdPerMillion: 5,
      overchargeUsd: 0.000125,
      evidenceGradeCap: "B",
      caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
    });

    const signal = buildAnthropicTokenCrossCheckSignal(eventWithThinking, crossCheck);
    expect(signal).toMatchObject({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      status: "candidate",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: 0,
      valueJson: {
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        standardLossUsd: 0.000125,
        providerRecognizedLossUsd: 0,
        recognitionGapUsd: 0.000125,
      },
      evidence: {
        mode: "count_tokens_recount",
        billedVisibleOutputTokens: 100,
        recountedVisibleOutputTokens: 75,
        overBilledOutputTokens: 25,
        overchargeUsd: 0.000125,
        evidenceGradeCap: "B",
        caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
      },
    });

    const [enriched] = applyStandardLossEconomicsToSignals(eventWithThinking, signal ? [signal] : []);
    expect(enriched).toMatchObject({
      standardLossUsd: 0.000125,
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: 0.000125,
      evidenceGrade: "unrecognized_standard_loss",
      computationTrace: {
        methodId: ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID,
        grade: "unrecognized_standard_loss",
        inputs: {
          methodMetadata: {
            evidenceGradeCap: "B",
            caveat: ANTHROPIC_TOKEN_CROSSCHECK_CAVEAT,
          },
        },
      },
    });
  });

  it("anthropic-crosscheck-count-tokens-unverified: keeps count_tokens evidence in gross-bound posture", () => {
    const content = "Here is a concise, ordinary answer with enough text for the billed output.";
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-anthropic-crosscheck",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-anthropic-plausible",
      },
      response: { content },
      usage: {
        input: 10,
        output: 20,
      },
    });

    const crossCheck = crossCheckAnthropicOutputTokens(event, {
      countTokens: {
        outputTokens: 20,
        source: "anthropic.messages.count_tokens",
      },
      calibration: {
        model: "claude-haiku-4-5-20251001",
        status: "unverified",
        sampleCount: 1,
        minSampleCount: 8,
        provenance: {
          source: "runtime_count_tokens",
          countTokensSource: "anthropic.messages.count_tokens",
          localEstimator: "Xenova/claude-tokenizer",
          localEstimatorRevision: "cae688821ea05490de49a6d3faa36468a4672fad",
          updatedAt: "2026-07-04T12:00:00.000Z",
        },
      },
    });

    expect(crossCheck).toMatchObject({
      provider: "anthropic",
      mode: "fallback_safe_bound",
      billedOutputTokens: 20,
      countedOutputTokens: 20,
      responseChars: Array.from(content).length,
      calibrationStatus: "unverified",
      fallbackReason: "count_tokens_calibration_unverified",
      withinBound: true,
      disputeEligible: false,
      note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
    });
    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toBeNull();
  });

  it("anthropic-crosscheck-offline-estimator: labels Xenova estimates approximate and calibrates per model from runtime samples", () => {
    const cache = createAnthropicTokenCalibrationCache({ minSampleCount: 3 });
    const model = "claude-haiku-4-5-20251001";
    const text = "Small calibration sample.";
    const localEstimate = estimateAnthropicOfflineOutputTokens(text);

    expect(localEstimate.tokens).toBeGreaterThan(0);
    expect(estimateAnthropicOfflineOutputTokens("hello world").tokens).toBe(2);
    expect(localEstimate).toMatchObject({
      estimator: "Xenova/claude-tokenizer",
      revision: "cae688821ea05490de49a6d3faa36468a4672fad",
      approximate: true,
    });

    expect(cache.addCountTokensSample({
      model,
      deliveredOutputContent: text,
      billedVisibleOutputTokens: 11,
      countedOutputTokens: 14,
      countTokensSource: "anthropic.messages.count_tokens",
      observedAt: "2026-07-04T12:00:00.000Z",
    }).status).toBe("unverified");
    expect(cache.addCountTokensSample({
      model,
      deliveredOutputContent: "Second calibration sample.",
      billedVisibleOutputTokens: 12,
      countedOutputTokens: 15,
      countTokensSource: "anthropic.messages.count_tokens",
      observedAt: "2026-07-04T12:01:00.000Z",
    }).status).toBe("unverified");
    const verified = cache.addCountTokensSample({
      model,
      deliveredOutputContent: "Third calibration sample.",
      billedVisibleOutputTokens: 13,
      countedOutputTokens: 16,
      countTokensSource: "anthropic.messages.count_tokens",
      observedAt: "2026-07-04T12:02:00.000Z",
    });

    expect(verified).toMatchObject({
      model,
      status: "verified",
      sampleCount: 3,
      minSampleCount: 3,
      overheadTokens: 3,
      provenance: {
        source: "runtime_count_tokens",
        countTokensSource: "anthropic.messages.count_tokens",
        localEstimator: "Xenova/claude-tokenizer",
        localEstimatorRevision: "cae688821ea05490de49a6d3faa36468a4672fad",
      },
    });
    expect(verified.ratio).toBeGreaterThan(0);
    expect(verified.toleranceTokens).toBeGreaterThanOrEqual(0);
  });

  it("anthropic-crosscheck-count-tokens-overage-flags-triage-only: unverified provider recount overages stay fallback-only", () => {
    const content = "complete answer";
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-anthropic-crosscheck",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-anthropic-gross",
      },
      response: { content },
      usage: {
        input: 10,
        output: 200,
      },
    });

    const crossCheck = crossCheckAnthropicOutputTokens(event, {
      countTokens: {
        outputTokens: 14,
        source: "anthropic.messages.count_tokens",
      },
    });
    const responseChars = Array.from(content).length;
    const outputTokenUpperBound = Math.ceil(
      responseChars * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
    ) + ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;

    expect(crossCheck.withinBound).toBe(false);
    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toMatchObject({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      failureClass: "anthropic_token_crosscheck",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      providerRecoverableLossUsd: null,
      evidence: {
        mode: "fallback_safe_bound",
        billedOutputTokens: 200,
        countedOutputTokens: 14,
        responseChars,
        outputTokenUpperBound,
        overBoundTokens: 200 - outputTokenUpperBound,
        note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
      },
    });
  });

  it("anthropic-crosscheck-fallback-safe-cjk-emoji: does not false-flag dense text without count_tokens", () => {
    const content = "안녕하세요😊😊";
    const outputTokens = 40;
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-anthropic-crosscheck",
        provider: "anthropic",
        model: "claude-opus-4-8",
        requestId: "req-anthropic-cjk-emoji",
      },
      response: { content },
      usage: {
        input: 10,
        output: outputTokens,
      },
    });

    const crossCheck = crossCheckAnthropicOutputTokens(event, {
      fallbackReason: "count_tokens_unavailable",
    });

    expect(crossCheck).toMatchObject({
      mode: "fallback_safe_bound",
      fallbackReason: "count_tokens_unavailable",
      outputTokenUpperBound: Math.ceil(
        Array.from(content).length * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
      ) + ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
      withinBound: true,
      disputeEligible: false,
    });
    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toBeNull();
  });

  it("anthropic-crosscheck-fallback-gross-overbilling-flags: keeps fallback findings triage-only", () => {
    const content = "complete answer";
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-anthropic-crosscheck",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-anthropic-fallback-gross",
      },
      response: { content },
      usage: {
        input: 10,
        output: 200,
      },
    });

    const crossCheck = crossCheckAnthropicOutputTokens(event, {
      fallbackReason: "count_tokens_disabled",
    });
    const outputTokenUpperBound = Math.ceil(
      Array.from(content).length * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
    ) + ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;

    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toMatchObject({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      failureClass: "anthropic_token_crosscheck",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      providerRecoverableLossUsd: null,
      evidence: {
        mode: "fallback_safe_bound",
        billedOutputTokens: 200,
        outputTokenUpperBound,
        boundMultiplier: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
        fallbackOverheadTokens: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
        fallbackReason: "count_tokens_disabled",
        overBoundTokens: 200 - outputTokenUpperBound,
        note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
      },
    });
  });
});
