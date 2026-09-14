/**
 * A local backend that reproduces the contract's economics exactly.
 *
 * Reviewers should be able to open GenBonds and watch a breach reprice an
 * agent without first funding a wallet on a testnet, so the simulated backend
 * runs the same pricing module the contract runs and applies the same decay
 * and settlement rules. What it does NOT simulate is consensus: difficulty
 * scoring here is a crude heuristic over the criteria text, where the contract
 * asks a validator set. The header says "simulated" for exactly that reason.
 */

import { estimateDifficulty } from "./difficulty.ts";
import {
  afterSettlement,
  collateralBps,
  lossRateBps,
  premiumBps,
  quote,
  SCALE,
  DECAY_NUM,
  DECAY_DEN,
} from "./pricing.ts";
import type { AgentView, Backend, BindRequest, Bond, BondState, PoolView } from "./types.ts";

interface Record {
  address: string;
  label: string;
  weightedFailures: number;
  weightedHonored: number;
  bondsBound: number;
  faceBonded: bigint;
  collateralLost: bigint;
  liveExposure: bigint;
}

const ETH = 1_000_000_000_000_000_000n;

/** Deterministic PRNG so a reload shows the same market, not a new one. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded agents, expressed as decayed weights rather than lifetime tallies —
 * the contract caps any record at ~100 effective settlements, so a market
 * seeded with four-hundred-bond histories would show prices no real agent
 * could ever reach. Weights are in thousandths, matching SCALE.
 */
const SEED_AGENTS: Array<[string, string, number, number]> = [
  ["0x7b41e2c8f5a9d0b3e6c1f4a7d2b5e8c1f4a7d0b3", "ledger-recon-01", 500, 99_100],
  ["0x2f9a4c7e1b8d5a2f9c6e3b0d7a4f1c8e5b2d9a6f", "scrape-fleet-alpha", 4_100, 95_400],
  ["0xc4e7b1a8d5f2c9e6b3a0d7f4c1e8b5a2d9f6c3e0", "sql-writer-prime", 1_900, 62_800],
  ["0x8d3f6a9c2e5b8d1f4a7c0e3b6d9f2a5c8e1b4d7f", "invoice-parser-b", 13_600, 84_200],
  ["0x5a8c1e4b7d0f3a6c9e2b5d8f1a4c7e0b3d6f9a2c", "market-maker-zeta", 0, 8_900],
  ["0xe1b4d7a0c3f6e9b2d5a8c1f4e7b0d3a6c9f2e5b8", "voice-agent-noir", 26_400, 71_300],
];

const SEED_CRITERIA = [
  "Reconcile the attached ledger export against the bank statement and return a CSV of every unmatched line with an explanation column. Zero unexplained variances above 0.01.",
  "Return structured JSON for all 4,000 product URLs in the input list. Every row must carry price, currency and availability. Missing rows are a breach; stale prices over 6 hours old are a breach.",
  "Write and run a query returning weekly active accounts by plan tier for the last 26 weeks. Output must match the finance team's stated totals to the account.",
  "Extract line items, tax and totals from 1,200 scanned invoices to the agreed schema. Field-level accuracy must exceed 99% on the held-out sample.",
  "Maintain two-sided quotes on the listed pair for 24 hours with spread under 40 bps and uptime above 99%. Any gap over 90 seconds is a breach.",
  "Deliver a transcript with speaker labels for the 3-hour call, word error rate under 8% against the reference transcript.",
];

export class SimulatedBackend implements Backend {
  readonly mode = "simulated" as const;
  readonly account = "0x7b41e2c8f5a9d0b3e6c1f4a7d2b5e8c1f4a7d0b3";

  #records = new Map<string, Record>();
  #bonds: Bond[] = [];
  #nextId = 1;
  #capital = 2_400n * ETH;
  #allocated = 0n;
  #premiumsEarned = 0n;
  #claimsPaid = 0n;
  #rand = mulberry(20260829);

