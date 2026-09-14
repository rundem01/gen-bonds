"""
A minimal stand-in for the GenLayer runtime.

This exists for one reason: the actuarial core of GenBonds is pure integer
arithmetic, and pure arithmetic should be testable without a node, a validator
set, or a language model. The stub gives `contracts/GenBonds.py` just enough of
the runtime surface to import, so the pricing functions can be exercised
directly and compared against the TypeScript mirror the frontend ships.

It is a test fixture. It is not a simulator, and nothing in `tests/` that
touches consensus, storage or value transfer should rely on it — those belong
in `gltest` against a real node.
"""

from __future__ import annotations

import typing


def _passthrough(fn):
    return fn


class _Public:
    view = staticmethod(_passthrough)

    class _Write:
        def __call__(self, fn):
            return fn

        payable = staticmethod(_passthrough)

    write = _Write()


class _Message:
    """
    Mirrors genlayer.MessageType's real fields — contract_address,
    sender_address, origin_address, value, chain_id — so a wrong attribute
    name (e.g. the nonexistent `sender_account`) fails here, in a fast local
    test, instead of surfacing only after a deploy to Studio.
    """

    contract_address = None
    sender_address = None
    origin_address = None
    value = 0
    chain_id = 0


class _Web:
    @staticmethod
    def render(url: str, mode: str = "text") -> str:  # pragma: no cover
        raise RuntimeError("web access is unavailable in unit tests")


class _Nondet:
    web = _Web()

    @staticmethod
    def exec_prompt(prompt: str) -> str:  # pragma: no cover
        raise RuntimeError("model access is unavailable in unit tests")


class _EqPrinciple:
    @staticmethod
    def prompt_comparative(fn, *, principle: str):  # pragma: no cover
        raise RuntimeError("consensus is unavailable in unit tests")

    @staticmethod
    def prompt_non_comparative(fn, *, task: str, criteria: str):  # pragma: no cover
        raise RuntimeError("consensus is unavailable in unit tests")

    @staticmethod
    def strict_eq(fn):  # pragma: no cover
        raise RuntimeError("consensus is unavailable in unit tests")


class _Advanced:
    @staticmethod
    def run_nondet(leader, validator):  # pragma: no cover
        raise RuntimeError("consensus is unavailable in unit tests")


class _Contract:
    pass


class gl:  # noqa: N801 - mirrors the runtime's lowercase namespace
    Contract = _Contract
    public = _Public()
    message = _Message()
    nondet = _Nondet()
    eq_principle = _EqPrinciple()
    advanced = _Advanced()


class Address(str):
    def __new__(cls, value: str = "0x0"):
        return super().__new__(cls, value)

    @property
    def as_hex(self) -> str:
        return str(self)


class u256(int):
    pass


class i32(int):
    pass


class _Generic:
    def __class_getitem__(cls, item):
        return cls


class TreeMap(dict, _Generic):
    pass


class DynArray(list, _Generic):
    pass


def allow_storage(cls):
    return cls


__all__ = [
    "gl",
    "Address",
    "u256",
    "i32",
    "TreeMap",
    "DynArray",
    "allow_storage",
    "typing",
]
