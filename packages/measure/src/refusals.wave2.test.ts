import type { CanonicalEventV1 } from "./canonical-event.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  registerObservedCharge,
  resetBillingIntegrityState,
} from "./billing-integrity.js";
import { detectRefusal } from "./refusals.js";
import { runStatelessDetectors } from "./stateless.js";

const TENANT_ID = "tenant-refusal-wave2";
const ANTHROPIC_MODEL = "claude-fable-5";

afterEach(() => {
  resetBillingIntegrityState();
});

describe("wave2 Anthropic refusal billing invariants", () => {
  it("anthropic-pre-output-refusal-unbilled: emits provider-native standard floor without provider recognition", () => {
    const event = anthropicRefusalEvent({
      requestId: "req-anthropic-pre-output-refusal",
      content: "",
      output: 2,
    });

    expect(detectRefusal(event)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      status: "triage_only",
      evidenceGrade: "triage_only",
      providerRecoverableLossUsd: 0,
      evidence: {
        refusalDetectionSource: "provider_native",
        refusalBillingMode: "pre_output_without_observed_charge",
      },
    });
    const [signal] = runStatelessDetectors(event);
    expect(signal).toMatchObject({
      code: "REFUSAL_BILLED",
      standardLossStatus: "computed",
      standardLossGrade: "unrecognized_standard_loss",
      evidenceGrade: "unrecognized_standard_loss",
      providerRecognizedLossUsd: 0,
      recognitionGapUsd: signal?.standardLossUsd,
      computationTrace: {
        method: "call_cost_floor_v1",
        basis: "failed_to_deliver_usable_output",
      },
    });
    expect(runStatelessDetectors(event).map((signal) => signal.code)).not.toContain(
      "BILLED_EMPTY",
    );
  });

  it("anthropic-mid-stream-refusal: keeps partial-output refusals as refundable candidates", () => {
    const event = anthropicRefusalEvent({
      requestId: "req-anthropic-mid-stream-refusal",
      content: "Here is partial output that must be discarded.",
      output: 12,
    });

    expect(detectRefusal(event)).toMatchObject({
      code: "REFUSAL_BILLED",
      failureClass: "refusal",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      evidence: {
        tier: "provider_anthropic",
        refusalBillingMode: "mid_stream_billed",
      },
    });
  });

  it("anthropic-pre-output-refusal-billed-invariant: emits only when observed charge evidence exists", () => {
    const event = anthropicRefusalEvent({
      requestId: "req-anthropic-pre-output-billed",
      content: "",
      output: 0,
    });
    registerObservedCharge({
      tenantId: TENANT_ID,
      provider: "anthropic",
      requestId: "req-anthropic-pre-output-billed",
      chargedUsd: 0.00412,
    });

    const signal = detectRefusal(event);

    expect(signal).toMatchObject({
      code: "REFUSAL_PREOUTPUT_BILLED_INVARIANT",
      failureClass: "refusal",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      observedChargeUsd: 0.00412,
      expectedChargeUsd: 0,
      providerRecoverableLossUsd: 0.00412,
      evidence: {
        provider: "anthropic",
        finishReason: "refusal",
        contentEmpty: true,
        chargeEvidence: "observed_charge",
        documentedExpectedChargeUsd: 0,
        documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback",
      },
    });
  });
});

function anthropicRefusalEvent(input: {
  readonly requestId: string;
  readonly content: string;
  readonly output: number;
}): CanonicalEventV1 {
  return buildCanonicalEvent({
    request: {
      tenantId: TENANT_ID,
      provider: "anthropic",
      model: ANTHROPIC_MODEL,
      requestId: input.requestId,
      expectCompletion: true,
    },
    response: {
      finishReason: "refusal",
      content: input.content,
    },
    usage: {
      input: 412,
      output: input.output,
      cache: { read: 0, creation: 0 },
    },
  });
}
