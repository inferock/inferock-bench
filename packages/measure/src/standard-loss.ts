import type { CanonicalEventV1 } from "./canonical-event.js";
import { ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID } from "./anthropic-token-crosscheck.js";
import {
  lookupPriceForEvent,
  roundUsd,
  tokensBilledForEvent,
  type PriceLookupResult,
  type PricingComponent,
} from "./pricing.js";
import { SLA_DEFAULTS } from "./sla-defaults.js";
import { dollarTranslationForTimeLoss } from "./time-loss.js";
import type {
  EvidenceGrade,
  LossSignal,
  LossSignalCode,
  StandardLossStatus,
} from "./types.js";

export const STANDARD_LOSS_METHOD_VERSION = "dollarcore-2026-07-04";

type StandardLossMethod =
  | "call_cost_floor_v1"
  | "call_cost_floor_superseded_v1"
  | "cache_discount_at_risk_v1"
  | "measure_specific_delta_v1"
  | typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
  | "pricing_unknown_v1"
  | "not_applicable_v1";

type StandardLossBasis =
  | "failed_to_deliver_usable_output"
  | "pricing_unknown_add_model_price"
  | "token_overcharge_delta"
  | "served_model_overcharge_delta"
  | "cache_overcharge_delta"
  | "cache_discount_at_risk"
  | "latency_time_excess"
  | "not_standard_loss";

interface StandardLossComputationTrace extends Record<string, unknown> {
  readonly method: StandardLossMethod;
  readonly methodId: StandardLossMethod;
  readonly methodVersion: string;
  readonly standardVersion: string;
  readonly basis: StandardLossBasis;
  readonly basisDetail?: string;
  readonly grade: EvidenceGrade;
  readonly confidence:
    | "priced_call_cost_floor"
    | "computed_measure_delta"
    | "floor_attributed_to_peer_signal"
    | "pricing_unknown"
    | "not_applicable";
  readonly inputs: Record<string, unknown>;
  readonly formulas: Record<string, unknown>;
  readonly outputs: {
    readonly standardLossUsd: number | null;
    readonly providerRecognizedLossUsd: number;
    readonly recognitionGapUsd: number | null;
    readonly invoiceCheckExposureUsd?: number;
    readonly invoiceCheckExposureLabel?: string;
    readonly ledgerPlacement?: string;
  };
  readonly sourceRefs: Record<string, unknown>;
  readonly oneLine: string;
}

export interface PublicTimeLossEvent {
  readonly request: CanonicalEventV1["request"] & {
    readonly operationId?: string;
    readonly bodyHash?: string;
    readonly apiKeyHash?: string;
  };
  readonly timing: CanonicalEventV1["timing"];
}

export interface PublicTimeLossSignal {
  readonly code: string;
  readonly failureClass?: string | null;
  readonly valueKind?: string;
  readonly valueJson?: Record<string, unknown>;
  readonly evidence?: Record<string, unknown>;
  readonly computationTrace?: Record<string, unknown> | null;
}

export interface PublicTimeLossSignalEntry {
  readonly event: PublicTimeLossEvent;
  readonly signal: PublicTimeLossSignal;
}

export interface PublicTimeLossInterval {
  readonly logicalOperationKey: string;
  readonly signalCode: string;
  readonly failureClass: string | null;
  readonly requestId: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly rawTimeLossMs: number;
  readonly publicTimeLossMs: number;
  readonly demoted: boolean;
  readonly demotionReason: string | null;
}

export interface PublicTimeLossTotals {
  readonly rawTimeLossMs: number;
  readonly timeLossMs: number;
  readonly providerRecognizedTimeLossMs: number;
  readonly recognitionGapTimeMs: number;
  readonly dollarTranslationUsd: number;
  readonly intervals: readonly PublicTimeLossInterval[];
}

const WHOLE_CALL_FLOOR_PRIORITY: Partial<Record<LossSignalCode, number>> = {
  PROVIDER_DOWNTIME: 600,
  REFUSAL_PREOUTPUT_BILLED_INVARIANT: 525,
  REFUSAL_BILLED: 500,
  FACTUALITY_KNOWN_ANSWER_FAIL: 475,
  ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT: 475,
  SECURITY_SECRET_EXACT_MATCH: 470,
  SERVED_MODEL_MISMATCH: 450,
  TRUNCATED: 400,
  TOOL_CHOICE_VIOLATION: 360,
  UNDECLARED_TOOL_CALL: 350,
  TOOL_CALL_STOP_REASON_MISMATCH: 340,
  TOOL_CALL_SCHEMA_VIOLATION: 330,
  MALFORMED_TOOL_CALL: 320,
  BROKEN_OUTPUT: 300,
  BILLED_EMPTY: 250,
  DUPLICATE_REQUEST_ID: 200,
};

const WHOLE_CALL_FLOOR_PEER_SIGNAL_CODES = new Set<LossSignalCode>([
  "ANTHROPIC_TOKEN_CROSSCHECK",
]);

const DELTA_SIGNAL_CODES = new Set<LossSignalCode>([
  "OPENAI_TOKEN_RECOUNT_MISMATCH",
  "ANTHROPIC_TOKEN_CROSSCHECK",
  "CACHE_RATE_ANOMALY",
  "CACHE_DISCOUNT_AT_RISK",
]);

export function applyStandardLossEconomicsToSignals(
  event: CanonicalEventV1,
  signals: readonly LossSignal[],
): LossSignal[] {
  if (signals.length === 0) return [];

  const price = lookupPriceForEvent(event);
  const floorCandidates = signals.filter(isWholeCallFloorCandidate);
  const floorWinner = selectWholeCallFloorWinner(floorCandidates);

  const enrichedSignals = signals.map((signal) =>
    standardLossSignalForInput(signal, {
      event,
      price,
      floorWinner,
      hasFloorCandidates: floorCandidates.length > 0,
    })
  );
  return applyBillBoundedMoneyLossCapForPrice(enrichedSignals, price);
}

export function applyBillBoundedMoneyLossCapToSignals(
  event: CanonicalEventV1,
  signals: readonly LossSignal[],
): LossSignal[] {
  if (signals.length === 0) return [];
  return applyBillBoundedMoneyLossCapForPrice(signals, lookupPriceForEvent(event));
}

