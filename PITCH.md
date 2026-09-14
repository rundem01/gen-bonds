# GenBonds

Right now, every agent that hires another agent is trusting an assertion — a reputation score, a star rating, a badge that says "reliable" with nothing behind it. None of that is capital. None of it hurts when it's wrong.

**GenBonds makes a promise between agents cost something.**

Before agent B takes a paid task from agent A, B posts capital against failure. An underwriting pool prices the bond from B's actual execution record — not a rating, a premium, in basis points, priced the way an insurer prices risk: a Bayesian posterior on B's failure rate, decayed so last month counts more than last year, loaded for how long the task takes and how concentrated the pool already is in B. B pays that premium and locks collateral that always exceeds it, so breaching is never the rational move.

Then the task happens. Deliver, and the pool keeps the premium — B's collateral comes back. Fail, and A gets paid the full face value out of B's own capital first, the pool's second, and B's record gets worse.

**This is not a diagram. It ran on-chain, and here is the receipt.** An agent with no history bound a 2 GEN bond at 10.50% of face. It delivered a JSON file that was missing a field the acceptance criteria required. A validator fetched that file, read it, and returned a verdict: `{"verdict":"breached","note":"JSON lacks required data field"}`. The contract paid the principal, seized the agent's 0.6 GEN collateral, and repriced it:

| | Before | After one breach |
| --- | --- | --- |
| Implied failure rate | 10.00% | 12.90% |
| Premium | 10.50% of face | 13.40% of face |
| Collateral required | 30.00% | 32.90% |

290 basis points, on every bond that agent writes from now on. The market did not rate that agent. It repriced it, in one transaction, because a machine read the work and found it wanting.

**Why now:** agents are already transacting with real balances — hiring each other, paying each other, spending on behalf of people who aren't watching every transaction. What's missing isn't a better way to assert who's trustworthy. It's a mechanism that makes a broken promise cost something. Insurance is that mechanism. It's never been available to software before, because pricing one required a human underwriter reading a contract, and adjudicating one required a human reading the delivered work. Both are machine-executable now.

This isn't a deck. It's a deployed GenLayer Intelligent Contract, live on Studionet, and the full lifecycle — fund, bind, deliver, adjudicate, settle, reprice — has been executed end to end. Difficulty pricing at bind ran through multi-validator consensus across three independently-run models: Gemini, a GPT-based policy, and Claude Sonnet 4.6, each computing its own answer before checking whether the others agreed.

Settlement transaction: `0x8cd1b6ea3c14c815ba5faeeed345f572a16a111bb0fec3a152dc157dcb9a274e`

GenLayer is the only place this gets built. "Did the delivered work satisfy these acceptance criteria" isn't a question a deterministic VM can answer, and paying a human to answer it costs more than most agent tasks are worth. Optimistic democracy makes that question answerable by machines, cheaply — and makes the answer expensive to fake.

The premium is the reputation. Nothing here asserts an agent is reliable. The market pays for finding out it was wrong.

---

**Live contract:** `0xAC7f02f86b0F49F0C271A962082cdca7D9c942Eb` on GenLayer Studionet
**Settlement tx:** `0x8cd1b6ea3c14c815ba5faeeed345f572a16a111bb0fec3a152dc157dcb9a274e`
**Code:** `https://github.com/rundem01/gen-bonds`
