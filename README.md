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

## For reviewers — verify it yourself in five minutes

Three levels, each self-contained. The first needs nothing but a browser.

### 1. Read the price off the chain (no wallet, no transaction)

Open [Studio Next](https://studio-next.genlayer.com), load contract
`0x88dbAe3C8D637D0ad53Fe6424c53e72F61566e0c`, and call `price_of_trust` with:

```
0xADB9F0b38CF9Df397bb7D7dbC4B61D7422d86e1b
```

**You should see** an agent that has settled exactly one bond and been punished
for it:

```json
{"loss_rate_bps": 1290, "base_premium_bps": 1340, "collateral_bps": 3290,
 "effective_settlements": 1, "collateral_lost": "300000000000000000",
 "evidenced": true}
```

Before that bond settled, the same call returned `1000 / 1050 / 3000` with
`evidenced: false`. The difference is the entire thesis: 290 basis points of
face value, on every bond this agent writes from now on, plus 0.3 GEN of its
own capital gone.

### 2. Read the verdict that caused it

Transaction `0x86bdd8fac4522de540f1b8a24a751fb40ccbc97b5c804125a31a96d9ed310593`.

**You should see** a validator's own words, not a status code:

```json
{"verdict": "breached", "note": "JSON lacks required data field"}
```

The agent had delivered `{"summary": "Report complete."}` against criteria
requiring both a summary and a data field. A machine read the work, found the
gap, and moved the money.

### 3. Run the whole cycle yourself

Deploy `contracts/GenBonds.py` to Studio Next with any URL prefix as the
trusted evidence host — `https://raw.githubusercontent.com` works. **You should
get a fresh contract address of your own**, and `price_of_trust` on any address
will return the unproven-agent baseline: `1000 / 1050 / 3000`,
`evidenced: false`. Nothing is trusted and nothing is presumed fraudulent; a new
agent pays median-agent prices until the market has evidence.

Then:

| Step | Call | What you should see |
| --- | --- | --- |
| Fund | `deposit` (GEN) → `stake` (wei) | `pool` shows your capital as `free` |
| Price it | `bind` | Consensus scores task difficulty; returns a bond id |
| Deliver | `submit_delivery` | Any URL under your trusted host |
| Settle | `settle` | A validator fetches the file and returns a verdict |
| Check | `price_of_trust` | The same address, repriced |

Deliver something that satisfies your criteria and the bond is honoured, the
premium is earned, and the collateral comes back. Deliver something that misses
them and you will watch the price move against you.

Use **Leader Only** execution mode for `settle` on Studio Next; full consensus
is reliable on stable Studionet but stalls intermittently on the release
candidate.

## Try it

**[gen-bonds-real.vercel.app](https://gen-bonds-real.vercel.app)**

No wallet, no signup. The page opens on a seeded market so the mechanism is
explorable immediately; the header says whether you are looking at simulated
data or the live contract.

**The yardstick** is the instrument at the top. The solid needle is what this
agent's promise costs today, in basis points of face value. The dashed needle
is what it would cost after one more breach. The gap between them is the whole
argument: reliability here is a distance on a scale someone pays to move along,
not a badge. Click the agent chips to switch between them — a clean operator
sits near the left of the rule, a failing one out toward the expensive end.

**The quote slip** prices a specific job. Drag the time slider or edit the
acceptance criteria and watch the premium recompute as you type. That is not a
round trip to the chain: the browser runs a byte-for-byte mirror of the
contract's arithmetic, pinned to the contract by the vectors in `tests/`. Write
vague criteria and the premium rises, because vagueness is priced as risk.

**The book** lists every bond the pool has written. Click one to see what it was
bonded against and how it settled.

**What a bad day costs** runs a 200,000-trial Monte Carlo over the live book in
a worker thread, showing the pool's loss distribution and the chance of
exhausting free capital.

Two things worth doing, in this order: watch the ghost needle move on an
unproven agent, then read the verified run below and confirm the number it
predicted is the number the chain actually produced.

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

### If Studio says "Could not load contract schema"

Studio builds the schema by *executing the module*, so a load-time hazard
surfaces as that message with no traceback attached. Four constructs cause it,
and `npm run check:contract` catches all four before you paste anything in:

| Construct | Why it fails |
| --- | --- |
| `py-genlayer:test` on line 1 | A local-Studio alias. Hosted Studio cannot resolve it, so the module never loads and nothing below line 1 is read — rewriting the contract changes nothing. Use the hashed runtime, or copy line 1 from a stock example in your own Studio. |
| `import time` at module scope | GenVM refuses non-deterministic modules on load. A clock may only exist inside a non-deterministic block, so the import goes there too. |
| `@staticmethod` in the contract class | The runtime walks the class body as contract methods. Pure helpers go at module level — where they are also testable without a node. |
| `-> dict` / `-> tuple[...]` | Heterogeneous mappings do not cross the boundary. Return a JSON string. |
| `map.get(key, default)` | `TreeMap` is not a dict. Use `if key in map`, which also stops phantom records materialising on read. |

The gate runs in CI and as part of `npm test`.

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
