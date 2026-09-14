"""
Integration tests for GenBonds against a running GenLayer node.

These cover the parts that unit tests deliberately cannot: storage, value
movement, and the three places consensus is involved (difficulty scoring at
bind, artifact adjudication at settle, and clock agreement when nothing was
delivered).

    pip install genlayer-test
    gltest tests/test_settlement.py

They are skipped automatically when no node is reachable, so `python3
tests/test_pricing.py` stays the fast loop and this stays the honest one.
"""

import pytest

gltest = pytest.importorskip("gltest", reason="requires a GenLayer node")

from gltest import create_account, get_contract_factory  # noqa: E402
from gltest.assertions import tx_execution_succeeded  # noqa: E402

ETH = 10**18
TRUSTED_HOST = "https://artifacts.genbonds.dev"

GOOD_CRITERIA = (
    "Return structured JSON for all 50 URLs in the input list. Every row must "
    "carry price, currency and availability. Missing rows are a breach."
)


@pytest.fixture
def deployed():
    factory = get_contract_factory("GenBonds")
    return factory.deploy(args=[TRUSTED_HOST])


def test_unproven_agent_is_quoted_the_median_rate(deployed):
    obligor = create_account()
    quote = deployed.quote(
        args=[obligor.address, str(10 * ETH), 24, 100]
    ).call()
    assert quote["loss_rate_bps"] == 1000
    assert quote["collateral_bps"] == 3000


def test_bind_takes_premium_and_collateral_and_allocates_capital(deployed):
    underwriter = create_account()
    obligor = create_account()

    deployed.deposit(value=500 * ETH, account=underwriter).transact()
    deployed.stake(args=[str(500 * ETH)], account=underwriter).transact()
    deployed.deposit(value=20 * ETH, account=obligor).transact()

    before = int(deployed.balance_of(args=[obligor.address]).call())
    receipt = deployed.bind(
        args=[underwriter.address, str(10 * ETH), 24, 9_999_999_999, GOOD_CRITERIA],
        account=obligor,
    ).transact()
    assert tx_execution_succeeded(receipt)

    after = int(deployed.balance_of(args=[obligor.address]).call())
    assert after < before, "premium and collateral were not taken"

    pool = deployed.pool().call()
    assert int(pool["allocated"]) > 0


def test_thin_criteria_are_rejected_before_they_reach_consensus(deployed):
    obligor = create_account()
    deployed.deposit(value=20 * ETH, account=obligor).transact()
    with pytest.raises(Exception, match="specific enough"):
        deployed.bind(
            args=[obligor.address, str(ETH), 24, 9_999_999_999, "do the thing"],
            account=obligor,
        ).transact()


def test_evidence_from_an_untrusted_host_is_inadmissible(deployed):
    """An underwriter that reads any URL you hand it is an underwriter you can rob."""
    underwriter = create_account()
    obligor = create_account()
    deployed.deposit(value=500 * ETH, account=underwriter).transact()
    deployed.stake(args=[str(500 * ETH)], account=underwriter).transact()
    deployed.deposit(value=20 * ETH, account=obligor).transact()

    bond_id = deployed.bind(
        args=[underwriter.address, str(5 * ETH), 24, 9_999_999_999, GOOD_CRITERIA],
        account=obligor,
    ).transact()["result"]

    with pytest.raises(Exception, match="trusted host"):
        deployed.submit_delivery(
            args=[bond_id, "https://attacker.example/artifact"], account=obligor
        ).transact()


def test_breach_pays_the_principal_and_reprices_the_obligor(deployed):
    """The thesis, end to end: failing has to change what the next bond costs."""
    underwriter = create_account()
    principal = create_account()
    obligor = create_account()

    deployed.deposit(value=500 * ETH, account=underwriter).transact()
    deployed.stake(args=[str(500 * ETH)], account=underwriter).transact()
    deployed.deposit(value=20 * ETH, account=obligor).transact()

    before = deployed.price_of_trust(args=[obligor.address]).call()

    # A deadline in the past with nothing delivered settles on the clock alone.
    bond_id = deployed.bind(
        args=[principal.address, str(5 * ETH), 1, 1_600_000_000, GOOD_CRITERIA],
        account=obligor,
    ).transact()["result"]

    outcome = deployed.settle(args=[bond_id]).transact()["result"]
    assert outcome["state"] == "breached"
    assert int(outcome["paid_to_principal"]) == 5 * ETH

    after = deployed.price_of_trust(args=[obligor.address]).call()
    assert after["loss_rate_bps"] > before["loss_rate_bps"]
    assert after["collateral_bps"] > before["collateral_bps"]
    assert int(after["collateral_lost"]) > 0
