# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Probe 3 — the actuarial core and JSON returns.

Adds: module-level pure functions, json.dumps, a storage dataclass with str
fields, and a view returning a JSON string. If this is where it breaks, the
problem is module-level helpers or the Bond record — not consensus.
"""

from genlayer import *

import json
from dataclasses import dataclass

BPS = 10_000
SCALE = 1_000
PRIOR_FAILURES = 3 * SCALE
PRIOR_TASKS = 30 * SCALE
EXPENSE_BPS = 50
PREMIUM_FLOOR_BPS = 25
PREMIUM_CAP_BPS = 5_000


def loss_rate_bps(weighted_failures: int, weighted_honored: int) -> int:
    numerator = (weighted_failures + PRIOR_FAILURES) * BPS
    denominator = weighted_failures + weighted_honored + PRIOR_TASKS
    return numerator // denominator


def premium_bps(loss_rate: int, duration_load: int, concentration_load: int, risk_mult: int) -> int:
    risk_loaded = ((loss_rate + duration_load + concentration_load) * risk_mult) // 100
    total = risk_loaded + EXPENSE_BPS
    if total < PREMIUM_FLOOR_BPS:
        return PREMIUM_FLOOR_BPS
    if total > PREMIUM_CAP_BPS:
        return PREMIUM_CAP_BPS
    return total


@allow_storage
@dataclass
class Bond:
    id: u256
    principal: Address
    obligor: Address
    face_value: u256
    state: u256
    criteria: str
    artifact_url: str


def bond_json(b: Bond) -> str:
    return json.dumps(
        {
            "id": int(b.id),
            "obligor": b.obligor.as_hex,
            "face_value": str(int(b.face_value)),
            "state": int(b.state),
            "criteria": b.criteria,
        }
    )


class GenBonds(gl.Contract):
    trusted_evidence_host: str
    next_bond_id: u256
    bonds: TreeMap[u256, Bond]

    def __init__(self, trusted_evidence_host: str):
        self.trusted_evidence_host = trusted_evidence_host
        self.next_bond_id = u256(1)

    @gl.public.view
    def price_of_trust(self, agent: Address) -> str:
        loss = loss_rate_bps(0, 0)
        return json.dumps(
            {
                "agent": agent.as_hex,
                "loss_rate_bps": loss,
                "base_premium_bps": premium_bps(loss, 0, 0, 100),
            }
        )

    @gl.public.view
    def get_bond(self, bond_id: int) -> str:
        key = u256(bond_id)
        if key not in self.bonds:
            return json.dumps({"error": "unknown bond"})
        return bond_json(self.bonds[key])
