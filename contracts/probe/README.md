# Probes

Studio builds a contract's schema by executing the module, and reports every
load failure as the same sentence: **Could not load contract schema.** No
traceback, no line number, no clue which construct did it.

These five files are a bisection ladder. Each adds one layer of API surface to
the one before it. Paste them into the Studio editor in order — each takes about
ten seconds — and the first one that fails names the culprit.

| Probe | Adds | If it fails |
| --- | --- | --- |
| `01_bare.py` | A class, a constructor, one view | Nothing is wrong with GenBonds. The runtime string on line 1, the Studio tab, or the paste is the problem. |
| `02_storage.py` | `@allow_storage` dataclass, `TreeMap`, `u256`, `Address` as a parameter | The storage layer or `Address` as calldata. Likely `allow_storage` or `TreeMap` is not what this SDK version exports. |
| `03_pricing.py` | Module-level functions, `json.dumps`, a record with `str` fields | Module-level helpers or the `Bond` record. Not consensus. |
| `04_writes.py` | `@gl.public.write`, `@gl.public.write.payable`, `gl.message`, `bool` params | Almost certainly `@gl.public.write.payable`. Decorators run when the class body executes, so a wrong attribute path there kills the module on load. |
| `05_consensus.py` | `prompt_comparative`, `exec_prompt`, `web.render`, `run_nondet` | Unlikely — these are referenced inside function bodies, so a moved name fails at call time, not load time. |

Line 1 declares the runtime and must be the first line, exactly, with nothing
above it — not even a blank line. These files use the hashed runtime from the
docs:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

`py-genlayer:test` is a **local-Studio alias** and does not resolve on hosted
studio.genlayer.com. That failure looks identical to every other one, which
makes it the worst of the set: line 1 is wrong, so nothing below it is ever
read, and rewriting the contract body changes nothing. If the hash above is
stale for your Studio, copy line 1 out of any stock example contract in your
own workspace — that version is authoritative for your instance.

Tell me which probe is the first to fail and I will fix that layer specifically.
