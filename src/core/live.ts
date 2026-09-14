/**
 * The live backend: the same interface as the simulator, talking to a deployed
 * GenBonds contract through genlayer-js.
 *
 * Reads are cheap but not free, so they go through a single-flight cache: a
 * hundred components asking for the pool at once produce one RPC call, and a
 * stale value is served immediately while the refresh is in flight. Writes
 * always invalidate.
 */

import { BPS, PRIOR_FAILURES, PRIOR_TASKS, SCALE } from "./pricing.ts";
import type {
  AgentView,
  Backend,
  BindRequest,
  Bond,
  BondState,
  PoolView,
} from "./types.ts";

const STATES: BondState[] = ["bound", "bound", "honored", "breached", "disputed", "cancelled"];

interface CacheEntry {
  value: unknown;
  at: number;
  inflight?: Promise<unknown>;
}

class ReadCache {
  #entries = new Map<string, CacheEntry>();
  #ttlMs: number;

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.#entries.get(key);
    const fresh = entry && Date.now() - entry.at < this.#ttlMs;
    if (entry?.inflight) return entry.inflight as Promise<T>;
    if (fresh) return entry!.value as T;

    const inflight = load()
      .then((value) => {
        this.#entries.set(key, { value, at: Date.now() });
        return value;
      })
      .catch((error) => {
        this.#entries.delete(key);
        throw error;
      });

    this.#entries.set(key, { value: entry?.value, at: entry?.at ?? 0, inflight });
    // Serve the stale value immediately if we have one; otherwise wait.
    return entry && entry.value !== undefined ? (entry.value as T) : (inflight as Promise<T>);
  }

  invalidate(): void {
    this.#entries.clear();
  }
}

export interface LiveConfig {
  contractAddress: string;
  studioUrl?: string;
}

export class LiveBackend implements Backend {
  readonly mode = "live" as const;
  account = "";

  #client: any;
  #address: string;
  #cache = new ReadCache(4_000);

  private constructor(client: any, address: string, account: string) {
    this.#client = client;
    this.#address = address;
    this.account = account;
  }

  /** Lazily imports genlayer-js so simulated mode never pays for the SDK. */
  static async connect(config: LiveConfig): Promise<LiveBackend> {
    const [{ createClient, createAccount }, chains] = await Promise.all([
      import("genlayer-js"),
      import("genlayer-js/chains"),
    ]);
    const chain = (chains as any).studionet ?? (chains as any).localnet;
    const client = createClient({
      chain,
      endpoint: config.studioUrl,
      account: createAccount(),
    });
    // The account comes from the client we just built with createAccount();
    // the SDK has no separate connected-accounts lookup.
    const backend = new LiveBackend(
      client,
      config.contractAddress,
      (client as { account?: { address?: string } }).account?.address ?? "",
    );

    // Confirm the deployed instance is the source this frontend was built
    // against. Studio can serve a different contract than you think it is,
    // and every symptom of that looks like a bug in your own code.
    const version = await backend.version();
    if (!version.startsWith("genbonds-")) {
      throw new Error(
        `Contract at ${config.contractAddress} returned version "${version}" — ` +
          "this is not a GenBonds instance.",
      );
    }
    return backend;
  }

