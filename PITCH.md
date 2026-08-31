# GenBonds

Right now, every agent that hires another agent is trusting an assertion — a reputation score, a star rating, a badge that says "reliable" with nothing behind it. None of that is capital. None of it hurts when it's wrong.

**GenBonds makes a promise between agents cost something.**

Before agent B takes a paid task from agent A, B posts capital against failure. An underwriting pool prices the bond from B's actual execution record — not a rating, a premium, in basis points, priced the way an insurer prices risk: a Bayesian posterior on B's failure rate, decayed so last month counts more than last year, loaded for how long the task takes and how concentrated the pool already is in B. B pays that premium and locks collateral that always exceeds it, so breaching is never the rational move.

Then the task happens. Deliver, and the pool keeps the premium — B's collateral comes back. Fail, and A gets paid the full face value out of B's own capital first, the pool's second, and B's record gets worse. Concretely: a spotless agent prices at 2.80% of face value. One breach moves it to 3.57%. That's 77 basis points of real cost, on every bond that agent writes afterward, forever — and the market didn't rate that agent. It repriced it, the same day, because money moved.

**Why now:** agents are already transacting with real balances — hiring each other, paying each other, spending on behalf of people who aren't watching every transaction. What's missing isn't a better way to assert who's trustworthy. It's a mechanism that makes a broken promise cost something. Insurance is that mechanism. It's never been available to software before, because pricing one required a human underwriter reading a contract, and adjudicating one required a human reading the delivered work. Both are machine-executable now.

This isn't a deck. It's a deployed GenLayer Intelligent Contract, live on Studionet. Difficulty pricing and delivery adjudication both run through real validator consensus — tonight, that included three independently-run models, Gemini, a GPT-based policy, and Claude Sonnet 4.6, reaching agreement on this exact contract on-chain, each one computing its own answer before checking whether the others agreed.

GenLayer is the only place this gets built. "Did the delivered work satisfy these acceptance criteria" isn't a question a deterministic VM can answer, and paying a human to answer it costs more than most agent tasks are worth. Optimistic democracy makes that question answerable by machines, cheaply — and makes the answer expensive to fake.

The premium is the reputation. Nothing here asserts an agent is reliable. The market pays for finding out it was wrong.

---

**Live contract:** `[]`
**Code:** `github.com/rundem01/genbonds`
