# Submission checklist

Everything the GenBonds hackathon entry needs, and what is left to fill in.

## Before pushing

- [ ] Replace `<address>` in `README.md` (the **Deployed** table, two places)
      with your Studionet contract address.
- [ ] Replace `<your handle>` in `PITCH.md` with your GitHub username.
- [ ] Replace `<address>` in `PITCH.md` with the same contract address.

## Live links

- **App:** https://gen-bonds-real.vercel.app
- **Code:** https://github.com/rundem01/gen-bonds
- **Contract:** `0x88dbAe3C8D637D0ad53Fe6424c53e72F61566e0c` on Studio Next (chain 61997)
- **Settlement tx:** `0x86bdd8fac4522de540f1b8a24a751fb40ccbc97b5c804125a31a96d9ed310593`

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

**The evidence** — a live Studionet deployment with the full lifecycle executed
end to end: fund, bind, deliver, adjudicate, settle, reprice. A validator
fetched a real file from a public URL, judged it against criteria written in
English, and breached the bond, citing the specific missing field. The agent's
price moved 1050 -> 1340 bps in one transaction. Settlement tx
`0x86bdd8fac4522de540f1b8a24a751fb40ccbc97b5c804125a31a96d9ed310593`,
verifiable on the public explorer without trusting a screenshot.

**The engineering** — 21 actuarial tests, 50 cross-language pricing vectors
pinning the TypeScript mirror to the contract byte for byte, a ten-trap deploy
gate, and a probe ladder that isolates GenVM failures.

## Strongest thing to lead with

The verdict, then the reprice. A validator read
`{"summary": "Report complete."}`, compared it to criteria written in plain
English, and returned `{"verdict":"breached","note":"JSON lacks required data
field"}`. That is a machine adjudicating a contract by reading the work — the
thing a deterministic VM cannot do at any price.

Then the consequence: 1050 -> 1340 bps, 290 basis points of face value on every
bond that agent writes afterwards, plus 0.6 GEN of its own capital gone. The
market did not rate the agent. It repriced it, because money moved.

Screenshots worth having ready: the settle transaction modal (verdict,
equivalence principle output, validator set) and the two `price_of_trust`
responses side by side.

## Known gaps, stated rather than hidden

- Failures are modelled as independent. Agents sharing a model provider fail
  together, so the 1-in-100 loss figure is optimistic.
- Withdrawals to the host chain are a marked integration point, not a finished
  path. Value moves on an internal ledger.
- Disputes escalate to an owner key that should be a validator jury.

All three are written up in `docs/ARCHITECTURE.md`.
