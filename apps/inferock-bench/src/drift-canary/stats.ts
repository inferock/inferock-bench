export interface FisherExactDropInput {
  readonly baselinePassed: number;
  readonly baselineTotal: number;
  readonly currentPassed: number;
  readonly currentTotal: number;
}

export interface DriftAccuracyFlagInput extends FisherExactDropInput {
  readonly alpha: number;
}

export interface DriftAccuracyFlagResult {
  readonly flagged: boolean;
  readonly pValue: number;
  readonly baselineAccuracy: number;
  readonly currentAccuracy: number;
  readonly alpha: number;
}

export function flagDriftByAccuracyDrop(
  input: DriftAccuracyFlagInput,
): DriftAccuracyFlagResult {
  validateCounts({
    baselinePassed: input.baselinePassed,
    baselineTotal: input.baselineTotal,
    currentPassed: input.currentPassed,
    currentTotal: input.currentTotal,
  });
  if (!Number.isFinite(input.alpha) || input.alpha <= 0 || input.alpha >= 1) {
    throw new Error("Drift canary alpha must be between 0 and 1.");
  }
  const baselineAccuracy = input.baselinePassed / input.baselineTotal;
  const currentAccuracy = input.currentPassed / input.currentTotal;
  const pValue = fisherExactDropPValue({
    baselinePassed: input.baselinePassed,
    baselineTotal: input.baselineTotal,
    currentPassed: input.currentPassed,
    currentTotal: input.currentTotal,
  });
  return {
    flagged: currentAccuracy < baselineAccuracy && pValue < input.alpha,
    pValue,
    baselineAccuracy,
    currentAccuracy,
    alpha: input.alpha,
  };
}

export function fisherExactDropPValue(input: FisherExactDropInput): number {
  validateCounts(input);
  const totalPassed = input.baselinePassed + input.currentPassed;
  const total = input.baselineTotal + input.currentTotal;
  const minCurrentPassed = Math.max(0, totalPassed - input.baselineTotal);
  const maxCurrentPassed = Math.min(input.currentTotal, totalPassed);
  let pValue = 0;
  for (
    let currentPassed = minCurrentPassed;
    currentPassed <= Math.min(input.currentPassed, maxCurrentPassed);
    currentPassed += 1
  ) {
    pValue += hypergeometricProbability({
      successesInPopulation: totalPassed,
      populationSize: total,
      draws: input.currentTotal,
      observedSuccesses: currentPassed,
    });
  }
  return Math.min(1, Math.max(0, pValue));
}

function hypergeometricProbability(input: {
  readonly successesInPopulation: number;
  readonly populationSize: number;
  readonly draws: number;
  readonly observedSuccesses: number;
}): number {
  const failuresInPopulation = input.populationSize - input.successesInPopulation;
  const observedFailures = input.draws - input.observedSuccesses;
  if (
    input.observedSuccesses < 0 ||
    observedFailures < 0 ||
    input.observedSuccesses > input.successesInPopulation ||
    observedFailures > failuresInPopulation
  ) {
    return 0;
  }
  return Math.exp(
    logChoose(input.successesInPopulation, input.observedSuccesses) +
      logChoose(failuresInPopulation, observedFailures) -
      logChoose(input.populationSize, input.draws),
  );
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const boundedK = Math.min(k, n - k);
  let total = 0;
  for (let index = 1; index <= boundedK; index += 1) {
    total += Math.log(n - boundedK + index) - Math.log(index);
  }
  return total;
}

function validateCounts(input: FisherExactDropInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Drift canary count ${name} must be a non-negative integer.`);
    }
  }
  if (input.baselineTotal === 0 || input.currentTotal === 0) {
    throw new Error("Drift canary comparison requires non-empty baseline and current runs.");
  }
  if (input.baselinePassed > input.baselineTotal || input.currentPassed > input.currentTotal) {
    throw new Error("Drift canary passed counts cannot exceed totals.");
  }
}
