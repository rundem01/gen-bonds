/**
 * Pins the frontend's pricing model to real on-chain readings.
 *
 * These are not synthetic fixtures. They were read back from a deployed
 * GenBonds contract on GenLayer Studionet, before and after a bond was
 * breached by validator consensus, settled in transaction
 * 0x8cd1b6ea3c14c815ba5faeeed345f572a16a111bb0fec3a152dc157dcb9a274e.
 *
 * The third case is the one that matters: the yardstick's ghost needle claims
 * to show where an agent's price lands after one more breach. That prediction
 * was computable before the breach happened, and the chain then produced
 * exactly it. If this test ever fails, the yardstick is lying to users.
 */
import { strict as assert } from "node:assert";
import {
  BPS,
  PRIOR_FAILURES,
  PRIOR_TASKS,
  SCALE,
  afterSettlement,
  lossRateBps,
  premiumBps,
} from "../src/core/pricing.ts";

/** Recover weighted counters from what price_of_trust publishes. */
function recover(effectiveSettlements: number, loss: number) {
  const total = effectiveSettlements * SCALE;
  const weightedFailures = Math.max(
    0,
    Math.round((loss * (total + PRIOR_TASKS)) / BPS - PRIOR_FAILURES),
  );
  return {
    weightedFailures,
    weightedHonored: Math.max(0, total - weightedFailures),
    liveExposure: 0n,
  };
}

// Read from the chain before the bond was bound.
const CHAIN_BEFORE = { effective_settlements: 0, loss_rate_bps: 1000, base_premium_bps: 1050 };
// Read from the chain after settle() breached bond 1.
const CHAIN_AFTER = { effective_settlements: 1, loss_rate_bps: 1290, base_premium_bps: 1340 };

const before = recover(CHAIN_BEFORE.effective_settlements, CHAIN_BEFORE.loss_rate_bps);
assert.equal(
  lossRateBps(before.weightedFailures, before.weightedHonored),
  CHAIN_BEFORE.loss_rate_bps,
  "inversion lost the pre-breach loss rate",
);
assert.equal(
  premiumBps(CHAIN_BEFORE.loss_rate_bps, 0, 0, 100),
  CHAIN_BEFORE.base_premium_bps,
  "pre-breach premium disagrees with the chain",
);

const after = recover(CHAIN_AFTER.effective_settlements, CHAIN_AFTER.loss_rate_bps);
assert.equal(
  lossRateBps(after.weightedFailures, after.weightedHonored),
  CHAIN_AFTER.loss_rate_bps,
  "inversion lost the post-breach loss rate",
);

// The claim the yardstick makes to the user, checked against what happened.
const predicted = afterSettlement(before, false);
const predictedLoss = lossRateBps(predicted.weightedFailures, predicted.weightedHonored);
assert.equal(predictedLoss, CHAIN_AFTER.loss_rate_bps, "ghost needle mispredicted the loss rate");
assert.equal(
  premiumBps(predictedLoss, 0, 0, 100),
  CHAIN_AFTER.base_premium_bps,
  "ghost needle mispredicted the premium",
);

console.log(
  `  ok    ghost needle predicted ${predictedLoss} bps / ` +
    `${premiumBps(predictedLoss, 0, 0, 100)} bps premium — chain produced exactly that`,
);
