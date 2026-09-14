# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Probe 1 — the smallest thing that can have a constructor.

If this fails, nothing is wrong with GenBonds: the runtime string, the Studio
tab, or the paste itself is the problem.
"""

from genlayer import *


class GenBonds(gl.Contract):
    trusted_evidence_host: str

    def __init__(self, trusted_evidence_host: str):
        self.trusted_evidence_host = trusted_evidence_host

    @gl.public.view
    def host(self) -> str:
        return self.trusted_evidence_host
