import type { ConformanceArtifactWriter } from "./artifacts.js";
import {
  hiddenTokenLedgerEntry,
  hiddenTokenProbes,
  type HiddenTokenProbe,
  type HiddenTokenProviderCallResult,
} from "./hidden-token.js";
import type { ConformanceLedgerEntry } from "./types.js";
import { validationEligibility } from "./types.js";

export interface RunHiddenTokenFixtureControlsInput {
  readonly runId: string;
  readonly writer?: ConformanceArtifactWriter;
  readonly providers: readonly HiddenTokenProbe["provider"][];
}

export interface RunHiddenTokenFixtureControlsResult {
  readonly entries: readonly ConformanceLedgerEntry[];
}

export async function runHiddenTokenFixtureControls(
  input: RunHiddenTokenFixtureControlsInput,
): Promise<RunHiddenTokenFixtureControlsResult> {
  const probes = hiddenTokenProbes({
    providers: input.providers,
    models: {
      openai: {
        positive: "fixture-openai-reasoning",
        negative: "fixture-openai-visible",
      },
      anthropic: {
        positive: "fixture-anthropic-thinking",
        negative: "fixture-anthropic-visible",
      },
    },
  });
  const entries: ConformanceLedgerEntry[] = [];
  for (const probe of probes) {
    const result = hiddenTokenFixtureResult(probe);
    const baseEntry = hiddenTokenLedgerEntry({
      runId: input.runId,
      probe,
      result,
    });
    const entry: ConformanceLedgerEntry = {
      ...baseEntry,
      mode: "fixture_control",
      validationMetadata: [
        ...new Set([...baseEntry.validationMetadata, "synthetic_fixture_control"]),
      ],
      ...validationEligibility({ standardLossEligible: false }),
      rawEvidence: {
        ...baseEntry.rawEvidence,
        fixtureControl: "hidden_token_usage_mapping",
      },
      detectors: {
        ...baseEntry.detectors,
        fixtureControl: "hidden_token_usage_mapping",
      },
    };
    if (input.writer) {
      await input.writer.writeRawJson(probe.probeId, "usage", result.rawUsage);
      await input.writer.appendLedger(entry);
    }
    entries.push(entry);
  }
  return { entries };
}

function hiddenTokenFixtureResult(probe: HiddenTokenProbe): HiddenTokenProviderCallResult {
  const base = {
    requestId: `${probe.probeId}-request`,
    startedAt: "2026-07-08T12:00:00.000Z",
    endedAt: "2026-07-08T12:00:01.000Z",
    statusCode: 200,
    content: probe.kind === "positive" ? "" : "Visible fixture answer.",
    finishReason: "stop",
    responseId: `${probe.probeId}-response`,
  } as const;

  if (probe.providerSurface === "openai_responses") {
    return {
      ...base,
      rawUsage: {
        input_tokens: 12,
        output_tokens: 9,
        output_tokens_details: { reasoning_tokens: 9 },
        total_tokens: 21,
      },
    };
  }
  if (probe.providerSurface === "chat_completions") {
    const reasoningTokens = probe.kind === "positive" ? 7 : 0;
    return {
      ...base,
      rawUsage: {
        prompt_tokens: 12,
        completion_tokens: reasoningTokens > 0 ? reasoningTokens : 3,
        total_tokens: reasoningTokens > 0 ? 19 : 15,
        ...(reasoningTokens > 0
          ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } }
          : {}),
      },
    };
  }
  const thinkingTokens = probe.kind === "positive" ? 11 : 0;
  return {
    ...base,
    rawUsage: {
      input_tokens: 12,
      output_tokens: thinkingTokens > 0 ? thinkingTokens : 3,
      ...(thinkingTokens > 0
        ? { output_tokens_details: { thinking_tokens: thinkingTokens } }
        : {}),
    },
  };
}