export function publicTimeLossTotalsForSignals(
  entries: readonly PublicTimeLossSignalEntry[],
  options: { readonly rateUsdPerHour?: number } = {},
): PublicTimeLossTotals {
  const rateUsdPerHour = options.rateUsdPerHour ?? SLA_DEFAULTS.timeValueRate.usdPerHour;
  const intervals = entries
    .map((entry) => publicTimeLossInputInterval(entry, rateUsdPerHour))
    .filter((interval): interval is PublicTimeLossInputInterval => interval !== null);
  const allocated = allocatePublicTimeLoss(intervals);
  const rawTimeLossMs = sumNumbers(allocated.map((interval) => interval.rawTimeLossMs));
  const timeLossMs = sumNumbers(allocated.map((interval) => interval.publicTimeLossMs));
  const providerRecognizedTimeLossMs = sumNumbers(
    allocated.map((interval) => interval.publicProviderRecognizedTimeLossMs),
  );
  const recognitionGapTimeMs = sumNumbers(
    allocated.map((interval) => interval.publicRecognitionGapTimeMs),
  );
  const dollarTranslationUsd = roundUsd(
    sumNumbers(allocated.map((interval) => interval.publicDollarTranslationUsd)),
  );

  return {
    rawTimeLossMs,
    timeLossMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs,
    dollarTranslationUsd,
    intervals: allocated.map((interval): PublicTimeLossInterval => ({
      logicalOperationKey: interval.logicalOperationKey,
      signalCode: interval.signalCode,
      failureClass: interval.failureClass,
      requestId: interval.requestId,
      startedAt: interval.startedAt === null ? null : new Date(interval.startedAt).toISOString(),
      endedAt: interval.endedAt === null ? null : new Date(interval.endedAt).toISOString(),
      rawTimeLossMs: interval.rawTimeLossMs,
      publicTimeLossMs: interval.publicTimeLossMs,
      demoted: interval.publicTimeLossMs < interval.rawTimeLossMs,
      demotionReason: interval.publicTimeLossMs < interval.rawTimeLossMs
        ? "logical_operation_interval_already_counted"
        : null,
    })),
  };
}

function standardLossSignalForInput(
  signal: LossSignal,
  context: {
    readonly event: CanonicalEventV1;
    readonly price: PriceLookupResult;
    readonly floorWinner: LossSignal | null;
    readonly hasFloorCandidates: boolean;
  },
): LossSignal {
  if (signal.standardLossStatus && signal.computationTrace) return signal;

  const deltaUsd = measureSpecificDeltaUsd(signal);
  if (deltaUsd !== null) {
    return withComputedStandardLoss(signal, context.event, context.price, {
      method: deltaStandardLossMethod(signal),
      basis: deltaBasis(signal),
      basisDetail: deltaBasisDetail(signal),
      standardLossUsd: deltaUsd,
      providerRecognizedLossUsd: providerRecognizedUsd(signal, deltaUsd),
      grade: gradeForComputedLoss(signal, deltaUsd),
      confidence: "computed_measure_delta",
      extraInputs: deltaTraceInputs(signal),
      extraSourceRefs: deltaTraceSourceRefs(signal),
    });
  }
  if (isPricingUnknownDeltaCandidate(signal)) {
    return withPricingUnknownStandardLoss(signal, context.event, context.price);
  }

  if (isWholeCallFloorCandidate(signal)) {
    if (!isFullyPriced(context.price)) {
      return withPricingUnknownStandardLoss(signal, context.event, context.price);
    }
    if (signal !== context.floorWinner) {
      return withSupersededFloorTrace(signal, context.event, context.price, context.floorWinner);
    }
    const standardLossUsd = context.price.expectedChargeUsd;
    return withComputedStandardLoss(signal, context.event, context.price, {
      method: "call_cost_floor_v1",
      basis: "failed_to_deliver_usable_output",
      basisDetail: wholeCallFloorBasisDetail(signal),
      standardLossUsd,
      providerRecognizedLossUsd: providerRecognizedUsd(signal, standardLossUsd),
      grade: gradeForComputedLoss(signal, standardLossUsd),
      confidence: "priced_call_cost_floor",
      });
  }

  if (context.hasFloorCandidates && isWholeCallFloorPeerSignal(signal)) {
    return withSupersededFloorTrace(signal, context.event, context.price, context.floorWinner);
  }

  if (signal.severity === "loss" && signal.failureClass !== null && !context.hasFloorCandidates) {
    return withNotApplicableStandardTrace(signal, context.event, context.price);
  }

  return withNotApplicableStandardTrace(signal, context.event, context.price);
}

interface BillBoundedMoneySignal {
  readonly index: number;
  readonly signal: LossSignal;
  readonly standardLossUsd: number;
  readonly providerRecognizedLossUsd: number;
}

function applyBillBoundedMoneyLossCapForPrice(
  signals: readonly LossSignal[],
  price: PriceLookupResult,
): LossSignal[] {
  if (!isFullyPriced(price)) return [...signals];

  // Public receipt invariant: headline money loss is bill-bounded to observed spend.
  // See oss/public-root/docs/hard-questions.md Q1 and docs/MEASUREMENT-DECISION-RECORD.md 2026-07-09.
  const capUsd = roundUsd(price.expectedChargeUsd);
  const moneySignals = signals
    .map((signal, index) => billBoundedMoneySignal(signal, index))
    .filter((signal): signal is BillBoundedMoneySignal => signal !== null);
  const unclampedCallMoneyLossUsd = roundUsd(
    moneySignals.reduce((total, signal) => total + signal.standardLossUsd, 0),
  );
  if (unclampedCallMoneyLossUsd <= capUsd) return [...signals];

  const clampedStandardLossByIndex = billBoundedStandardLossAllocation(moneySignals, capUsd);
  return signals.map((signal, index) => {
    const standardLossUsd = clampedStandardLossByIndex.get(index);
    if (standardLossUsd === undefined) return signal;

    const original = moneySignals.find((entry) => entry.index === index);
    if (!original || standardLossUsd === original.standardLossUsd) return signal;

    const providerRecognizedLossUsd = roundUsd(
      Math.min(original.providerRecognizedLossUsd, standardLossUsd),
    );
    const recognitionGapUsd = roundUsd(standardLossUsd - providerRecognizedLossUsd);
    return withBillBoundedCap(signal, {
      callCapUsd: capUsd,
      unclampedCallMoneyLossUsd,
      unclampedSignalStandardLossUsd: original.standardLossUsd,
      standardLossUsd,
      providerRecognizedLossUsd,
      recognitionGapUsd,
    });
  });
}

function billBoundedMoneySignal(signal: LossSignal, index: number): BillBoundedMoneySignal | null {
  if (!isBillBoundedMoneySignal(signal)) return null;

  const standardLossUsd = standardLossUsdForCap(signal);
  if (standardLossUsd === null || standardLossUsd <= 0) return null;

  return {
    index,
    signal,
    standardLossUsd,
    providerRecognizedLossUsd: providerRecognizedUsdForCap(signal, standardLossUsd),
  };
}

function isBillBoundedMoneySignal(signal: LossSignal): boolean {
  if (signal.code === "CACHE_DISCOUNT_AT_RISK" || signal.failureClass === "cache_discount_at_risk") {
    return false;
  }
  if (signal.failureClass === "latency" || signal.valueKind === "time_loss") return false;
  if (signal.valueJson?.timeLossPrimary === true) return false;
  return true;
}

