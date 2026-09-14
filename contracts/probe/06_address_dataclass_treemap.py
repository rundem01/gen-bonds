# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
Probe 6 — isolates one specific question: does Studio's GenVM let you read
back an EXISTING entry from a TreeMap keyed by Address, where the value is a
dataclass rather than a plain number?

This is the one storage shape in GenBonds that's never actually been proven —
`self.agents: TreeMap[Address, AgentRecord]` — and it's the one `price_of_trust`
depends on. Every other TreeMap in the real contract is either Address-keyed
with a plain u256 value (`ledger`, proven via `balance_of`) or u256-keyed with
a dataclass value (`bonds`, proven via `get_bond`). This isolates the one
combination that's neither.

Two calls settle it:
  1. `touch()` — writes one entry for whichever account calls it.
  2. `read_it(that same address)` — tries to read it back.

If `read_it` errors the same way `price_of_trust` has been, this is confirmed
and GenBonds needs `agents` restructured into flat per-field TreeMaps — the
same shape `ledger` already proves works. If `read_it` succeeds, the theory is
wrong and the real cause is still open.
"""

from genlayer import *

from dataclasses import dataclass


@allow_storage
@dataclass
class Rec:
    n: u256


class GenBonds(gl.Contract):
    records: TreeMap[Address, Rec]

    def __init__(self):
        pass

    @gl.public.write
    def touch(self) -> None:
        who = gl.message.sender_address
        self.records[who] = Rec(n=u256(7))

    @gl.public.view
    def read_it(self, who: Address) -> str:
        if who in self.records:
            r = self.records[who]
            return str(int(r.n))
        return "not present"
