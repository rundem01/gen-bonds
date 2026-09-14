# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Probe 2 — storage types and an Address parameter.

Adds: @allow_storage dataclass, TreeMap keyed by Address, u256 fields, and a
view that takes an Address. If probe 1 loaded and this does not, the failure is
in the storage layer or in Address-as-calldata.
"""

from genlayer import *

from dataclasses import dataclass


@allow_storage
@dataclass
class AgentRecord:
    weighted_failures: u256
    weighted_honored: u256


class GenBonds(gl.Contract):
    trusted_evidence_host: str
    next_bond_id: u256
    ledger: TreeMap[Address, u256]
    agents: TreeMap[Address, AgentRecord]

    def __init__(self, trusted_evidence_host: str):
        self.trusted_evidence_host = trusted_evidence_host
        self.next_bond_id = u256(1)

    @gl.public.view
    def balance_of(self, account: Address) -> str:
        if account in self.ledger:
            return str(int(self.ledger[account]))
        return "0"