function billBoundedStandardLossAllocation(
  signals: readonly BillBoundedMoneySignal[],
  capUsd: number,
): ReadonlyMap<number, number> {
  const clampedStandardLossByIndex = new Map<number, number>();
  let remainingRecognizedCap = capUsd;

  for (const signal of billBoundedRecognizedAllocationOrder(signals)) {
    const recognized = roundUsd(Math.min(signal.providerRecognizedLossUsd, remainingRecognizedCap));
    clampedStandardLossByIndex.set(signal.index, recognized);
    remainingRecognizedCap = roundUsd(remainingRecognizedCap - recognized);
  }

  let remainingStandardCap = roundUsd(
    capUsd - sumNumbers([...clampedStandardLossByIndex.values()]),
  );
  for (const signal of billBoundedAllocationOrder(signals)) {
    const existing = clampedStandardLossByIndex.get(signal.index) ?? 0;
    const available = roundUsd(signal.standardLossUsd - existing);
    const extra = roundUsd(Math.min(available, remainingStandardCap));
    clampedStandardLossByIndex.set(signal.index, roundUsd(existing + extra));
    remainingStandardCap = roundUsd(remainingStandardCap - extra);
  }

  return clampedStandardLossByIndex;
}

function billBoundedRecognizedAllocationOrder(
  signals: readonly BillBoundedMoneySignal[],
): readonly BillBoundedMoneySignal[] {
  return [...signals].sort((left, right) => {
    const priorityDelta = providerRecognizedAllocationPriority(right) -
      providerRecognizedAllocationPriority(left);
    return priorityDelta === 0 ? left.index - right.index : priorityDelta;
  });
}

function providerRecognizedAllocationPriority(signal: BillBoundedMoneySignal): number {
  if (signal.providerRecognizedLossUsd <= 0) return 0;
  return signal.signal.standardLossMethod === "call_cost_floor_v1" ? 1 : 2;
}

function billBoundedAllocationOrder(
  signals: readonly BillBoundedMoneySignal[],
): readonly BillBoundedMoneySignal[] {
  return [...signals].sort((left, right) => {
    const priorityDelta = billBoundedAllocationPriority(right.signal) -
      billBoundedAllocationPriority(left.signal);
    return priorityDelta === 0 ? left.index - right.index : priorityDelta;
  });
}

function billBoundedAllocationPriority(signal: LossSignal): number {
  return signal.standardLossMethod === "call_cost_floor_v1" ? 2 : 1;
}

function withBillBoundedCap(
  signal: LossSignal,
  input: {
    readonly callCapUsd: number;
    readonly unclampedCallMoneyLossUsd: number;
    readonly unclampedSignalStandardLossUsd: number;
    readonly standardLossUsd: number;
    readonly providerRecognizedLossUsd: number;
    readonly recognitionGapUsd: number;
  },
): LossSignal {
  const trace = recordValue(signal.computationTrace) ?? {};
  const traceInputs = recordValue(trace.inputs) ?? {};
  const traceFormulas = recordValue(trace.formulas) ?? {};
  const traceOutputs = recordValue(trace.outputs) ?? {};
  const billBoundedCap = {
    callExpectedChargeUsd: input.callCapUsd,
    unclampedCallMoneyLossUsd: input.unclampedCallMoneyLossUsd,
    unclampedSignalStandardLossUsd: input.unclampedSignalStandardLossUsd,
    application: "ex_post_clamp",
    standardPromise: "oss/public-root/docs/hard-questions.md#q1-can-the-headline-money-loss-exceed-my-provider-bill",
  };

  return {
    ...signal,
    standardLossUsd: input.standardLossUsd,
    providerRecognizedLossUsd: input.providerRecognizedLossUsd,
    recognitionGapUsd: input.recognitionGapUsd,
    computationTrace: {
      ...trace,
      inputs: {
        ...traceInputs,
        billBoundedCap,
      },
      formulas: {
        ...traceFormulas,
        billBoundedCapUsd:
          "per-call bill-bounded money loss: sum(call money-loss signals) <= expectedChargeUsd",
        providerRecognizedLossUsd: "min(existing estimated recoverable dollars, clamped standardLossUsd)",
        recognitionGapUsd: "clamped standardLossUsd - providerRecognizedLossUsd",
      },
      outputs: {
        ...traceOutputs,
        standardLossUsd: input.standardLossUsd,
        providerRecognizedLossUsd: input.providerRecognizedLossUsd,
        recognitionGapUsd: input.recognitionGapUsd,
      },
      oneLine: billBoundedCapOneLine(input),
    },
    valueJson: {
      ...(signal.valueJson ?? {}),
      standardLossUsd: input.standardLossUsd,
      providerRecognizedLossUsd: input.providerRecognizedLossUsd,
      recognitionGapUsd: input.recognitionGapUsd,
      billBoundedCap,
    },
  };
}

function billBoundedCapOneLine(input: {
  readonly standardLossUsd: number;
  readonly providerRecognizedLossUsd: number;
  readonly recognitionGapUsd: number;
}): string {
  return `bill-bounded ex-post clamp applied: standard loss ${formatTraceUsd(input.standardLossUsd)}; estimated recoverable ${formatTraceUsd(input.providerRecognizedLossUsd)} -> ${formatTraceUsd(input.recognitionGapUsd)} recognition gap`;
}

