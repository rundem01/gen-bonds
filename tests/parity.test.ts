/**
 * Cross-language parity check.
 *
 * The frontend is allowed to price quotes locally only because this passes.
 * Vectors are generated from `contracts/GenBonds.py` by `npm run vectors`.
 */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import {
  collateralBps,
  concentrationLoadBps,
  durationLoadBps,
  lossRateBps,
  premiumBps,
  quantiseRisk,
} from "../src/core/pricing.ts";

interface Vector {
  weighted_failures: number;
  weighted_honored: number;
  duration_hours: number;
  exposure_after: string | number;
  pool_capital: string | number;
  risk_mult_raw: number;
  loss_rate_bps: number;
  collateral_bps: number;
  duration_load_bps: number;
  concentration_load_bps: number;
  risk_mult: number;
  premium_bps: number;
}

const vectors: Vector[] = JSON.parse(
  readFileSync(new URL("./vectors.json", import.meta.url), "utf8"),
);

let checked = 0;
for (const v of vectors) {
  const rate = lossRateBps(v.weighted_failures, v.weighted_honored);
  assert.equal(rate, v.loss_rate_bps, `loss rate drifted on ${JSON.stringify(v)}`);
  assert.equal(collateralBps(rate), v.collateral_bps, "collateral drifted");
  assert.equal(durationLoadBps(v.duration_hours), v.duration_load_bps, "duration drifted");
  assert.equal(
    concentrationLoadBps(BigInt(v.exposure_after), BigInt(v.pool_capital)),
    v.concentration_load_bps,
    "concentration drifted",
  );
  assert.equal(quantiseRisk(v.risk_mult_raw), v.risk_mult, "quantisation drifted");
  assert.equal(
    premiumBps(rate, v.duration_load_bps, v.concentration_load_bps, v.risk_mult),
    v.premium_bps,
    "premium drifted",
  );
  checked += 1;
}

console.log(`  ok    ${checked} pricing vectors match contracts/GenBonds.py`);
