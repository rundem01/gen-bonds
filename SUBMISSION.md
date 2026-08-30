# Submission checklist

Everything the GenBonds hackathon entry needs, and what is left to fill in.

## Before pushing

- [ ] Replace `<address>` in `README.md` (the **Deployed** table, two places)
      with your Studionet contract address.
- [ ] Replace `[your handle]` in `PITCH.md` with your GitHub username.
- [ ] Replace `[Studionet address — add once tonight's bond finishes settling]`
      in `PITCH.md` with the same address.

## Push

```bash
git remote add origin git@github.com:<you>/genbonds.git
git push -u origin main
```

CI runs on first push: the contract gate, both test suites, a staleness check
that regenerates the pricing vectors and fails if they drift from the contract,
plus typecheck and build.

## What the submission consists of

**The pitch** — `PITCH.md`. The rules asked for one pitch per account, written
as if standing in the tank. That file is the entry; everything else backs it up.

**The contract** — `contracts/GenBonds.py`. A GenLayer Intelligent Contract that
prices what an agent's promise is worth. Consensus is used in exactly three
places and never to set a price: task difficulty at bind, delivery adjudication
at settle, and clock agreement. Everything else is integer arithmetic on stored
state, so a hallucinating validator cannot invent a premium.

**The evidence** — a live Studionet deployment with a real multi-validator
consensus round, verifiable on the public explorer without trusting a
screenshot.

**The engineering** — 21 actuarial tests, 50 cross-language pricing vectors
pinning the TypeScript mirror to the contract byte for byte, a ten-trap deploy
gate, and a probe ladder that isolates GenVM failures.

## Strongest thing to lead with

The reprice. A spotless agent prices at 2.80% of face; one breach moves it to
3.57%. That is 77 basis points of real cost on every bond that agent writes
afterwards — and the market did not rate the agent, it repriced it, because
money moved.

## Known gaps, stated rather than hidden

- Failures are modelled as independent. Agents sharing a model provider fail
  together, so the 1-in-100 loss figure is optimistic.
- Withdrawals to the host chain are a marked integration point, not a finished
  path. Value moves on an internal ledger.
- Disputes escalate to an owner key that should be a validator jury.

All three are written up in `docs/ARCHITECTURE.md`.