function withComputedStandardLoss(
  signal: LossSignal,
  event: CanonicalEventV1,
  price: PriceLookupResult,
  input: {
    readonly method: Extract<
      StandardLossMethod,
      "call_cost_floor_v1" | "measure_specific_delta_v1" | typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
      | "cache_discount_at_risk_v1"
    >;
    readonly basis: Exclude<StandardLossBasis, "pricing_unknown_add_model_price" | "not_standard_loss">;
    readonly basisDetail: string;
    readonly standardLossUsd: number;
    readonly providerRecognizedLossUsd: number;
    readonly grade: EvidenceGrade;
    readonly confidence: Extract<
      StandardLossComputationTrace["confidence"],
      "priced_call_cost_floor" | "computed_measure_delta"
    >;
    readonly extraInputs?: Record<string, unknown>;
    readonly extraSourceRefs?: Record<string, unknown>;
  },
): LossSignal {
  const invoiceCheckExposureUsd = input.method === "cache_discount_at_risk_v1"
    ? roundUsd(input.standardLossUsd)
    : null;
  const standardLossUsd = invoiceCheckExposureUsd === null ? roundUsd(input.standardLossUsd) : 0;
  const providerRecognizedLossUsd = invoiceCheckExposureUsd === null
    ? roundUsd(Math.min(input.providerRecognizedLossUsd, standardLossUsd))
    : 0;
  const recognitionGapUsd = invoiceCheckExposureUsd === null
    ? roundUsd(standardLossUsd - providerRecognizedLossUsd)
    : 0;
  const grade = invoiceCheckExposureUsd === null ? input.grade : signal.evidenceGrade;
  const preservedOneLine = input.method === "measure_specific_delta_v1"
    ? existingTraceOneLine(signal)
    : null;
  const timeLossTrace = existingTimeLossTrace(signal);
  const exposureTraceFields = invoiceCheckExposureUsd === null
    ? {}
    : {
        invoiceCheckExposureUsd,
        invoiceCheckExposureLabel: "invoice-check exposure",
        ledgerPlacement: "invoice_check_exposure_not_headline_money_loss",
      };
  const trace: StandardLossComputationTrace = {
    ...computationTrace(event, price, {
      method: input.method,
      basis: input.basis,
      basisDetail: input.basisDetail,
      grade,
      confidence: input.confidence,
      standardLossUsd,
      providerRecognizedLossUsd,
      recognitionGapUsd,
      ...(invoiceCheckExposureUsd === null ? {} : { invoiceCheckExposureUsd }),
      extraInputs: {
        ...(input.extraInputs ?? {}),
        ...exposureTraceFields,
      },
      extraOutputs: exposureTraceFields,
      extraSourceRefs: input.extraSourceRefs,
    }),
    ...(preservedOneLine
      ? { oneLine: preservedOneLine }
      : {}),
    ...(timeLossTrace ? { timeLossTrace } : {}),
  };
  const signalWithExposurePayload = invoiceCheckExposureUsd === null
    ? signal
    : {
        ...signal,
        valueJson: {
          ...(signal.valueJson ?? {}),
          ...exposureTraceFields,
        },
      };
  return withStandardFields(signalWithExposurePayload, {
    status: "computed",
    method: input.method,
    grade,
    standardLossUsd,
    providerRecognizedLossUsd,
    recognitionGapUsd,
    trace,
  });
}

function withSupersededFloorTrace(
  signal: LossSignal,
  event: CanonicalEventV1,
  price: PriceLookupResult,
  winner: LossSignal | null,
): LossSignal {
  const trace = computationTrace(event, price, {
    method: "call_cost_floor_superseded_v1",
    basis: "failed_to_deliver_usable_output",
    basisDetail: wholeCallFloorBasisDetail(signal),
    grade: signal.evidenceGrade,
    confidence: "floor_attributed_to_peer_signal",
    standardLossUsd: 0,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: 0,
    extraInputs: {
      floorAttributedToSignalCode: winner?.code ?? null,
      floorSupersessionReason: "one_call_cost_floor_per_call",
    },
  });
  return withStandardFields(signal, {
    status: "computed",
    method: "call_cost_floor_superseded_v1",
    grade: signal.evidenceGrade,
    standardLossUsd: 0,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: 0,
    trace,
  });
}

function withPricingUnknownStandardLoss(
  signal: LossSignal,
  event: CanonicalEventV1,
  price: PriceLookupResult,
): LossSignal {
  const trace = computationTrace(event, price, {
    method: "pricing_unknown_v1",
    basis: "pricing_unknown_add_model_price",
    basisDetail: "pricing_unknown_add_model_price",
    grade: signal.evidenceGrade,
    confidence: "pricing_unknown",
    standardLossUsd: null,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: null,
  });
  return withStandardFields(signal, {
    status: "pricing_unknown",
    method: "pricing_unknown_v1",
    grade: signal.evidenceGrade,
    standardLossUsd: null,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: null,
    trace,
    pricingStatus: price.ok ? signal.pricingStatus : "pricing_unknown",
  });
}

function withNotApplicableStandardTrace(
  signal: LossSignal,
  event: CanonicalEventV1,
  price: PriceLookupResult,
): LossSignal {
  const trace = computationTrace(event, price, {
    method: "not_applicable_v1",
    basis: "not_standard_loss",
    basisDetail: "not_standard_loss",
    grade: signal.evidenceGrade,
    confidence: "not_applicable",
    standardLossUsd: 0,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: 0,
  });
  return withStandardFields(signal, {
    status: "not_applicable",
    method: "not_applicable_v1",
    grade: signal.evidenceGrade,
    standardLossUsd: 0,
    providerRecognizedLossUsd: 0,
    recognitionGapUsd: 0,
    trace,
  });
}

function withStandardFields(
  signal: LossSignal,
  input: {
    readonly status: StandardLossStatus;
    readonly method: StandardLossMethod;
    readonly grade: EvidenceGrade | null;
    readonly standardLossUsd: number | null;
    readonly providerRecognizedLossUsd: number;
    readonly recognitionGapUsd: number | null;
    readonly trace: StandardLossComputationTrace;
    readonly pricingStatus?: LossSignal["pricingStatus"];
  },
): LossSignal {
  const carriesNonzeroLoss = (input.standardLossUsd ?? 0) > 0;
  const evidenceGrade = carriesNonzeroLoss && signal.evidenceGrade === "triage_only"
    ? "unrecognized_standard_loss"
    : signal.evidenceGrade;
  const status = carriesNonzeroLoss && signal.status === "triage_only" ? "candidate" : signal.status;
  const valueKind = carriesNonzeroLoss && signal.valueKind === "triage" ? "money" : signal.valueKind;
  return {
    ...signal,
    status,
    evidenceGrade,
    valueKind,
    standardLossUsd: input.standardLossUsd,
    providerRecognizedLossUsd: input.providerRecognizedLossUsd,
    recognitionGapUsd: input.recognitionGapUsd,
    standardLossStatus: input.status,
    standardLossMethod: input.method,
    standardLossGrade: carriesNonzeroLoss && input.grade === "triage_only"
      ? "unrecognized_standard_loss"
      : input.grade,
    computationTrace: input.trace,
    pricingStatus: input.pricingStatus ?? signal.pricingStatus,
    valueJson: {
      ...(signal.valueJson ?? {}),
      standardLossStatus: input.status,
      standardLossMethod: input.method,
      standardLossGrade: carriesNonzeroLoss && input.grade === "triage_only"
        ? "unrecognized_standard_loss"
        : input.grade,
      standardLossUsd: input.standardLossUsd,
      providerRecognizedLossUsd: input.providerRecognizedLossUsd,
      recognitionGapUsd: input.recognitionGapUsd,
    },
    evidence: withoutComputationTrace(signal.evidence),
  };
}

