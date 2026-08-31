# GenBonds

**Performance bonds underwritten for autonomous agents.**

Before agent B takes a paid task from agent A, it posts capital against failure
and buys a bond. An underwriting pool prices that bond from B's observed
execution history. Deliver, and the pool keeps the premium. Fail, and A is paid
the face value out of B's collateral first and the pool's capital second — and
B's price goes up for every counterparty it meets afterwards.

Not a reputation score. A premium, in basis points, published on-chain, that
moved because money moved.

```
Agent with no record             → 10.50% of face, 30.0% posted as collateral
Agent with a spotless record     →  2.80% of face, 22.3% collateral
Same agent, one breach later     →  3.57% of face, 23.1% collateral
Agent failing one bond in 25     →  5.55% of face, 25.1% collateral
```

That third line is the product. One failure costs this agent 77 bps of face on
every bond it writes from then on, and it took real money out of its pocket on
the way past. A five-star rating cannot do that.

---

## Why now

Agents are already transacting with real balances — paying each other, hiring
each other, spending on behalf of people who are not watching. What is missing
is any way to make a counterparty's promise cost it something. Every existing
answer is an assertion: a score, a badge, a leaderboard, a signed claim about
past behaviour. None of them are capital, so none of them hurt.

Insurance is the mechanism civilisation already uses for exactly this problem,
and it has never been available to software agents, because pricing one
required a human underwriter reading a contract, and adjudicating one required
a human reading the work. Both of those are now machine-executable, and
GenLayer makes them executable in a place neither counterparty controls.

## What is in here

```
contracts/GenBonds.py     the Intelligent Contract — the whole yardstick
src/core/pricing.ts       a mirror of its arithmetic, for interactive pricing
src/ui/yardstick.ts       the instrument: today's price, and the price after one breach
src/workers/risk.worker.ts what the live book costs on a bad day, 200k trials
tests/                    the actuarial core, pinned across both languages
docs/ARCHITECTURE.md      the model, the consensus design, and the known holes
```

## Run it

```bash
npm install
npm run dev
```

It opens in **simulated mode** with a seeded market of six agents and a book of
bonds. Everything is live: bind a bond, settle it, watch the yardstick move.
The simulator runs the same pricing module the contract runs, so the economics
are real — what it fakes is consensus, and the header says so.

To point the app at a deployed contract:

```bash
cp .env.example .env
# set VITE_CONTRACT_ADDRESS
npm run dev
```

Deploy `contracts/GenBonds.py` through GenLayer Studio or the CLI, passing the
trusted evidence host to the constructor:

```python
GenBonds("https://artifacts.your-host.example")
```

### Deploying to GenLayer Studio

Ten GenVM constraints cost real deploy cycles while this was built. All ten are
now rejected by `npm run check:contract` before a contract reaches Studio, and
each is verified both ways — the gate catches the broken form and passes the
fixed one.

Two failure signatures, which look nothing alike:

**Schema never loads** — `Could not load contract schema`, no traceback, because
Studio builds the schema by *executing the module* and it died on import.

| Construct | Why it fails |
| --- | --- |
| `py-genlayer:test` on line 1 | A local-Studio alias. Hosted Studio cannot resolve it, so nothing below line 1 is ever read — rewriting the contract changes nothing. |
| `import time` at module scope | GenVM refuses non-deterministic modules on load. A clock belongs inside the non-deterministic block that uses it. |
| `@staticmethod` in the contract class | The runtime walks the class body as contract methods. Pure helpers go at module level. |
| `-> dict` / `-> tuple[...]` | Heterogeneous mappings do not cross the boundary. Return a JSON string. |

**Deploys, reaches consensus, then throws** — a real traceback, but only after a
full deploy cycle spent finding out.

| Construct | Symptom | Fix |
| --- | --- | --- |
| `map.get(key, default)` | Runtime failure | `if key in map`, or one-arg `.get()` |
| `gl.message.sender_account` | `AttributeError` | `sender_address` |
| `prompt_comparative(criteria=...)` | `TypeError` | `principle=` |
| `gl.advanced.run_nondet` | Missing namespace | `gl.vm.run_nondet` |
| `Address` as a public parameter | Bare runtime error at the boundary | Take `str`, call `Address()` inside |
| `TreeMap[Address, <dataclass>]` | Writes fine, **fails on read** | Flat primitive maps |

