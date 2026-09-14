/**
 * Portfolio loss simulation, off the main thread.
 *
 * An underwriter's real question is not "what did we charge" but "what could
 * this book cost us on a bad day". That is a Monte Carlo over every live bond,
 * and at 200,000 trials it is not something to run inside a scroll handler.
 * The worker owns it; the main thread stays free for input.
 *
 * Each live bond is an independent Bernoulli draw at the failure probability
 * the contract itself implied when it priced the bond. Independence is a
 * simplifying assumption and a generous one — correlated failure across agents
 * sharing an upstream dependency is the obvious next model, and is called out
 * in docs/ARCHITECTURE.md rather than quietly assumed away.
 */

export interface RiskRequest {
  exposures: Float64Array;
  probabilities: Float64Array;
  freeCapital: number;
  premiumsEarned: number;
  trials: number;
}

export interface RiskResult {
  trials: number;
  meanLoss: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  probabilityOfLoss: number;
  probabilityOfRuin: number;
  expectedProfit: number;
  histogram: Float64Array;
  histogramMax: number;
  binWidth: number;
}

const BINS = 48;

function xorshift(seed: number): () => number {
  let x = seed | 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function simulate(request: RiskRequest): RiskResult {
  const { exposures, probabilities, freeCapital, premiumsEarned } = request;
  const trials = Math.max(1_000, request.trials | 0);
  const n = exposures.length;
  const rand = xorshift(0x5eed_1234);
  const losses = new Float64Array(trials);

  let total = 0;
  let ruin = 0;
  let lossCount = 0;
  let worst = 0;

  for (let t = 0; t < trials; t += 1) {
    let loss = 0;
    for (let i = 0; i < n; i += 1) {
      if (rand() < probabilities[i]!) loss += exposures[i]!;
    }
    losses[t] = loss;
    total += loss;
    if (loss > 0) lossCount += 1;
    if (loss > freeCapital) ruin += 1;
    if (loss > worst) worst = loss;
  }

  const sorted = losses.slice().sort();
  const at = (q: number) => sorted[Math.min(trials - 1, Math.floor(q * trials))]!;

  const binWidth = worst > 0 ? worst / BINS : 1;
  const histogram = new Float64Array(BINS);
  for (let t = 0; t < trials; t += 1) {
    const bin = Math.min(BINS - 1, Math.floor(losses[t]! / binWidth));
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  let histogramMax = 0;
  for (let b = 0; b < BINS; b += 1) if (histogram[b]! > histogramMax) histogramMax = histogram[b]!;

  return {
    trials,
    meanLoss: total / trials,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    worst,
    probabilityOfLoss: lossCount / trials,
    probabilityOfRuin: ruin / trials,
    expectedProfit: premiumsEarned - total / trials,
    histogram,
    histogramMax,
    binWidth,
  };
}

self.onmessage = (event: MessageEvent<RiskRequest>) => {
  const result = simulate(event.data);
  // Transfer the histogram rather than structured-cloning it.
  (self as unknown as Worker).postMessage(result, [result.histogram.buffer]);
};