function computationTrace(
  event: CanonicalEventV1,
  price: PriceLookupResult,
  input: {
    readonly method: StandardLossMethod;
    readonly basis: StandardLossBasis;
    readonly basisDetail: string;
    readonly grade: EvidenceGrade;
    readonly confidence: StandardLossComputationTrace["confidence"];
    readonly standardLossUsd: number | null;
    readonly providerRecognizedLossUsd: number;
    readonly recognitionGapUsd: number | null;
    readonly invoiceCheckExposureUsd?: number;
    readonly extraInputs?: Record<string, unknown>;
    readonly extraOutputs?: Record<string, unknown>;
    readonly extraSourceRefs?: Record<string, unknown>;
  },
): StandardLossComputationTrace {
  return {
    method: input.method,
    methodId: input.method,
    methodVersion: STANDARD_LOSS_METHOD_VERSION,
    standardVersion: SLA_DEFAULTS.standardVersion,
    basis: input.basis,
    basisDetail: input.basisDetail,
    grade: input.grade,
    confidence: input.confidence,
    inputs: {
      requestId: event.request.requestId,
      provider: event.request.provider,
      model: event.request.model,
      billedTokens: tokensBilledForEvent(event),
      pricing: pricingInputs(price),
      providerRecognizedLossUsd: input.providerRecognizedLossUsd,
      ...(input.extraInputs ?? {}),
    },
    formulas: formulasForMethod(input.method),
    outputs: {
      standardLossUsd: input.standardLossUsd,
      providerRecognizedLossUsd: input.providerRecognizedLossUsd,
      recognitionGapUsd: input.recognitionGapUsd,
      ...(input.extraOutputs ?? {}),
    },
    sourceRefs: {
      pricing: ["@inferock/measure/pricing"],
      standard: [SLA_DEFAULTS.standardVersion],
      standardLossMethodVersion: STANDARD_LOSS_METHOD_VERSION,
      ...(input.extraSourceRefs ?? {}),
    },
    oneLine: oneLine(input),
  };
}

function formulasForMethod(method: StandardLossMethod): Record<string, unknown> {
  if (method === "call_cost_floor_v1") {
    return {
      standardLossUsd: "sum(priced billed token categories)",
      recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
      floorLabel: "full-call floor",
    };
  }
  if (method === "call_cost_floor_superseded_v1") {
    return {
      standardLossUsd: "0 for this signal because this call's floor is attributed to one peer signal",
      recognitionGapUsd: "0 for this signal; see peer call_cost_floor_v1 trace",
    };
  }
  if (method === "measure_specific_delta_v1") {
    return {
      standardLossUsd: "detector-computed delta amount",
      recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
    };
  }
  if (method === "cache_discount_at_risk_v1") {
    return {
      invoiceCheckExposureUsd:
        "cacheReadTokens * (fullInputRateUsdPerMillion - cacheReadRateUsdPerMillion) / 1000000",
      standardLossUsd: "0; invoice-check exposure is not headline standard-loss dollars",
      recognitionGapUsd: "0; invoice-check exposure is not recognition-gap dollars",
    };
  }
  if (method === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID) {
    return {
      billedVisibleOutputTokens: "usage.output_tokens - output_tokens_details.thinking_tokens",
      recountedVisibleOutputTokens:
        "messages.count_tokens(delivered assistant output) - runtime_calibrated_overhead(model)",
      standardLossUsd: "overBilledOutputTokens * outputRateUsdPerMillion / 1000000",
      recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
    };
  }
  if (method === "pricing_unknown_v1") {
    return {
      standardLossUsd: "pricing unknown until model price is added",
      recognitionGapUsd: "pricing unknown until model price is added",
    };
  }
  return {
    standardLossUsd: "not a standard-loss dollar input",
    recognitionGapUsd: "not a standard-loss dollar input",
  };
}

function oneLine(input: {
  readonly method: StandardLossMethod;
  readonly standardLossUsd: number | null;
  readonly providerRecognizedLossUsd: number;
  readonly recognitionGapUsd: number | null;
  readonly invoiceCheckExposureUsd?: number;
}): string {
  if (input.method === "pricing_unknown_v1") {
    return "pricing unknown — add model price";
  }
  if (input.method === "call_cost_floor_superseded_v1") {
    return "call-cost floor already attributed once for this call";
  }
  if (input.method === "not_applicable_v1") {
    return "not a standard-loss dollar input";
  }
  if (input.method === "cache_discount_at_risk_v1") {
    const exposure = numericValue(input.invoiceCheckExposureUsd) ?? input.standardLossUsd ?? 0;
    return `cache discount at risk — verify your invoice: invoice-check exposure ${formatTraceUsd(exposure)}; not standard-loss or recognition-gap dollars`;
  }
  if (input.method === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID) {
    const standard = input.standardLossUsd ?? 0;
    const gap = input.recognitionGapUsd ?? 0;
    return `Anthropic count_tokens provider-assisted grade B recount: standard loss ${formatTraceUsd(standard)}; estimated recoverable ${formatTraceUsd(input.providerRecognizedLossUsd)} -> ${formatTraceUsd(gap)} recognition gap`;
  }
  if (input.method === "call_cost_floor_v1") {
    const standard = input.standardLossUsd ?? 0;
    const gap = input.recognitionGapUsd ?? 0;
    return `full-call floor standard loss ${formatTraceUsd(standard)}; estimated recoverable ${formatTraceUsd(input.providerRecognizedLossUsd)} -> ${formatTraceUsd(gap)} recognition gap`;
  }
  const standard = input.standardLossUsd ?? 0;
  const gap = input.recognitionGapUsd ?? 0;
  return `standard loss ${formatTraceUsd(standard)}; estimated recoverable ${formatTraceUsd(input.providerRecognizedLossUsd)} -> ${formatTraceUsd(gap)} recognition gap`;
}

function formatTraceUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
}

function pricingInputs(price: PriceLookupResult): Record<string, unknown> {
  if (!price.ok) {
    return {
      status: "pricing_unknown",
      reason: price.reason,
      provider: price.provider,
      model: price.model,
      usageCategories: price.usageCategories,
    };
  }
  return {
    status: price.pricingStatus,
    pricingVersion: price.pricingVersion,
    source: price.source,
    currency: price.currency,
    expectedChargeUsd: price.expectedChargeUsd,
    components: price.components.map(pricingComponentInput),
  };
}

function pricingComponentInput(component: PricingComponent): Record<string, unknown> {
  return {
    category: component.category,
    quantity: component.quantity,
    unit: component.unit,
    rateUsdPerMillion: component.rateUsdPerMillion,
    chargeUsd: component.chargeUsd,
    pricingStatus: component.pricingStatus,
    formula: component.rateUsdPerMillion === null
      ? "pricing unknown"
      : "quantity * rateUsdPerMillion / 1000000",
  };
}

function isFullyPriced(price: PriceLookupResult): price is Extract<PriceLookupResult, { ok: true }> {
  return price.ok && price.pricingStatus === "priced";
}

