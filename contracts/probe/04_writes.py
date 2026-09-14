# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Probe 4 — write methods and the payable decorator.

Adds: @gl.public.write, @gl.public.write.payable, gl.message.sender_address,
gl.message.value, a bool parameter, and a write returning int.

`@gl.public.write.payable` is the highest-risk line in this file. Decorators
run when the class body executes, so if that attribute path is wrong on this
SDK version, the module dies on load and Studio reports exactly the schema
error you are seeing — with no hint that one decorator caused it.
"""

from genlayer import *


class GenBonds(gl.Contract):
    owner: Address
    trusted_evidence_host: str
    pool_capital: u256
    ledger: TreeMap[Address, u256]

    def __init__(self, trusted_evidence_host: str):
        self.owner = gl.message.sender_address
        self.trusted_evidence_host = trusted_evidence_host
        self.pool_capital = u256(0)

    def _balance(self, account: Address) -> int:
        if account in self.ledger:
            return int(self.ledger[account])
        return 0

    @gl.public.view
    def balance_of(self, account: Address) -> str:
        return str(self._balance(account))

    @gl.public.write.payable
    def deposit(self) -> None:
        amount = int(gl.message.value)
        if amount <= 0:
            raise Exception("deposit must be positive")
        sender = gl.message.sender_address
        self.ledger[sender] = u256(self._balance(sender) + amount)

    @gl.public.write
    def stake(self, amount: str) -> None:
        value = int(amount)
        sender = gl.message.sender_address
        if value > self._balance(sender):
            raise Exception("insufficient balance")
        self.ledger[sender] = u256(self._balance(sender) - value)
        self.pool_capital = u256(int(self.pool_capital) + value)

    @gl.public.write
    def bind(self, principal: str, face_value: str, duration_hours: int) -> int:
        bond_id = 1
        return bond_id

    @gl.public.write
    def resolve_dispute(self, bond_id: int, honored: bool, note: str) -> str:
        if gl.message.sender_address != self.owner:
            raise Exception("only the arbiter can resolve a dispute")
        return note[:160]
