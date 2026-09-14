"""
Unit tests for the GenBonds actuarial core.

These test the arithmetic that decides what an agent's promise costs. They run
offline, in milliseconds, with no node and no model — which is the point: the
price is deterministic, so it can be pinned down like any other pure function.

Consensus behaviour (difficulty scoring, delivery adjudication, clock
agreement) is not covered here. That lives in `tests/test_settlement.py` and
requires a running GenLayer node.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "stubs"))
sys.path.insert(0, str(ROOT / "contracts"))

from GenBonds import (  # noqa: E402
    BPS,
    MAX_COLLATERAL_BPS,
    MIN_COLLATERAL_BPS,
    PREMIUM_CAP_BPS,
    PREMIUM_FLOOR_BPS,
    RISK_MULT_MAX,
    RISK_MULT_MIN,
    SCALE,
    collateral_bps,
    concentration_load_bps,
    duration_load_bps,
    loss_rate_bps,
    premium_bps,
    quantise_risk,
    strip_fences,
)

# Short local aliases keep the assertions readable; the names under test are
# the module-level functions the contract itself calls.
loss_rate = loss_rate_bps
premium = premium_bps
collateral = collateral_bps
duration = duration_load_bps
concentration = concentration_load_bps
quantise = quantise_risk


# ---------------------------------------------------------------- loss rate


def test_unproven_agent_pays_the_median_rate():
    """No history is not the same as a clean history."""
    assert loss_rate(0, 0) == 1000  # 10.00%


def test_clean_record_converges_downward_but_never_to_zero():
    assert loss_rate(0, 100 * SCALE) == 230
    assert loss_rate(0, 1000 * SCALE) == 29
    assert loss_rate(0, 10_000 * SCALE) > 0


def test_failures_raise_the_rate_monotonically():
    rates = [loss_rate(n * SCALE, 50 * SCALE) for n in range(0, 20)]
    assert rates == sorted(rates)
    assert rates[0] < rates[-1]


def test_rate_approaches_the_observed_frequency_with_evidence():
    """A 20% failer with a long record should be priced near 20%, not near the prior."""
    observed = loss_rate(200 * SCALE, 800 * SCALE)
    assert 1950 < observed < 2050


def test_one_failure_costs_more_when_history_is_short():
    """The prior should dominate early and get out of the way later."""
    early = loss_rate(1 * SCALE, 4 * SCALE) - loss_rate(0, 5 * SCALE)
    late = loss_rate(1 * SCALE, 499 * SCALE) - loss_rate(0, 500 * SCALE)
    assert early > late * 10


def _settle(wf: int, wh: int, honored: bool) -> tuple[int, int]:
    """One settlement, applying decay exactly as `_resolve` does."""
    from GenBonds import DECAY_DEN, DECAY_NUM

    wf = (wf * DECAY_NUM) // DECAY_DEN
    wh = (wh * DECAY_NUM) // DECAY_DEN
    return (wf, wh + SCALE) if honored else (wf + SCALE, wh)


def test_decay_caps_how_much_trust_a_record_can_buy():
    """
    A perfect agent converges to a floor and stops. That is the point of the
    decay: this market will never hold more than about a hundred settlements'
    worth of evidence, so no agent can outrun its own risk by being old.
    """
    wf, wh = 0, 0
    for _ in range(2_000):
        wf, wh = _settle(wf, wh, honored=True)
    floor = loss_rate(wf, wh)
    assert 225 < floor < 235
    assert premium(floor, 0, 0, 100) > PREMIUM_FLOOR_BPS


def test_a_flawless_record_still_gets_repriced_by_one_breach():
    wf, wh = 0, 0
    for _ in range(2_000):
        wf, wh = _settle(wf, wh, honored=True)
    before = premium(loss_rate(wf, wh), 0, 0, 100)
    wf, wh = _settle(wf, wh, honored=False)
    after = premium(loss_rate(wf, wh), 0, 0, 100)
    assert after - before > 50  # at least half a percentage point of face


def test_honouring_a_bond_never_raises_the_price():
    """
    Regression guard. With too aggressive a decay, a single honoured bond
    cannot replace the evidence the decay just erased, and being good makes an
    agent look worse. Every reachable record must be safe from that.
    """
    wf, wh = 0, 0
    for _ in range(400):
        before = loss_rate(wf, wh)
        wf, wh = _settle(wf, wh, honored=True)
        assert loss_rate(wf, wh) <= before, f"honouring raised the rate at {wf},{wh}"


# ------------------------------------------------------------------- loads


def test_duration_load_grows_then_caps():
    assert duration(1) == 4
    assert duration(24) == 96
    assert duration(10_000) == 400


def test_concentration_load_punishes_pool_overexposure():
    assert concentration(10, 1000) == 20
    assert concentration(500, 1000) == 600  # capped
    assert concentration(1, 0) == 600  # an empty pool has no appetite


# ----------------------------------------------------------------- premium


def test_premium_never_below_floor_or_above_cap():
    assert premium(0, 0, 0, 100) >= PREMIUM_FLOOR_BPS
    assert premium(9_000, 400, 600, 400) == PREMIUM_CAP_BPS


def test_difficulty_multiplier_loads_risk_but_not_expenses():
    """Expense load is a flat cost of doing business, not a risk charge."""
    single = premium(1000, 0, 0, 100)
    double = premium(1000, 0, 0, 200)
    assert single == 1050
    assert double == 2050


def test_premium_is_monotonic_in_every_input():
    base = premium(1000, 100, 100, 150)
    assert premium(1100, 100, 100, 150) > base
    assert premium(1000, 200, 100, 150) > base
    assert premium(1000, 100, 200, 150) > base
    assert premium(1000, 100, 100, 175) > base


def test_repricing_after_a_breach_is_visible_to_the_next_counterparty():
    """The whole thesis in one assertion: failure has to show up in the price."""
    before = premium(loss_rate(0, 40 * SCALE), 0, 0, 100)
    after = premium(loss_rate(1 * SCALE, 40 * SCALE), 0, 0, 100)
    assert after > before
    assert after - before > 100  # at least a full percentage point of face


# -------------------------------------------------------------- collateral


def test_collateral_scales_with_the_record_and_stays_bounded():
    assert collateral(0) == MIN_COLLATERAL_BPS
    assert collateral(1000) == 3000
    assert collateral(9_000) == MAX_COLLATERAL_BPS
    for rate in range(0, 10_000, 137):
        assert MIN_COLLATERAL_BPS <= collateral(rate) <= MAX_COLLATERAL_BPS


def test_obligor_always_has_more_at_risk_than_it_pays_in_premium():
    """If the premium ever exceeds the collateral, breaching becomes rational."""
    for wf in range(0, 30):
        rate = loss_rate(wf * SCALE, 30 * SCALE)
        face = 10**18
        prem = (face * premium(rate, 400, 600, 100)) // BPS
        coll = (face * collateral(rate)) // BPS
        assert coll > prem


# ---------------------------------------------------------------- quantise


def test_difficulty_quantises_to_a_step_validators_can_agree_on():
    assert quantise(137) == 125
    assert quantise(138) == 150
    assert quantise(1) == RISK_MULT_MIN
    assert quantise(10_000) == RISK_MULT_MAX
    for raw in range(RISK_MULT_MIN, RISK_MULT_MAX + 1):
        assert quantise(raw) % 25 == 0


def test_quantising_alone_does_not_make_validators_agree():
    """
    A trap worth keeping a test on. Rounding to a step does NOT collapse nearby
    scores: 187 and 193 are six points apart and land on different steps
    because a boundary runs between them. That is why `bind()` compares raw
    scores within a tolerance band and stores the leader's quantised value,
    rather than asking validators to agree on the rounded number.
    """
    assert quantise(187) != quantise(193)
    assert abs(187 - 193) <= 25  # accepted by the band, as it should be


def test_quantised_values_are_stable_away_from_boundaries():
    assert quantise(202) == quantise(210) == 200


# ------------------------------------------------------------------ fences


def test_json_survives_a_model_that_fences_its_output():
    assert json.loads(strip_fences('```json\n{"risk_mult": 150}\n```'))["risk_mult"] == 150
    assert json.loads(strip_fences('{"risk_mult": 150}'))["risk_mult"] == 150


# ------------------------------------------------- cross-language agreement


def test_pricing_vectors_match_the_typescript_mirror():
    """
    The frontend re-prices quotes locally so the sliders stay live. That mirror
    is only allowed to exist if it agrees with the contract exactly, so both
    implementations are pinned to the same vectors in `tests/vectors.json`.
    """
    vectors = json.loads((ROOT / "tests" / "vectors.json").read_text())
    for v in vectors:
        rate = loss_rate(v["weighted_failures"], v["weighted_honored"])
        assert rate == v["loss_rate_bps"], v
        assert collateral(rate) == v["collateral_bps"], v
        assert (
            premium(
                rate,
                duration(v["duration_hours"]),
                concentration(v["exposure_after"], v["pool_capital"]),
                quantise(v["risk_mult_raw"]),
            )
            == v["premium_bps"]
        ), v


if __name__ == "__main__":
    # Runs under pytest in CI, and under a bare interpreter anywhere else.
    # An actuarial core you can only test with a toolchain installed is an
    # actuarial core people stop testing.
    failures = 0
    for name, fn in sorted(dict(globals()).items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  ok    {name}")
        except AssertionError as exc:  # noqa: PERF203
            failures += 1
            print(f"  FAIL  {name}: {exc}")
    print(f"\n{failures} failed")
    raise SystemExit(1 if failures else 0)