function isWholeCallFloorCandidate(signal: LossSignal): boolean {
  if (signal.severity !== "loss") return false;
  if (signal.failureClass === null) return false;
  if (measureSpecificDeltaUsd(signal) !== null) return false;
  if (isExplicitlyStandardLossIneligible(signal)) return false;
  return wholeCallFloorPriority(signal.code) > 0;
}

function isWholeCallFloorPeerSignal(signal: LossSignal): boolean {
  if (signal.severity !== "loss") return false;
  if (signal.failureClass === null) return false;
  if (measureSpecificDeltaUsd(signal) !== null) return false;
  if (isExplicitlyStandardLossIneligible(signal)) return false;
  return WHOLE_CALL_FLOOR_PEER_SIGNAL_CODES.has(signal.code);
}

function isExplicitlyStandardLossIneligible(signal: LossSignal): boolean {
  return signal.valueJson?.standardLossEligible === false ||
    signal.evidence.standardLossEligible === false;
}

function isPricingUnknownDeltaCandidate(signal: LossSignal): boolean {
  return signal.severity === "loss" &&
    signal.failureClass !== null &&
    DELTA_SIGNAL_CODES.has(signal.code) &&
    (signal.status === "pricing_unknown" ||
      signal.pricingStatus === "pricing_unknown" ||
      signal.pricingStatus === "partial");
}

function selectWholeCallFloorWinner(signals: readonly LossSignal[]): LossSignal | null {
  let winner: LossSignal | null = null;
  for (const signal of signals) {
    if (!winner || wholeCallFloorPriority(signal.code) > wholeCallFloorPriority(winner.code)) {
      winner = signal;
    }
  }
  return winner;
}

function wholeCallFloorPriority(code: LossSignalCode): number {
  return WHOLE_CALL_FLOOR_PRIORITY[code] ?? 0;
}

function measureSpecificDeltaUsd(signal: LossSignal): number | null {
  const explicitStandardLoss = numericValue(signal.valueJson?.standardLossUsd);
  if (signal.code === "LATENCY_BILLED") {
    if (explicitStandardLoss !== null) return positiveOrZero(explicitStandardLoss);
    return isPositive(signal.providerRecoverableLossUsd) ? signal.providerRecoverableLossUsd : null;
  }
  if (signal.code === "SERVED_MODEL_MISMATCH") {
    if (isPositive(explicitStandardLoss)) return explicitStandardLoss;
    return isPositive(signal.providerRecoverableLossUsd) && signal.recoverableBasis === "overcharge_delta"
      ? signal.providerRecoverableLossUsd
      : null;
  }
  if (DELTA_SIGNAL_CODES.has(signal.code)) {
    return positiveOrZero(
      explicitStandardLoss ??
        numericValue(signal.valueJson?.cacheDiscountAtRiskUsd) ??
        numericValue(signal.valueJson?.overchargeUsd) ??
        signal.providerRecoverableLossUsd ??
        null,
    );
  }
  return null;
}

function deltaBasis(signal: LossSignal): Exclude<
  StandardLossBasis,
  "pricing_unknown_add_model_price" | "failed_to_deliver_usable_output" | "not_standard_loss"
> {
  if (signal.code === "LATENCY_BILLED") return "latency_time_excess";
  if (signal.code === "SERVED_MODEL_MISMATCH") return "served_model_overcharge_delta";
  if (signal.code === "CACHE_DISCOUNT_AT_RISK") return "cache_discount_at_risk";
  if (signal.code === "CACHE_RATE_ANOMALY") return "cache_overcharge_delta";
  return "token_overcharge_delta";
}

function deltaBasisDetail(signal: LossSignal): string {
  if (signal.code === "LATENCY_BILLED") return "delivered_call_time_excess";
  if (signal.code === "SERVED_MODEL_MISMATCH") return "served_model_overcharge_delta";
  if (signal.code === "CACHE_DISCOUNT_AT_RISK") return "cache_discount_at_risk_verify_invoice";
  if (signal.code === "CACHE_RATE_ANOMALY") return "cache_rate_overcharge_delta";
  if (signal.code === "ANTHROPIC_TOKEN_CROSSCHECK") return "anthropic_count_tokens_recount_overcharge_delta";
  return "token_overcharge_delta";
}

function deltaStandardLossMethod(
  signal: LossSignal,
): Extract<
  StandardLossMethod,
  "measure_specific_delta_v1" | typeof ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
  | "cache_discount_at_risk_v1"
> {
  if (signal.code === "CACHE_DISCOUNT_AT_RISK") return "cache_discount_at_risk_v1";
  return signal.code === "ANTHROPIC_TOKEN_CROSSCHECK" &&
    signal.valueJson?.methodId === ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
    ? ANTHROPIC_COUNT_TOKENS_RECOUNT_METHOD_ID
    : "measure_specific_delta_v1";
}

function deltaTraceInputs(signal: LossSignal): Record<string, unknown> | undefined {
  const methodMetadata = methodMetadataForSignal(signal);
  if (!methodMetadata) return undefined;
  return { methodMetadata };
}

function deltaTraceSourceRefs(signal: LossSignal): Record<string, unknown> | undefined {
  const methodMetadata = methodMetadataForSignal(signal);
  if (!methodMetadata) return undefined;
  const sourceRefs = recordValue(methodMetadata.sourceRefs) ?? {
    recountOracle: methodMetadata.recountOracleDocsUrl,
    localEstimator: methodMetadata.localEstimatorUrl,
  };
  return { methodMetadata: sourceRefs };
}

function methodMetadataForSignal(signal: LossSignal): Record<string, unknown> | null {
  return recordValue(signal.valueJson?.methodMetadata) ??
    recordValue(signal.evidence.methodMetadata);
}

function wholeCallFloorBasisDetail(signal: LossSignal): string {
  switch (signal.code) {
    case "REFUSAL_BILLED":
    case "REFUSAL_PREOUTPUT_BILLED_INVARIANT":
      return "refused";
    case "BROKEN_OUTPUT":
    case "TRUNCATED":
    case "BILLED_EMPTY":
    case "MALFORMED_TOOL_CALL":
    case "TOOL_CALL_SCHEMA_VIOLATION":
    case "UNDECLARED_TOOL_CALL":
    case "TOOL_CHOICE_VIOLATION":
    case "TOOL_CALL_STOP_REASON_MISMATCH":
      return "broken_invalid_or_unusable_output";
    case "DUPLICATE_REQUEST_ID":
      return "duplicate";
    case "SERVED_MODEL_MISMATCH":
      return "served_wrong_model";
    case "PROVIDER_DOWNTIME":
      return "downtime_with_no_output";
    case "FACTUALITY_KNOWN_ANSWER_FAIL":
    case "ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT":
      return "factuality_contradiction";
    case "SECURITY_SECRET_EXACT_MATCH":
      return "security_secret_leak";
    case "ANTHROPIC_TOKEN_CROSSCHECK":
      return "billing_integrity_crosscheck_on_failed_call_floor_attributed_to_peer";
    default:
      return "failed_to_deliver_usable_output";
  }
}

