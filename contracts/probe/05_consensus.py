# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Probe 5 — the three non-deterministic call sites.

Adds: gl.eq_principle.prompt_comparative, gl.nondet.exec_prompt,
gl.nondet.web.render, and gl.advanced.run_nondet with a deterministic
validator, plus `import time` inside the block rather than at module scope.

These are only *referenced* inside function bodies, so a wrong name here fails
at call time, not load time — this probe should load even if an API name has
moved. If it loads and `settle` later throws, the name is the thing to fix.
"""

from genlayer import *

import json

CLOCK_TOLERANCE_S = 600


class GenBonds(gl.Contract):
    trusted_evidence_host: str

    def __init__(self, trusted_evidence_host: str):
        self.trusted_evidence_host = trusted_evidence_host

    @gl.public.write
    def assess(self, criteria: str) -> str:
        def run() -> str:
            return gl.nondet.exec_prompt(
                'Reply with ONLY this JSON: {"risk_mult": 150}\n\n' + criteria
            )

        return gl.eq_principle.prompt_comparative(
            run, criteria="Both outputs must be JSON with the same risk_mult."
        )

    @gl.public.write
    def read_artifact(self, url: str) -> str:
        def run() -> str:
            return gl.nondet.web.render(url, mode="text")[:400]

        return gl.eq_principle.prompt_comparative(
            run, criteria="Both outputs describe the same page."
        )

    @gl.public.write
    def now(self) -> str:
        def leader() -> str:
            import time

            return json.dumps({"now": int(time.time())})

        def validator(leader_result: str) -> bool:
            import time

            theirs = int(json.loads(leader_result)["now"])
            delta = int(time.time()) - theirs
            if delta < 0:
                delta = -delta
            return delta <= CLOCK_TOLERANCE_S

        return gl.advanced.run_nondet(leader, validator)
