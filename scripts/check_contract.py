"""
Static gate for GenVM deploy hazards.

Two distinct failure modes look nothing alike, so this gate checks for both.

**Schema extraction** runs the module before Studio ever shows the deploy
button. A contract can be valid Python, pass every unit test, and still fail
here with nothing more than `Could not load contract schema` — no traceback,
no line number. Five things cause it:

  0. A runtime alias hosted Studio cannot resolve. `py-genlayer:test` works
     against a local Studio and fails against studio.genlayer.com, which is the
     most confusing version of this failure: line 1 is wrong, so nothing below
     it is ever read, and rewriting the contract changes nothing.
  1. Non-deterministic imports at module scope. `import time` at the top of the
     file fails on load — a clock may only exist inside a non-deterministic
     block, so the import belongs inside that block too.
  2. `@staticmethod` or `@classmethod` inside the contract class. The runtime
     walks the class body as a set of contract methods. Pure helpers go at
     module level, where they are also easier to test.
  3. Bare `dict`, `list`, `tuple` or `set` return annotations on methods.
     Heterogeneous mappings do not cross the boundary; return a JSON string.
  4. Two-argument `.get(key, default)` on storage maps. TreeMap is not a dict.
     Use an explicit `in` check — which also stops phantom records being
     materialised on read.

**Execution** is a different failure entirely: the module loads, the deploy
transaction is picked up, the validators reach consensus, and only *then* does
your `__init__` or a method body throw. Studio reports this as
`Status: FINALIZED, Result: ERROR` with a real Python traceback — genuinely
more informative than the schema error, but only after you've spent a deploy
cycle finding out. Two things in this category are checked so far:

  5. `gl.message.sender_account`. `MessageType` has no such field — it never
     did. The real fields are `contract_address`, `sender_address`,
     `origin_address`, `value`, `chain_id`. This one cost a full deploy-and-wait
     cycle to surface as `AttributeError: 'MessageType' object has no attribute
     'sender_account'`, which is exactly the cost this gate exists to avoid.
  6. `prompt_comparative(..., criteria=...)`. This function takes one keyword
     argument, `principle`. `criteria` belongs to a different function,
     `prompt_non_comparative`, which pairs it with `task` — two functions,
     similar-sounding parameters, easy to cross. Surfaced as `TypeError:
     prompt_comparative() got an unexpected keyword argument 'criteria'`, and
     only after `bind()` had already reached consensus and started pricing.

    python3 scripts/check_contract.py
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "GenBonds.py"

# Deterministic and available inside GenVM at module scope.
ALLOWED_MODULE_IMPORTS = {"genlayer", "json", "dataclasses"}

UNSUPPORTED_RETURNS = ("dict", "list", "tuple", "set")

# Line 1 must declare the runtime. `py-genlayer:test` is a local-Studio alias
# and does not resolve on hosted studio.genlayer.com — the module then fails to
# load and every error downstream is the same unhelpful sentence.
DEPENDS = re.compile(r'^#\s*\{\s*"Depends"\s*:\s*"py-genlayer:([^"]+)"\s*\}\s*$')


def check_runtime(path: Path) -> list[str]:
    first = path.read_text().splitlines()[0] if path.read_text() else ""
    match = DEPENDS.match(first)
    if not match:
        return [
            "line 1: missing or malformed runtime declaration — it must be "
            'exactly `# { "Depends": "py-genlayer:<runtime>" }` with nothing '
            "above it, not even a blank line"
        ]
    runtime = match.group(1)
    if runtime == "test":
        return [
            "line 1: runtime is `py-genlayer:test`, a local-Studio alias. "
            "Hosted Studio cannot resolve it and reports `Could not load "
            "contract schema`. Use the hashed runtime from the docs, or copy "
            "line 1 from a stock example contract in your Studio."
        ]
    return []


def check(path: Path) -> list[str]:
    tree = ast.parse(path.read_text())
    problems: list[str] = check_runtime(path)

    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_MODULE_IMPORTS:
                    problems.append(
                        f"line {node.lineno}: module-scope `import {alias.name}` — "
                        "move it inside the non-deterministic block that needs it"
                    )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in ALLOWED_MODULE_IMPORTS:
                problems.append(
                    f"line {node.lineno}: module-scope `from {node.module} import ...`"
                )

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and any(
            isinstance(base, ast.Attribute) and base.attr == "Contract"
            for base in node.bases
        ):
            for item in node.body:
                if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for dec in item.decorator_list:
                    if isinstance(dec, ast.Name) and dec.id in ("staticmethod", "classmethod"):
                        problems.append(
                            f"line {item.lineno}: @{dec.id} `{item.name}` inside the "
                            "contract class — move it to module level"
                        )
                if item.returns is not None:
                    text = ast.unparse(item.returns)
                    if text in UNSUPPORTED_RETURNS or text.startswith(
                        tuple(f"{t}[" for t in UNSUPPORTED_RETURNS)
                    ):
                        problems.append(
                            f"line {item.lineno}: `{item.name}` returns `{text}` — "
                            "return a JSON string instead"
                        )

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and len(node.args) == 2
        ):
            problems.append(
                f"line {node.lineno}: two-argument `.get()` — storage maps are not "
                "dicts; use an explicit `in` check"
            )

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "sender_account"
        ):
            problems.append(
                f"line {node.lineno}: `.sender_account` — MessageType has no "
                "such field. The real fields are contract_address, "
                "sender_address, origin_address, value, chain_id. Use "
                "`gl.message.sender_address`."
            )

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "prompt_comparative"
        ):
            for kw in node.keywords:
                if kw.arg == "criteria":
                    problems.append(
                        f"line {node.lineno}: `prompt_comparative(..., "
                        "criteria=...)` — this function's only keyword "
                        "argument is `principle`. `criteria` belongs to "
                        "`prompt_non_comparative`, which takes `task` and "
                        "`criteria` separately; `prompt_comparative` takes "
                        "one combined `principle` string instead."
                    )

    # A TreeMap[Address, <dataclass>] writes fine and cannot be read back on
    # Studio's GenVM. Detect any storage annotation of that shape.
    dataclass_names = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
        and any(
            (isinstance(d, ast.Name) and d.id == "dataclass") for d in node.decorator_list
        )
    }
    for node in ast.walk(tree):
        if not isinstance(node, ast.AnnAssign) or node.annotation is None:
            continue
        text = ast.unparse(node.annotation)
        if not text.startswith("TreeMap[Address,"):
            continue
        value_type = text[len("TreeMap[Address,") : -1].strip()
        if value_type in dataclass_names:
            problems.append(
                f"line {node.lineno}: `TreeMap[Address, {value_type}]` — this "
                "shape writes without complaint and fails on read back, inside "
                "the runtime's decode path, with no contract frame in the "
                "traceback. It only breaks once an entry exists, so a fresh "
                "contract looks healthy. Use flat TreeMap[Address, u256] "
                "fields instead. Reproduced in "
                "contracts/probe/06_address_dataclass_treemap.py."
            )

    # `Address` as a PUBLIC METHOD PARAMETER fails on Studio's GenVM with a
    # bare runtime error. Accept `str` at the boundary and convert inside.
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        is_public = any(
            "public" in ast.unparse(d) for d in node.decorator_list
        )
        if not is_public:
            continue
        for arg in node.args.args:
            if arg.annotation is not None and ast.unparse(arg.annotation) == "Address":
                problems.append(
                    f"line {node.lineno}: public method `{node.name}` takes "
                    f"`{arg.arg}: Address`. Address parameters fail at the "
                    "contract boundary on Studio's GenVM. Take `str` and call "
                    "`Address(...)` inside the method."
                )

    # gl.advanced.run_nondet does not exist; the namespace is gl.vm.
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "run_nondet":
            path = ast.unparse(node)
            if "gl.advanced" in path:
                problems.append(
                    f"line {node.lineno}: `gl.advanced.run_nondet` — the "
                    "non-deterministic block namespace is `gl.vm.run_nondet`."
                )

    return problems


def main() -> int:
    problems = check(CONTRACT)
    if problems:
        print(f"{CONTRACT.relative_to(ROOT)} has known deploy hazards:\n")
        for problem in problems:
            print(f"  × {problem}")
        print("\nSee the docstring in this file for why each one breaks, and "
              "whether it fails before deploy (schema) or during it (execution).")
        return 1
    print(f"  ok    {CONTRACT.relative_to(ROOT)} is free of known deploy hazards")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