function gradeForComputedLoss(signal: LossSignal, standardLossUsd: number): EvidenceGrade {
  if (standardLossUsd <= 0) return signal.evidenceGrade;
  return signal.evidenceGrade === "refundable_candidate"
    ? "refundable_candidate"
    : "unrecognized_standard_loss";
}

function providerRecognizedUsd(signal: LossSignal, standardLossUsd: number): number {
  if (!isPositive(signal.providerRecoverableLossUsd)) return 0;
  return roundUsd(Math.min(signal.providerRecoverableLossUsd, standardLossUsd));
}

function standardLossUsdForCap(signal: LossSignal): number | null {
  const standardLossUsd = signal.standardLossUsd ??
    numericValue(signal.valueJson?.standardLossUsd) ??
    numericValue(traceOutput(signal, "standardLossUsd"));
  return standardLossUsd === null ? null : roundUsd(standardLossUsd);
}

function providerRecognizedUsdForCap(signal: LossSignal, standardLossUsd: number): number {
  const providerRecognizedLossUsd = signal.providerRecognizedLossUsd ??
    numericValue(signal.valueJson?.providerRecognizedLossUsd) ??
    numericValue(traceOutput(signal, "providerRecognizedLossUsd")) ??
    signal.providerRecoverableLossUsd ??
    0;
  return roundUsd(Math.min(providerRecognizedLossUsd, standardLossUsd));
}

function traceOutput(signal: LossSignal, key: string): unknown {
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
  const outputs = recordValue(trace?.outputs);
  return outputs?.[key];
}

function withoutComputationTrace(evidence: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(evidence, "computationTrace")) return evidence;
  const { computationTrace: _computationTrace, ...rest } = evidence;
  return rest;
}

function existingTraceOneLine(signal: LossSignal): string | null {
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
  const oneLine = trace?.oneLine;
  return typeof oneLine === "string" && oneLine.trim().length > 0 ? oneLine : null;
}

function existingTimeLossTrace(signal: LossSignal): Record<string, unknown> | null {
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence.computationTrace);
  return recordValue(signal.valueJson?.timeLossTrace) ??
    recordValue(signal.evidence.timeLossTrace) ??
    recordValue(trace?.timeLossTrace);
}

interface PublicTimeLossInputInterval {
  readonly logicalOperationKey: string;
  readonly signalCode: string;
  readonly failureClass: string | null;
  readonly requestId: string;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly rawTimeLossMs: number;
  readonly providerRecognizedTimeLossMs: number;
  readonly recognitionGapTimeMs: number;
  readonly dollarTranslationUsd: number;
  readonly priority: number;
}

interface AllocatedPublicTimeLossInterval extends PublicTimeLossInputInterval {
  readonly publicTimeLossMs: number;
  readonly publicProviderRecognizedTimeLossMs: number;
  readonly publicRecognitionGapTimeMs: number;
  readonly publicDollarTranslationUsd: number;
}

function publicTimeLossInputInterval(
  entry: PublicTimeLossSignalEntry,
  rateUsdPerHour: number,
): PublicTimeLossInputInterval | null {
  if (!isPublicTimeLossSignal(entry.signal)) return null;
  const rawTimeLossMs = publicSignalTimeLossMs(entry.signal);
  if (rawTimeLossMs <= 0) return null;

  const rawBounds = publicTimeLossBounds(entry);
  const bounded = boundedIntervalForTimeLoss(rawBounds, rawTimeLossMs);
  const providerRecognizedTimeLossMs = publicSignalProviderRecognizedTimeLossMs(entry.signal);
  const recognitionGapTimeLossMs = publicSignalRecognitionGapTimeLossMs(
    entry.signal,
    rawTimeLossMs,
    providerRecognizedTimeLossMs,
  );
  return {
    logicalOperationKey: publicLogicalOperationKey(entry.event),
    signalCode: entry.signal.code,
    failureClass: entry.signal.failureClass ?? null,
    requestId: entry.event.request.requestId,
    startedAt: bounded.startedAt,
    endedAt: bounded.endedAt,
    rawTimeLossMs,
    providerRecognizedTimeLossMs,
    recognitionGapTimeMs: recognitionGapTimeLossMs,
    dollarTranslationUsd: publicSignalDollarTranslationUsd(entry.signal, rawTimeLossMs, rateUsdPerHour),
    priority: publicTimeLossPriority(entry.signal),
  };
}

function isPublicTimeLossSignal(signal: PublicTimeLossSignal): boolean {
  if (signal.valueKind === "time_loss") return true;
  if (signal.valueJson?.timeLossPrimary === true) return true;
  return publicSignalTimeLossMs(signal) > 0;
}

function publicSignalTimeLossMs(signal: PublicTimeLossSignal): number {
  return numericValue(signal.valueJson?.timeLossMs) ??
    numericValue(signal.valueJson?.excessMs) ??
    numericValue(signal.valueJson?.excessWaitMs) ??
    numericValue(publicTraceOutput(signal, "timeLossMs")) ??
    0;
}

function publicSignalProviderRecognizedTimeLossMs(signal: PublicTimeLossSignal): number {
  return numericValue(signal.valueJson?.providerRecognizedTimeLossMs) ??
    numericValue(publicTraceOutput(signal, "providerRecognizedTimeLossMs")) ??
    0;
}

function publicSignalRecognitionGapTimeLossMs(
  signal: PublicTimeLossSignal,
  rawTimeLossMs: number,
  providerRecognizedTimeLossMs: number,
): number {
  return numericValue(signal.valueJson?.recognitionGapTimeMs) ??
    numericValue(publicTraceOutput(signal, "recognitionGapTimeMs")) ??
    Math.max(0, rawTimeLossMs - providerRecognizedTimeLossMs);
}

function publicSignalDollarTranslationUsd(
  signal: PublicTimeLossSignal,
  rawTimeLossMs: number,
  rateUsdPerHour: number,
): number {
  return numericValue(signal.valueJson?.dollarTranslationUsd) ??
    numericValue(publicTraceOutput(signal, "dollarTranslationUsd")) ??
    dollarTranslationForTimeLoss(rawTimeLossMs, rateUsdPerHour);
}

function publicTraceOutput(signal: PublicTimeLossSignal, key: string): unknown {
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence?.computationTrace);
  const timeLossTrace = recordValue(signal.valueJson?.timeLossTrace) ??
    recordValue(signal.evidence?.timeLossTrace) ??
    recordValue(trace?.timeLossTrace);
  const outputs = recordValue(timeLossTrace?.outputs) ?? recordValue(trace?.outputs);
  return outputs?.[key];
}