  constructor() {
    for (const [address, label, weightedFailures, weightedHonored] of SEED_AGENTS) {
      const settled = Math.round((weightedFailures + weightedHonored) / SCALE);
      this.#records.set(address, {
        address,
        label,
        weightedFailures,
        weightedHonored,
        bondsBound: settled,
        faceBonded: BigInt(settled) * 3n * ETH,
        collateralLost: (BigInt(Math.round(weightedFailures / SCALE)) * ETH * 27n) / 10n,
        liveExposure: 0n,
      });
    }
    this.#seedBook();
  }

  #seedBook(): void {
    const agents = [...this.#records.values()];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 14; i += 1) {
      const agent = agents[Math.floor(this.#rand() * agents.length)]!;
      const face = BigInt(4 + Math.floor(this.#rand() * 40)) * ETH;
      const hours = [4, 12, 24, 48, 72, 168][Math.floor(this.#rand() * 6)]!;
      const criteria = SEED_CRITERIA[Math.floor(this.#rand() * SEED_CRITERIA.length)]!;
      const q = quote({
        history: {
          weightedFailures: agent.weightedFailures,
          weightedHonored: agent.weightedHonored,
          liveExposure: agent.liveExposure,
        },
        faceValue: face,
        durationHours: hours,
        riskMultRaw: this.#difficulty(criteria, hours),
        poolCapital: this.#capital,
        poolAllocated: this.#allocated,
      });
      const roll = this.#rand();
      const state: BondState = i < 4 ? "bound" : roll < q.lossRateBps / 10_000 ? "breached" : "honored";
      const bond: Bond = {
        id: this.#nextId++,
        principal: "0x1111000000000000000000000000000000001111",
        obligor: agent.address,
        faceValue: face,
        premium: q.premium,
        collateral: q.collateral,
        premiumBps: q.premiumBps,
        lossRateBps: q.lossRateBps,
        riskMult: q.riskMult,
        deadline: now + hours * 3600 - Math.floor(this.#rand() * 200_000),
        state,
        criteria,
        artifactUrl: state === "bound" ? "" : "https://artifacts.genbonds.dev/run/" + this.#nextId,
        verdictNote:
          state === "honored"
            ? "every acceptance criterion satisfied"
            : state === "breached"
              ? "coverage below the agreed threshold"
              : "",
      };
      this.#bonds.unshift(bond);
      if (state === "bound") {
        this.#allocated += q.poolExposure;
        agent.liveExposure += q.poolExposure;
      } else {
        this.#premiumsEarned += q.premium;
        if (state === "breached") this.#claimsPaid += q.poolExposure;
      }
    }
  }

  /**
   * Stand-in for the consensus difficulty read. Shares the client-side
   * estimator so the demo cannot quietly disagree with the quote slip in
   * front of it.
   */
  #difficulty(criteria: string, hours: number): number {
    return estimateDifficulty(criteria, hours).riskMult;
  }

  async pool(): Promise<PoolView> {
    return {
      capital: this.#capital,
      allocated: this.#allocated,
      free: this.#capital > this.#allocated ? this.#capital - this.#allocated : 0n,
      utilisationBps:
        this.#capital > 0n ? Number((this.#allocated * 10_000n) / this.#capital) : 0,
      premiumsEarned: this.#premiumsEarned,
      claimsPaid: this.#claimsPaid,
      openBonds: this.#bonds.filter((b) => b.state === "bound").length,
    };
  }

  #view(record: Record): AgentView {
    // Matches `price_of_trust()` exactly: the published price of an agent is
    // its record alone, with no loads for duration or for how exposed this
    // particular pool happens to be to it today.
    const loss = lossRateBps(record.weightedFailures, record.weightedHonored);
    return {
      address: record.address,
      label: record.label,
      weightedFailures: record.weightedFailures,
      weightedHonored: record.weightedHonored,
      effectiveSettlements: Math.round(
        (record.weightedFailures + record.weightedHonored) / SCALE,
      ),
      bondsBound: record.bondsBound,
      faceBonded: record.faceBonded,
      collateralLost: record.collateralLost,
      liveExposure: record.liveExposure,
      lossRateBps: loss,
      basePremiumBps: premiumBps(loss, 0, 0, 100),
      collateralBps: collateralBps(loss),
      evidenced: record.weightedFailures + record.weightedHonored > 0,
    };
  }

  async agents(): Promise<AgentView[]> {
    return [...this.#records.values()].map((r) => this.#view(r));
  }

  async agent(address: string): Promise<AgentView> {
    const record = this.#records.get(address);
    if (!record) {
      return this.#view({
        address,
        label: "unrecorded agent",
        weightedFailures: 0,
        weightedHonored: 0,
        bondsBound: 0,
        faceBonded: 0n,
        collateralLost: 0n,
        liveExposure: 0n,
      });
    }
    return this.#view(record);
  }

  async book(limit: number): Promise<Bond[]> {
    return this.#bonds.slice(0, limit);
  }

  async bind(request: BindRequest) {
    const record = this.#records.get(request.obligor);
    if (!record) throw new Error("Unknown obligor. Register the agent before binding.");
    const riskMult = this.#difficulty(request.criteria, request.durationHours);
    const q = quote({
      history: {
        weightedFailures: record.weightedFailures,
        weightedHonored: record.weightedHonored,
        liveExposure: record.liveExposure,
      },
      faceValue: request.faceValue,
      durationHours: request.durationHours,
      riskMultRaw: riskMult,
      poolCapital: this.#capital,
      poolAllocated: this.#allocated,
    });
    if (q.declined) throw new Error("Declined. The risk exceeds the pool's appetite.");
    if (!q.bindable) throw new Error("Declined. The pool has insufficient free capital.");

    const bond: Bond = {
      id: this.#nextId++,
      principal: request.principal,
      obligor: request.obligor,
      faceValue: request.faceValue,
      premium: q.premium,
      collateral: q.collateral,
      premiumBps: q.premiumBps,
      lossRateBps: q.lossRateBps,
      riskMult: q.riskMult,
      deadline: Math.floor(Date.now() / 1000) + request.durationHours * 3600,
      state: "bound",
      criteria: request.criteria,
      artifactUrl: "",
      verdictNote: "",
    };
    this.#bonds.unshift(bond);
    this.#allocated += q.poolExposure;
    record.liveExposure += q.poolExposure;
    record.bondsBound += 1;
    record.faceBonded += request.faceValue;
    return { bondId: bond.id, riskMult: q.riskMult, driver: this.#driver(request.criteria) };
  }

  #driver(criteria: string): string {
    return estimateDifficulty(criteria, 24).driver;
  }

  async submitDelivery(bondId: number, artifactUrl: string): Promise<void> {
    const bond = this.#bonds.find((b) => b.id === bondId);
    if (!bond) throw new Error("Unknown bond.");
    if (bond.state !== "bound") throw new Error("This bond is already settled.");
    bond.artifactUrl = artifactUrl;
  }

  async settle(bondId: number) {
    const bond = this.#bonds.find((b) => b.id === bondId);
    if (!bond) throw new Error("Unknown bond.");
    if (bond.state !== "bound") throw new Error("This bond is already settled.");
    const record = this.#records.get(bond.obligor)!;

    const overdue = bond.deadline < Math.floor(Date.now() / 1000);
    const delivered = bond.artifactUrl !== "";
    const honored = delivered && !overdue && this.#rand() > bond.lossRateBps / 10_000;

    const next = afterSettlement(
      {
        weightedFailures: record.weightedFailures,
        weightedHonored: record.weightedHonored,
        liveExposure: record.liveExposure,
      },
      honored,
    );
    record.weightedFailures = next.weightedFailures;
    record.weightedHonored = next.weightedHonored;

    const poolExposure = bond.faceValue - bond.collateral;
    record.liveExposure -= poolExposure;
    this.#allocated -= poolExposure;
    this.#premiumsEarned += bond.premium;
    this.#capital += bond.premium;

    if (honored) {
      bond.state = "honored";
      bond.verdictNote = "every acceptance criterion satisfied";
    } else {
      bond.state = "breached";
      bond.verdictNote = !delivered
        ? "no delivery before deadline"
        : overdue
          ? "delivered after deadline"
          : "acceptance criteria not met";
      record.collateralLost += bond.collateral;
      this.#claimsPaid += poolExposure;
      this.#capital -= poolExposure;
    }

    const after = await this.agent(bond.obligor);
    return { state: bond.state, note: bond.verdictNote, nextPremiumBps: after.basePremiumBps };
  }

  async stake(amount: bigint): Promise<void> {
    this.#capital += amount;
  }
}

export const DECAY_NOTE = `${DECAY_NUM}/${DECAY_DEN} per settlement`;
