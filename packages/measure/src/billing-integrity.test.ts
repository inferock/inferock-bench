import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
  ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
  ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  buildAnthropicTokenCrossCheckSignal,
  crossCheckAnthropicOutputTokens,
} from "./anthropic-token-crosscheck.js";
import {
  buildCacheRateAnomalySignal,
  buildDuplicateRequestIdSignal,
  countOpenAiOutputTokens,
  detectOpenAiTokenRecount,
} from "./billing-integrity.js";

describe("billing integrity pure helpers", () => {
  it("duplicate-request-id-triage-only-signal: builds duplicate request id signals as non-credit triage evidence", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-duplicate-helper",
      },
    });

    expect(buildDuplicateRequestIdSignal(event, {
      originalEventId: "event-1",
      originalEventTime: "2026-06-14T12:00:00.000Z",
      duplicateEventId: "event-2",
      duplicateEventTime: "2026-06-14T12:00:01.000Z",
      duplicateRank: 2,
      duplicateCount: 3,
    })).toMatchObject({
      code: "DUPLICATE_REQUEST_ID",
      domain: "usage",
      failureClass: "duplicate_request_id",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      liabilityParty: "unknown",
      valueKind: "triage",
      observedChargeUsd: null,
      expectedChargeUsd: null,
      providerRecoverableLossUsd: null,
      evidence: {
        requestId: "req-duplicate-helper",
        reason: "requestId was observed more than once for tenant/provider",
        detectionBasis: "tenant_provider_request_id",
        duplicateEventId: "event-2",
        duplicateEventTime: "2026-06-14T12:00:01.000Z",
      },
      valueJson: {
        originalEventId: "event-1",
        originalEventTime: "2026-06-14T12:00:00.000Z",
        duplicateRank: 2,
        duplicateCountAtDetection: 3,
      },
    });
    expect(buildDuplicateRequestIdSignal(event, {
      originalEventId: "event-1",
      duplicateEventId: "event-2",
      duplicateRank: 2,
      duplicateCount: 3,
    }).evidence).not.toHaveProperty("duplicateCount");
    expect(buildDuplicateRequestIdSignal(event, {
      originalEventId: "event-1",
      duplicateEventId: "event-2",
      duplicateRank: 2,
      duplicateCount: 3,
    }).evidence).not.toHaveProperty("originalEventId");
  });

  it("builds cache anomaly signals from observed durable charges", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-cache-helper",
      },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 20_000, creation: 0 },
      },
    });

    const signal = buildCacheRateAnomalySignal(event, {
      chargedUsd: 0.01,
      source: "provider_invoice",
      dashboardEligible: true,
      observedAt: "2026-06-14T12:00:00.000Z",
    });

    expect(signal).toMatchObject({
      code: "CACHE_RATE_ANOMALY",
      failureClass: "cache_rate_anomaly",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "priced",
      observedChargeUsd: 0.01,
      expectedChargeUsd: 0.0015,
      providerRecoverableLossUsd: 0.0085,
      evidence: {
        cacheReadTokens: 20_000,
        expectedUsd: 0.0015,
        chargedUsd: 0.01,
        source: "provider_invoice",
      },
    });
  });

  it("builds pricing_unknown triage signals instead of suppressing cache evidence", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "openai",
        model: "unknown-cache-model",
        requestId: "req-cache-unknown",
      },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 20_000, creation: 0 },
      },
    });

    const signal = buildCacheRateAnomalySignal(event, {
      chargedUsd: 0.01,
      source: "provider_invoice",
      dashboardEligible: true,
      observedAt: "2026-06-14T12:00:00.000Z",
    });

    expect(signal).toMatchObject({
      code: "PRICING_UNKNOWN",
      detector: "pricing",
      failureClass: "pricing_unknown",
      status: "pricing_unknown",
      pricingStatus: "pricing_unknown",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      evidence: {
        provider: "openai",
        model: "unknown-cache-model",
        usageCategories: ["cache_read"],
        observedChargeUsd: 0.01,
        observedChargeSource: "provider_invoice",
      },
    });
  });

  it("exports OpenAI token recount as a deterministic per-event detector", () => {
    const content = "hello world";
    const recounted = countOpenAiOutputTokens("gpt-4o-mini", content);
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-recount-helper",
      },
      response: { content },
      usage: {
        input: 1,
        output: recounted + 5,
      },
    });

    expect(detectOpenAiTokenRecount(event)).toMatchObject({
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      failureClass: "token_recount_mismatch",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      evidence: {
        billedOutputTokens: recounted + 5,
        recountedOutputTokens: recounted,
        encodingVerified: true,
      },
    });
  });

  it("keeps OpenAI token recounts triage-only when the tokenizer mapping is inferred", () => {
    const model = "gpt-5.4-mini";
    const content = "hello world";
    const recounted = countOpenAiOutputTokens(model, content);
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "openai",
        model,
        requestId: "req-recount-inferred-tokenizer",
      },
      response: { content },
      usage: {
        input: 1,
        output: recounted + 5,
      },
    });

    expect(detectOpenAiTokenRecount(event)).toMatchObject({
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      failureClass: "token_recount_mismatch",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      pricingStatus: "priced",
      evidence: {
        billedOutputTokens: recounted + 5,
        recountedOutputTokens: recounted,
        overchargeUsd: null,
        encodingVerified: false,
        tokenizerFallbackReason: "model encoding inferred; refundable dollars suppressed",
      },
    });
    expect(detectOpenAiTokenRecount(event)?.evidence.tokenizerFallbackEstimatedOverchargeUsd)
      .toBeGreaterThan(0);
  });

  it("converts gross Anthropic cross-check overages into non-dispute loss signals", () => {
    const content = "complete answer";
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-billing-helper",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-anthropic-helper",
      },
      response: { content },
      usage: {
        input: 1,
        output: 200,
      },
    });
    const crossCheck = crossCheckAnthropicOutputTokens(event);
    const responseChars = Array.from(content).length;
    const outputTokenUpperBound = Math.ceil(
      responseChars * ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
    ) + ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS;

    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toMatchObject({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      failureClass: "anthropic_token_crosscheck",
      dispute: false,
      evidence: {
        mode: "fallback_safe_bound",
        billedOutputTokens: 200,
        responseChars,
        outputTokenUpperBound,
        boundMultiplier: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_CHAR_BOUND_MULTIPLIER,
        fallbackOverheadTokens: ANTHROPIC_OUTPUT_TOKEN_FALLBACK_OVERHEAD_TOKENS,
        overBoundTokens: 200 - outputTokenUpperBound,
        note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
      },
      valueJson: {
        mode: "fallback_safe_bound",
        billedVisibleOutputTokens: 200,
        outputTokenUpperBound,
        overBoundTokens: 200 - outputTokenUpperBound,
        pricingStatus: "not_priced",
      },
    });
  });
});
