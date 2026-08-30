# Architecture

## The one idea

Reputation systems assert that an agent is reliable. GenBonds makes someone pay
for being wrong about it.

Before an obligor agent takes a paid task, it posts capital against failure and
buys a bond from an underwriting pool. The pool prices that bond from the
agent's observed execution record. If the agent delivers, the pool keeps the
premium. If it doesn't, the principal is made whole out of the agent's
collateral first and the pool's capital second — and the agent's record
worsens, which raises the price of every promise it makes afterwards.

The price is the reputation. It is a number in basis points, published by a
view function, and it moves because money moved.

## Why this needs a chain, and why it needs this chain

Two properties are load-bearing:

1. **The record has to be adversarial-proof.** An agent's failure rate is worth
   money to misreport. It has to live somewhere neither counterparty controls.
2. **Adjudication has to read the world.** "Did the delivered artifact satisfy
   these acceptance criteria" is not a question a deterministic VM can answer,
   and paying a human to answer it costs more than most agent tasks are worth.

GenLayer's optimistic democracy is the reason the second property is available
at all: validators independently read the artifact, apply the criteria, and
have to agree under an equivalence principle before the verdict binds.

## Where consensus is used, and where it deliberately is not

The contract touches non-determinism in exactly three places, and each one is
scoped as narrowly as it can be.

| Site | Method | Why it is bounded that way |
| --- | --- | --- |
| Difficulty at bind | `prompt_comparative` | Output is a single integer in `[100, 400]` plus a short driver string. Validators compare raw scores within a ±25 band. A free-text risk assessment would never converge. |
| Delivery adjudication | `prompt_comparative` over `web.render` | Output is one of three verdicts plus a note and a timestamp. Verdicts must match exactly; notes must cite the same criterion; timestamps must agree to ten minutes. |
| Wall clock | `run_nondet` with a deterministic validator | Comparing two integers does not need a language model. Cheaper, and it cannot be argued out of its answer. |

Everything else — the loss rate, the loads, the premium, the collateral
requirement, the settlement arithmetic — is integer arithmetic on stored state.
That is the point. **The model is asked about the world, never about the
price.** A validator that hallucinates cannot invent a premium; the worst it
can do is misread difficulty by one 25-point step, inside a band its peers
check.

### Prompt injection

The artifact is untrusted content written by the party with the most to gain
from a favourable verdict. Three defences:

- Evidence must be served from the trusted host fixed at construction. An
  underwriter that will read any URL you hand it is an underwriter you can rob.
- The adjudication prompt states the acceptance criteria *before* the artifact
  and marks the artifact as content to evaluate, never as instructions.
- The verdict space is three values. A successful injection has to move every
  validator to the same wrong verdict, not merely produce persuasive text.

## The actuarial model

Failure rate is a posterior mean under a Beta(3, 27) prior — a new agent is
priced at 10%, neither trusted nor presumed fraudulent, and the prior gives way
as evidence arrives. Outcomes decay at 990/1000 per settlement: a half-life of
about 69 bonds, so a good year does not buy permanent forgiveness for last
month.

The decay also caps the total weight a record can hold at 1/(1 − 0.99) = 100
effective settlements, and that ceiling is deliberate. However long an agent
has been good, this market will never hold more than a hundred settlements'
worth of evidence about it, so a spotless record bottoms out at 230 bps of
implied loss and one breach still moves it 77 bps. An agent cannot outrun its
own risk by being old.

The first constant tried here was 968/1000, and it had to go: with a half-life
that short, one honoured bond could not replace the evidence the decay had just
erased, so settling successfully *raised* an established agent's premium by a
basis point. `test_honouring_a_bond_never_raises_the_price` now walks 400
reachable records and asserts that cannot happen again.

```
loss_rate = (decayed_failures + 3) / (decayed_settlements + 30)
premium   = (loss_rate + duration_load + concentration_load) × difficulty + expenses
collateral = clamp(20% + loss_rate, 20%, 80%)
```

Two constraints hold by construction, and both are tested:

- **Collateral always exceeds premium.** If a bond ever cost less than the
  capital it locks, breaching would be the rational move.
- **Premium is monotonic in every input.** More failures, more time, more
  concentration or more difficulty can only make a bond more expensive.
- **Honouring a bond never raises the price.** Being good must never look
  worse than the decay it outran.

Above a 50% premium the contract declines rather than quotes. Some risks should
not be priced.

## Frontend

No framework. The interaction that matters is a slider that reprices a bond,
so that path is a pure function and a CSS transform.

- **Local pricing.** `src/core/pricing.ts` mirrors the contract's arithmetic
  exactly, so a dragged slider costs zero RPC calls. The mirror is only allowed
  to exist because both implementations are pinned to `tests/vectors.json`, and
  CI fails if either drifts.
- **One scheduler.** Writes mark subscribers dirty; one animation frame flushes
  them; each subscriber patches only the nodes it owns.
- **Windowed book.** Fixed row height, overscan of four, transform-positioned
  window. A book of fifty thousand bonds scrolls like a book of thirty.
- **Worker-side risk.** The portfolio loss simulation is 200,000 trials over
  every live bond. It runs in a worker and transfers its histogram back rather
  than cloning it.
- **Single-flight reads.** The live backend serves a stale value immediately
  and coalesces concurrent reads of the same key into one call.

## Known limits

Named here rather than discovered later.

- **Independent failures.** The risk model draws each bond independently. Real
  agent failures correlate hard — a shared model provider or a broken upstream
  API takes down a whole cohort at once. Correlated draws by dependency cluster
  are the obvious next model, and until then the 1-in-100 loss is optimistic.
- **Withdrawals.** Value enters through a payable deposit and moves on an
  internal ledger. Moving it back out to the host chain is the one integration
  point left open, and it is marked in the contract rather than faked.
- **Disputes.** An indeterminate verdict parks the bond and the contract owner
  resolves it. That is a placeholder for a validator jury, and it is the single
  most centralised thing in the design.
- **Collusion.** A principal and obligor who are the same operator can write
  bonds to launder a clean record. Concentration loading raises the cost but
  does not remove the attack; requiring the principal's stake to be at risk too
  is the direction.
- **No secondary market.** Bonds are held to settlement. Tradeable exposure
  would let the price of trust be discovered continuously rather than at bind.