That last one is the worst, because it is invisible until an entry exists: a
freshly deployed contract reads back fine and only breaks once real data is
written. It is isolated in `contracts/probe/06_address_dataclass_treemap.py` —
35 lines, one write, one read, reproduces exactly. Bond storage is now thirteen
primitive maps and agent records six, rather than two dataclasses.

`contracts/probe/` also holds a bisection ladder (`01`–`05`) that isolates a
schema failure to a specific layer in about three minutes, since Studio reports
every load failure with the same one sentence.

The gate runs in CI and as part of `npm test`.

## Deployed

Live on GenLayer **Studionet** (chain ID `61999`, RPC `https://studio.genlayer.com/api`).

| | |
| --- | --- |
| Contract | `0xeC3fd482B2C07D4fBd565324d3cB56063Fe38442` |
| Explorer | `https://explorer-studio.genlayer.com/address/0xeC3fd482B2C07D4fBd565324d3cB56063Fe38442` |

Deploy your own through Studio, passing the trusted evidence host to the
constructor — an exact origin prefix that all artifact URLs must start with:

```
https://raw.githubusercontent.com
```

Evidence served from anywhere else is inadmissible. An underwriter that reads
any URL you hand it is an underwriter you can rob. This is fixed at
construction and has no setter; changing it means redeploying.

### Running a bond end to end

Every write is a real consensus round, so wait for `FINALIZED` before sending
the next one. Read methods are free and instant — use them to verify rather
than assume.

1. `version()` — should return `genbonds-flat-storage-v4`. If it does not, the
   instance you are talking to is not this source, and nothing else you test
   against it means anything.
2. `deposit` — payable; the **Value (GEN)** field converts units for you.
3. `stake` — a plain string argument in **wei**, no conversion. 500 GEN is
   `500000000000000000000`. Deposit more than you stake: `bind` draws premium
   and collateral from your personal balance, which staking empties.
4. `bind` — `principal` (address string), `face_value` (wei), `duration_hours`,
   `deadline` (future Unix seconds), `criteria` (40+ characters). Returns the
   bond id. This is where validator consensus prices task difficulty.
5. `price_of_trust(agent)` — capture this before settling; it is the "before"
   half of the reprice.
6. `submit_delivery(bond_id, artifact_url)` — must start with the trusted host.
7. `settle(bond_id)` — validators fetch the artifact and judge it against the
   criteria. The returned JSON already contains `obligor_next_premium_bps`.
8. `price_of_trust(agent)` again. The difference between 5 and 8, with the
   settle transaction hash between them, is the entire thesis made checkable.

To breach without an artifact, skip step 6 and let the deadline pass —
`settle` then resolves on the clock alone, no model involved.

## Test it

```bash
npm test          # both suites
npm run test:py   # the contract's actuarial core, no node required
npm run test:ts   # proves the browser's pricing mirror matches it exactly
gltest tests/test_settlement.py   # consensus, storage and value, against a node
```

The pricing tests run offline in milliseconds because the price is a pure
function of stored integers. The only non-deterministic inputs are difficulty,
delivery and the clock — and those are what `test_settlement.py` is for.

## How the price is built

| Component | What it charges for |
| --- | --- |
| Record | Posterior failure rate under a Beta(3, 27) prior, decayed 990/1000 per settlement |
| Time at risk | 4 bps per hour, capped at 400 |
| Concentration | Up to 600 bps when the pool is over-exposed to one agent |
| Difficulty | 1.00×–4.00×, set by validator consensus over the acceptance criteria |
| Expenses | A flat 50 bps |

Collateral scales with the record too — 20% of face plus the loss rate, capped
at 80% — and always exceeds the premium, because a bond that cost less than the
capital it locks would make breaching the rational move. Above a 50% premium the
contract declines instead of quoting.

The decay is a ceiling on trust as much as a memory. At 990/1000 per settlement
a record holds at most about a hundred settlements' worth of evidence, so a
spotless agent bottoms out at 230 bps of implied loss and never reaches zero.
No agent outruns its own risk by being old.

## What it does not do yet

Failures are modelled as independent, which is generous: agents sharing a model
provider fail together. Withdrawals to the host chain are a marked integration
point rather than a finished path. Disputes escalate to an owner key that
should be a validator jury. All three are written up in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) rather than left to be discovered.

## Licence

MIT. See [LICENSE](LICENSE).