function publicTimeLossBounds(
  entry: PublicTimeLossSignalEntry,
): { readonly startedAt: number | null; readonly endedAt: number | null } {
  const signal = entry.signal;
  const trace = recordValue(signal.computationTrace) ?? recordValue(signal.evidence?.computationTrace);
  const timeLossTrace = recordValue(signal.valueJson?.timeLossTrace) ??
    recordValue(signal.evidence?.timeLossTrace) ??
    recordValue(trace?.timeLossTrace);
  const inputs = recordValue(timeLossTrace?.inputs) ?? recordValue(trace?.inputs);
  const startedAt = parsedTime(
    signal.valueJson?.chainStartAt,
    signal.evidence?.chainStartAt,
    signal.valueJson?.startedAt,
    signal.evidence?.startedAt,
    inputs?.providerRequestStartedAt,
    inputs?.requestStartedAt,
    entry.event.timing.providerRequestStartedAt,
    entry.event.timing.startedAt,
  );
  const endedAt = parsedTime(
    signal.valueJson?.chainEndAt,
    signal.evidence?.chainEndAt,
    signal.valueJson?.endedAt,
    signal.evidence?.endedAt,
    inputs?.providerResponseEndedAt,
    inputs?.requestEndedAt,
    entry.event.timing.providerResponseEndedAt,
    entry.event.timing.endedAt,
  );
  return { startedAt, endedAt };
}

function boundedIntervalForTimeLoss(
  bounds: { readonly startedAt: number | null; readonly endedAt: number | null },
  rawTimeLossMs: number,
): { readonly startedAt: number | null; readonly endedAt: number | null } {
  if (bounds.startedAt === null || bounds.endedAt === null) return bounds;
  const startedAt = Math.min(bounds.startedAt, bounds.endedAt);
  const endedAt = Math.max(bounds.startedAt, bounds.endedAt);
  const durationMs = Math.max(0, endedAt - startedAt);
  if (durationMs <= rawTimeLossMs) return { startedAt, endedAt };
  return {
    startedAt: endedAt - rawTimeLossMs,
    endedAt,
  };
}

function publicLogicalOperationKey(event: PublicTimeLossEvent): string {
  const operationIdentity = event.request.operationId
    ? `operation:${event.request.operationId}`
    : event.request.bodyHash
    ? `body:${event.request.apiKeyHash ?? "*"}:${event.request.bodyHash}`
    : `request:${event.request.requestId}`;
  return [
    event.request.tenantId,
    event.request.provider,
    event.request.model,
    operationIdentity,
  ].join("\u0000");
}

function publicTimeLossPriority(signal: PublicTimeLossSignal): number {
  if (signal.code === "RETRY_AMPLIFICATION_CHAIN" || signal.code === "RETRY_AMPLIFICATION_IN_CALL") {
    return 10;
  }
  if (signal.code === "PROVIDER_DOWNTIME" || signal.failureClass === "downtime") return 80;
  if (signal.code === "LATENCY_BILLED" || signal.failureClass === "latency") return 70;
  return 50;
}

function allocatePublicTimeLoss(
  intervals: readonly PublicTimeLossInputInterval[],
): AllocatedPublicTimeLossInterval[] {
  const byOperation = new Map<string, PublicTimeLossInputInterval[]>();
  for (const interval of intervals) {
    byOperation.set(interval.logicalOperationKey, [
      ...(byOperation.get(interval.logicalOperationKey) ?? []),
      interval,
    ]);
  }

  const allocatedByIndex = new Map<PublicTimeLossInputInterval, AllocatedPublicTimeLossInterval>();
  for (const operationIntervals of byOperation.values()) {
    const covered: { start: number; end: number }[] = [];
    const sorted = [...operationIntervals].sort((left, right) =>
      right.priority - left.priority ||
      (left.startedAt ?? Number.POSITIVE_INFINITY) - (right.startedAt ?? Number.POSITIVE_INFINITY) ||
      left.signalCode.localeCompare(right.signalCode)
    );
    for (const interval of sorted) {
      const publicTimeLossMs = uncoveredTimeLossMs(interval, covered);
      if (interval.startedAt !== null && interval.endedAt !== null) {
        covered.push({
          start: Math.min(interval.startedAt, interval.endedAt),
          end: Math.max(interval.startedAt, interval.endedAt),
        });
      }
      allocatedByIndex.set(interval, allocatedTimeLossInterval(interval, publicTimeLossMs));
    }
  }

  return intervals.map((interval) => allocatedByIndex.get(interval) ?? allocatedTimeLossInterval(interval, 0));
}

function uncoveredTimeLossMs(
  interval: PublicTimeLossInputInterval,
  covered: readonly { readonly start: number; readonly end: number }[],
): number {
  if (interval.startedAt === null || interval.endedAt === null) return interval.rawTimeLossMs;
  let segments = [{
    start: Math.min(interval.startedAt, interval.endedAt),
    end: Math.max(interval.startedAt, interval.endedAt),
  }];
  for (const cover of covered) {
    segments = segments.flatMap((segment) => subtractInterval(segment, cover));
    if (segments.length === 0) break;
  }
  return Math.min(
    interval.rawTimeLossMs,
    sumNumbers(segments.map((segment) => Math.max(0, segment.end - segment.start))),
  );
}

function subtractInterval(
  segment: { readonly start: number; readonly end: number },
  cover: { readonly start: number; readonly end: number },
): { readonly start: number; readonly end: number }[] {
  if (cover.end <= segment.start || cover.start >= segment.end) return [segment];
  const result: { start: number; end: number }[] = [];
  if (cover.start > segment.start) {
    result.push({ start: segment.start, end: Math.min(cover.start, segment.end) });
  }
  if (cover.end < segment.end) {
    result.push({ start: Math.max(cover.end, segment.start), end: segment.end });
  }
  return result;
}

function allocatedTimeLossInterval(
  interval: PublicTimeLossInputInterval,
  publicTimeLossMs: number,
): AllocatedPublicTimeLossInterval {
  const ratio = interval.rawTimeLossMs > 0
    ? Math.max(0, Math.min(1, publicTimeLossMs / interval.rawTimeLossMs))
    : 0;
  return {
    ...interval,
    publicTimeLossMs,
    publicProviderRecognizedTimeLossMs: interval.providerRecognizedTimeLossMs * ratio,
    publicRecognitionGapTimeMs: interval.recognitionGapTimeMs * ratio,
    publicDollarTranslationUsd: roundUsd(interval.dollarTranslationUsd * ratio),
  };
}

function parsedTime(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveOrZero(value: number | null): number | null {
  return value === null ? null : roundUsd(value);
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
