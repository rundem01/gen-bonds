/**
 * A byte-for-byte mirror of the actuarial core in `contracts/GenBonds.py`.
 *
 * It exists so the quote slip can re-price on every keystroke and slider frame
 * without touching the chain. That is only defensible if the two
 * implementations cannot drift, so both are pinned to `tests/vectors.json` and
 * CI fails if either one moves.
 *
 * Integer arithmetic only. Money is bigint wei; rates are plain-number basis
 * points, which comfortably fit in a double.
 */

export const BPS = 10_000;
export const SCALE = 1_000;

export const PRIOR_FAILURES = 3 * SCALE;
export const PRIOR_TASKS = 30 * SCALE;

export const DECAY_NUM = 990;
export const DECAY_DEN = 1_000;

export const DURATION_LOAD_PER_HOUR_BPS = 4;
export const DURATION_LOAD_CAP_BPS = 400;
export const CONCENTRATION_LOAD_CAP_BPS = 600;
export const EXPENSE_BPS = 50;

export const PREMIUM_FLOOR_BPS = 25;
export const PREMIUM_CAP_BPS = 5_000;

export const MIN_COLLATERAL_BPS = 2_000;
export const MAX_COLLATERAL_BPS = 8_000;

export const RISK_MULT_MIN = 100;
export const RISK_MULT_MAX = 400;
export const RISK_MULT_STEP = 25;

/** Posterior mean failure rate under the beta prior, in basis points. */
export function lossRateBps(weightedFailures: number, weightedHonored: number): number {
  const numerator = (weightedFailures + PRIOR_FAILURES) * BPS;
  const denominator = weightedFailures + weightedHonored + PRIOR_TASKS;
  return Math.floor(numerator / denominator);
}

export function durationLoadBps(durationHours: number): number {
  const load = durationHours * DURATION_LOAD_PER_HOUR_BPS;
  return load < DURATION_LOAD_CAP_BPS ? load : DURATION_LOAD_CAP_BPS;
}

export function concentrationLoadBps(exposureAfter: bigint, poolCapital: bigint): number {
  if (poolCapital <= 0n) return CONCENTRATION_LOAD_CAP_BPS;
  const load = Number((exposureAfter * 2000n) / poolCapital);
  return load < CONCENTRATION_LOAD_CAP_BPS ? load : CONCENTRATION_LOAD_CAP_BPS;
}

export function collateralBps(lossRate: number): number {
  const req = MIN_COLLATERAL_BPS + lossRate;
  if (req < MIN_COLLATERAL_BPS) return MIN_COLLATERAL_BPS;
  if (req > MAX_COLLATERAL_BPS) return MAX_COLLATERAL_BPS;
  return req;
}

export function premiumBps(
  lossRate: number,
  durationLoad: number,
  concentrationLoad: number,
  riskMult: number,
): number {
  const riskLoaded = Math.floor(((lossRate + durationLoad + concentrationLoad) * riskMult) / 100);
  const total = riskLoaded + EXPENSE_BPS;
  if (total < PREMIUM_FLOOR_BPS) return PREMIUM_FLOOR_BPS;
  if (total > PREMIUM_CAP_BPS) return PREMIUM_CAP_BPS;
  return total;
}

export function quantiseRisk(raw: number): number {
  let value = Math.floor(raw);
  if (value < RISK_MULT_MIN) value = RISK_MULT_MIN;
  if (value > RISK_MULT_MAX) value = RISK_MULT_MAX;
  return Math.floor((value + RISK_MULT_STEP / 2) / RISK_MULT_STEP) * RISK_MULT_STEP;
}

export interface AgentHistory {
  weightedFailures: number;
  weightedHonored: number;
  liveExposure: bigint;
}

export interface QuoteInput {
  history: AgentHistory;
  faceValue: bigint;
  durationHours: number;
  riskMultRaw: number;
  poolCapital: bigint;
  poolAllocated: bigint;
}

export interface Quote {
  lossRateBps: number;
  durationLoadBps: number;
  concentrationLoadBps: number;
  riskMult: number;
  premiumBps: number;
  premium: bigint;
  collateralBps: number;
  collateral: bigint;
  poolExposure: bigint;
  capacityAvailable: bigint;
  declined: boolean;
  bindable: boolean;
}

/** The whole quote, derived exactly as `GenBonds.quote()` derives it. */
export function quote(input: QuoteInput): Quote {
  const { history, faceValue, durationHours, riskMultRaw, poolCapital, poolAllocated } = input;

  const loss = lossRateBps(history.weightedFailures, history.weightedHonored);
  const collBps = collateralBps(loss);
  const collateral = (faceValue * BigInt(collBps)) / BigInt(BPS);
  const poolExposure = faceValue - collateral;
  const exposureAfter = history.liveExposure + poolExposure;

  const conc = concentrationLoadBps(exposureAfter, poolCapital);
  const dur = durationLoadBps(durationHours);
  const mult = quantiseRisk(riskMultRaw);
  const bps = premiumBps(loss, dur, conc, mult);
  const premium = (faceValue * BigInt(bps)) / BigInt(BPS);

  const capacity = poolCapital > poolAllocated ? poolCapital - poolAllocated : 0n;
  const declined = bps >= PREMIUM_CAP_BPS;

  return {
    lossRateBps: loss,
    durationLoadBps: dur,
    concentrationLoadBps: conc,
    riskMult: mult,
    premiumBps: bps,
    premium,
    collateralBps: collBps,
    collateral,
    poolExposure,
    capacityAvailable: capacity,
    declined,
    bindable: !declined && poolExposure <= capacity,
  };
}

/**
 * What this agent's record would look like after one more settlement, used by
 * the yardstick to show where the needle moves next. The obligor sees the cost
 * of failing before it decides whether to take the job.
 */
export function afterSettlement(history: AgentHistory, honored: boolean): AgentHistory {
  const wf = Math.floor((history.weightedFailures * DECAY_NUM) / DECAY_DEN);
  const wh = Math.floor((history.weightedHonored * DECAY_NUM) / DECAY_DEN);
  return {
    weightedFailures: honored ? wf : wf + SCALE,
    weightedHonored: honored ? wh + SCALE : wh,
    liveExposure: history.liveExposure,
  };
}

/** Probability of failure implied by the current price, as a 0–1 fraction. */
export function impliedFailureProbability(lossRate: number): number {
  return lossRate / BPS;
}