  async #read<T>(key: string, functionName: string, args: unknown[]): Promise<T> {
    return this.#cache.get(key, async () => {
      const raw = await this.#client.readContract({
        address: this.#address,
        functionName,
        args,
      });
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }) as Promise<T>;
  }

  async #write(functionName: string, args: unknown[], value = 0n): Promise<any> {
    const hash = await this.#client.writeContract({
      address: this.#address,
      functionName,
      args,
      value,
    });
    const receipt = await this.#client.waitForTransactionReceipt({
      hash,
      status: "FINALIZED",
    });
    this.#cache.invalidate();
    return receipt;
  }

  async version(): Promise<string> {
    return this.#read<string>("version", "version", []);
  }

  async pool(): Promise<PoolView> {
    const raw = await this.#read<any>("pool", "pool", []);
    return {
      capital: BigInt(raw.capital),
      allocated: BigInt(raw.allocated),
      free: BigInt(raw.free),
      utilisationBps: Number(raw.utilisation_bps),
      premiumsEarned: BigInt(raw.premiums_earned),
      claimsPaid: BigInt(raw.claims_paid),
      openBonds: Number(raw.total_bonds),
    };
  }

  async agent(address: string): Promise<AgentView> {
    const raw = await this.#read<any>(`agent:${address}`, "price_of_trust", [address]);

    // The contract publishes a decayed settlement count and a posterior loss
    // rate, not the raw weighted counters. Recover them by inverting the
    // posterior, so the yardstick can show where one more breach lands:
    //
    //   loss = (wf + PRIOR_FAILURES) / (wf + wh + PRIOR_TASKS)
    //
    // with (wf + wh) known from effective_settlements. Exact within integer
    // rounding, which is all the ghost needle needs.
    const total = Number(raw.effective_settlements) * SCALE;
    const loss = Number(raw.loss_rate_bps);
    const weightedFailures = Math.max(
      0,
      Math.round((loss * (total + PRIOR_TASKS)) / BPS - PRIOR_FAILURES),
    );

    return {
      address,
      label: address,
      weightedFailures,
      weightedHonored: Math.max(0, total - weightedFailures),
      effectiveSettlements: Number(raw.effective_settlements),
      bondsBound: Number(raw.bonds_bound),
      faceBonded: BigInt(raw.face_bonded),
      collateralLost: BigInt(raw.collateral_lost),
      liveExposure: BigInt(raw.live_exposure),
      lossRateBps: Number(raw.loss_rate_bps),
      basePremiumBps: Number(raw.base_premium_bps),
      collateralBps: Number(raw.collateral_bps),
      evidenced: Boolean(raw.evidenced),
    };
  }

  /** The chain has no agent directory; the book is the directory. */
  async agents(): Promise<AgentView[]> {
    const bonds = await this.book(120);
    const seen = [...new Set(bonds.map((b) => b.obligor))];
    return Promise.all(seen.map((address) => this.agent(address)));
  }

  async book(limit: number): Promise<Bond[]> {
    const raw = await this.#read<any>(`book:${limit}`, "book", [0, limit]);
    return (raw.bonds as any[]).map((b) => ({
      id: Number(b.id),
      principal: b.principal,
      obligor: b.obligor,
      faceValue: BigInt(b.face_value),
      premium: BigInt(b.premium),
      collateral: BigInt(b.collateral),
      premiumBps: Number(b.premium_bps),
      lossRateBps: Number(b.loss_rate_bps),
      riskMult: Number(b.risk_mult),
      deadline: Number(b.deadline),
      state: STATES[Number(b.state)] ?? "bound",
      criteria: b.criteria,
      artifactUrl: b.artifact_url,
      verdictNote: b.verdict_note,
    }));
  }

  async bind(request: BindRequest) {
    const receipt = await this.#write("bind", [
      request.principal,
      request.faceValue.toString(),
      request.durationHours,
      Math.floor(Date.now() / 1000) + request.durationHours * 3600,
      request.criteria,
    ]);
    const bondId = Number(receipt?.result ?? receipt?.data ?? 0);
    return { bondId, riskMult: 0, driver: "priced by validator consensus" };
  }

  async submitDelivery(bondId: number, artifactUrl: string): Promise<void> {
    await this.#write("submit_delivery", [bondId, artifactUrl]);
  }

  async settle(bondId: number) {
    const receipt = await this.#write("settle", [bondId]);
    const raw = typeof receipt?.result === "string" ? JSON.parse(receipt.result) : receipt?.result ?? {};
    return {
      state: (raw.state as BondState) ?? "disputed",
      note: raw.note ?? "",
      nextPremiumBps: Number(raw.obligor_next_premium_bps ?? 0),
    };
  }

  async stake(amount: bigint): Promise<void> {
    await this.#write("stake", [amount.toString()]);
  }
}
