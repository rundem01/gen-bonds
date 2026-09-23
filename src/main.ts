/**
 * GenBonds — application shell.
 *
 * Four surfaces, one store:
 *   the yardstick   what this agent's promise costs today, and after one breach
 *   the quote slip  price a specific job, re-priced locally on every frame
 *   the book        every bond the pool has written, windowed
 *   the console     what the live book could cost on a bad day, simulated in a worker
 *
 * There is no framework here on purpose. The interaction that matters is a
 * slider that reprices a bond, and that path should be a pure function and a
 * transform, not a reconciliation.
 */

import { estimateDifficulty } from "./core/difficulty.ts";
import { Wallet } from "./core/wallet.ts";
import { addr, eth, hours as fmtHours, pct, toWei } from "./core/format.ts";
import { afterSettlement, quote, PREMIUM_CAP_BPS } from "./core/pricing.ts";
import { SimulatedBackend } from "./core/simulator.ts";
import { perFrame, Store } from "./core/store.ts";
import type { AgentView, Backend, Bond, PoolView } from "./core/types.ts";
import { BookView } from "./ui/book.ts";
import { Yardstick } from "./ui/yardstick.ts";
import type { RiskResult } from "./workers/risk.worker.ts";

interface AppState {
  backend: Backend;
  agents: AgentView[];
  selected: string;
  pool: PoolView | null;
  bonds: Bond[];
  risk: RiskResult | null;
  face: string;
  duration: number;
  criteria: string;
  notice: { tone: "ok" | "warn" | "bad"; text: string } | null;
  busy: boolean;
}

const DEFAULT_CRITERIA =
  "Return structured JSON for all 4,000 product URLs in the input list. Every row must carry price, currency and availability. Missing rows are a breach; prices more than 6 hours stale are a breach.";

async function boot(): Promise<void> {
  const contractAddress = import.meta.env?.VITE_CONTRACT_ADDRESS as string | undefined;
  const wallet = new Wallet();
  await wallet.restore();

  let backend: Backend = new SimulatedBackend();

  const connectBackend = async (): Promise<Backend> => {
    if (!contractAddress) return new SimulatedBackend();
    try {
      const { LiveBackend } = await import("./core/live.ts");
      return await LiveBackend.connect({
        contractAddress,
        studioUrl: import.meta.env?.VITE_STUDIO_URL as string | undefined,
        account: wallet.state.address,
      });
    } catch (error) {
      console.warn("Falling back to the simulated market:", error);
      return new SimulatedBackend();
    }
  };

  backend = await connectBackend();

  const store = new Store<AppState>({
    backend,
    agents: [],
    selected: "",
    pool: null,
    bonds: [],
    risk: null,
    face: "12",
    duration: 24,
    criteria: DEFAULT_CRITERIA,
    notice: null,
    busy: false,
  });

  mount(store, wallet);
  await refresh(store);

  // Reconnect the backend whenever the account changes, so writes are always
  // signed by whoever the wallet currently says they are.
  let lastAccount = wallet.state.address;
  wallet.subscribe((state) => {
    if (state.address === lastAccount) return;
    lastAccount = state.address;
    void connectBackend().then(async (next) => {
      store.set({ backend: next });
      await refresh(store);
    });
  });
}

async function refresh(store: Store<AppState>): Promise<void> {
  const { backend, selected } = store.state;
  const [agents, pool, bonds] = await Promise.all([
    backend.agents(),
    backend.pool(),
    backend.book(500),
  ]);
  store.set({
    agents,
    pool,
    bonds,
    selected: selected || agents[0]?.address || "",
  });
  runRiskModel(store);
}

// --------------------------------------------------------------- risk worker

let worker: Worker | null = null;

function runRiskModel(store: Store<AppState>): void {
  const { bonds, pool } = store.state;
  const live = bonds.filter((b) => b.state === "bound");
  if (!pool || live.length === 0) {
    store.set({ risk: null });
    return;
  }

  worker ??= new Worker(new URL("./workers/risk.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<RiskResult>) => store.set({ risk: event.data });

  const exposures = new Float64Array(live.length);
  const probabilities = new Float64Array(live.length);
  live.forEach((bond, i) => {
    exposures[i] = Number(eth(bond.faceValue - bond.collateral, 6));
    probabilities[i] = (bond.lossRateBps * (bond.riskMult / 100)) / 10_000;
  });

  worker.postMessage(
    {
      exposures,
      probabilities,
      freeCapital: Number(eth(pool.free, 6)),
      premiumsEarned: Number(eth(pool.premiumsEarned, 6)),
      trials: 200_000,
    },
    [exposures.buffer, probabilities.buffer],
  );
}

// --------------------------------------------------------------------- views

function mount(store: Store<AppState>, wallet: Wallet): void {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.innerHTML = template();

  const yardstick = new Yardstick(app.querySelector("[data-yardstick]")!);
  const book = new BookView(app.querySelector("[data-book]")!, (bond) => openBond(store, bond));

  const walletButton = app.querySelector<HTMLButtonElement>("[data-wallet]")!;
  walletButton.addEventListener("click", async () => {
    const { address, chainOk } = wallet.state;
    try {
      if (!address) await wallet.connect();
      else if (!chainOk) await wallet.switchChain();
      else wallet.disconnect();
    } catch (error) {
      store.set({ notice: { tone: "bad", text: (error as Error).message } });
    }
  });

  wallet.subscribe((state) => {
    if (!state.available) {
      walletButton.textContent = "no wallet detected";
      walletButton.disabled = true;
      walletButton.dataset.tone = "idle";
      return;
    }
    if (!state.address) {
      walletButton.textContent = "connect wallet";
      walletButton.dataset.tone = "idle";
    } else if (!state.chainOk) {
      walletButton.textContent = "switch to studio next";
      walletButton.dataset.tone = "warn";
    } else {
      walletButton.textContent = addr(state.address);
      walletButton.dataset.tone = "ok";
    }
  });

  const modeTag = app.querySelector<HTMLElement>("[data-mode]")!;
  modeTag.textContent = store.state.backend.mode === "live" ? "live contract" : "simulated market";
  modeTag.dataset.tone = store.state.backend.mode;

  // ---- agent selector
  const roster = app.querySelector<HTMLElement>("[data-roster]")!;
  roster.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-agent]");
    if (chip) store.set({ selected: chip.dataset.agent!, notice: null });
  });

  // ---- quote slip inputs
  const faceInput = app.querySelector<HTMLInputElement>("[data-face]")!;
  const durationInput = app.querySelector<HTMLInputElement>("[data-duration]")!;
  const criteriaInput = app.querySelector<HTMLTextAreaElement>("[data-criteria]")!;

  faceInput.value = store.state.face;
  durationInput.value = String(store.state.duration);
  criteriaInput.value = store.state.criteria;

  const onInput = perFrame(() =>
    store.set({
      face: faceInput.value,
      duration: Number(durationInput.value),
      criteria: criteriaInput.value,
      notice: null,
    }),
  );
  faceInput.addEventListener("input", onInput);
  durationInput.addEventListener("input", onInput);
  criteriaInput.addEventListener("input", onInput);

  app.querySelector("[data-bind]")!.addEventListener("click", () => bind(store));

  // ---- render passes, each owning its own nodes
  store.subscribe((state) => renderRoster(roster, state));
  store.subscribe((state) => renderYardstick(yardstick, state));
  store.subscribe((state) => renderSlip(app, state));
  store.subscribe((state) => {
    book.setBonds(state.bonds);
    renderPool(app, state);
  });
  store.subscribe((state) => renderConsole(app, state));
  store.subscribe((state) => renderNotice(app, state));
}

function currentAgent(state: AppState): AgentView | undefined {
  return state.agents.find((a) => a.address === state.selected) ?? state.agents[0];
}

function renderRoster(host: HTMLElement, state: AppState): void {
  host.innerHTML = state.agents
    .map(
      (agent) => `
        <button class="chip${agent.address === state.selected ? " chip--on" : ""}"
                data-agent="${agent.address}" type="button">
          <span class="chip__name">${agent.label}</span>
          <span class="chip__rate">${pct(agent.basePremiumBps, 1)}</span>
        </button>`,
    )
    .join("");
}

function renderYardstick(yardstick: Yardstick, state: AppState): void {
  const agent = currentAgent(state);
  if (!agent) return;

  const after = afterSettlement(
    {
      weightedFailures: agent.weightedFailures,
      weightedHonored: agent.weightedHonored,
      liveExposure: agent.liveExposure,
    },
    false,
  );
  const ghost = quote({
    history: after,
    faceValue: 10n ** 18n,
    durationHours: 0,
    riskMultRaw: 100,
    poolCapital: state.pool?.capital ?? 0n,
    poolAllocated: state.pool?.allocated ?? 0n,
  });

  const note = agent.evidenced
    ? `${agent.label} carries an effective record of ${agent.effectiveSettlements} settlements. One more breach moves its price to ${pct(ghost.premiumBps)} — a jump of ${pct(ghost.premiumBps - agent.basePremiumBps)} of face on every bond it writes after that.`
    : `${agent.label} has no settled bonds. It pays the median-agent rate until the market has evidence, and its first breach costs it ${pct(ghost.premiumBps - agent.basePremiumBps)} of face on everything after.`;

  yardstick.update(agent.basePremiumBps, ghost.premiumBps, note);
}

function renderSlip(app: HTMLElement, state: AppState): void {
  const agent = currentAgent(state);
  if (!agent || !state.pool) return;

  const face = toWei(state.face);
  const estimate = estimateDifficulty(state.criteria, state.duration);
  const q = quote({
    history: {
      weightedFailures: agent.weightedFailures,
      weightedHonored: agent.weightedHonored,
      liveExposure: agent.liveExposure,
    },
    faceValue: face,
    durationHours: state.duration,
    riskMultRaw: estimate.riskMult,
    poolCapital: state.pool.capital,
    poolAllocated: state.pool.allocated,
  });

  const set = (name: string, value: string) => {
    const node = app.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (node && node.textContent !== value) node.textContent = value;
  };

  set("duration-label", fmtHours(state.duration));
  set("premium", `${eth(q.premium, 4)} ETH`);
  set("premium-bps", pct(q.premiumBps));
  set("collateral", `${eth(q.collateral, 4)} ETH`);
  set("collateral-bps", pct(q.collateralBps));
  set("exposure", `${eth(q.poolExposure, 4)} ETH`);
  set("loss-rate", pct(q.lossRateBps));
  set("duration-load", pct(q.durationLoadBps));
  set("concentration", pct(q.concentrationLoadBps));
  set("risk-mult", `${(q.riskMult / 100).toFixed(2)}×`);
  set("driver", estimate.driver);

  const button = app.querySelector<HTMLButtonElement>("[data-bind]")!;
  const verdict = app.querySelector<HTMLElement>("[data-verdict]")!;

  if (face <= 0n) {
    button.disabled = true;
    verdict.textContent = "Enter a face value to price this bond.";
    verdict.dataset.tone = "idle";
  } else if (q.declined) {
    button.disabled = true;
    verdict.textContent = `Declined at the ${pct(PREMIUM_CAP_BPS)} cap. This risk is not priced, it is refused.`;
    verdict.dataset.tone = "bad";
  } else if (!q.bindable) {
    button.disabled = true;
    verdict.textContent = `Pool capacity is ${eth(q.capacityAvailable, 2)} ETH; this bond needs ${eth(q.poolExposure, 2)} ETH of it.`;
    verdict.dataset.tone = "warn";
  } else {
    button.disabled = state.busy;
    verdict.textContent = estimate.confident
      ? `The obligor pays ${eth(q.premium, 3)} ETH and locks ${eth(q.collateral, 3)} ETH of its own capital.`
      : "Thin criteria are priced as risk. Spell out what counts as delivered and the premium falls.";
    verdict.dataset.tone = estimate.confident ? "ok" : "warn";
  }
}

function renderPool(app: HTMLElement, state: AppState): void {
  if (!state.pool) return;
  const p = state.pool;
  const set = (name: string, value: string) => {
    const node = app.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (node && node.textContent !== value) node.textContent = value;
  };
  set("capital", `${eth(p.capital, 1)} ETH`);
  set("free", `${eth(p.free, 1)} ETH`);
  set("utilisation", pct(p.utilisationBps, 1));
  set("earned", `${eth(p.premiumsEarned, 2)} ETH`);
  set("claims", `${eth(p.claimsPaid, 2)} ETH`);
  set("open-bonds", String(p.openBonds));
}

function renderConsole(app: HTMLElement, state: AppState): void {
  const host = app.querySelector<HTMLElement>("[data-risk]")!;
  const risk = state.risk;
  if (!risk) {
    host.innerHTML = `<p class="muted">No live bonds. The pool is carrying no risk and earning nothing.</p>`;
    return;
  }

  const bars = Array.from(risk.histogram)
    .map((count, i) => {
      const height = risk.histogramMax > 0 ? (count / risk.histogramMax) * 100 : 0;
      const loss = (i + 0.5) * risk.binWidth;
      return `<span class="hist__bar" style="height:${height.toFixed(2)}%"
                    title="${loss.toFixed(1)} ETH loss — ${((count / risk.trials) * 100).toFixed(2)}% of trials"></span>`;
    })
    .join("");

  host.innerHTML = `
    <div class="hist" role="img" aria-label="Simulated distribution of losses on the live book">${bars}</div>
    <dl class="stats stats--risk">
      <div><dt>Expected loss</dt><dd>${risk.meanLoss.toFixed(2)} ETH</dd></div>
      <div><dt>1-in-20 loss</dt><dd>${risk.p95.toFixed(2)} ETH</dd></div>
      <div><dt>1-in-100 loss</dt><dd>${risk.p99.toFixed(2)} ETH</dd></div>
      <div><dt>Chance of exhausting free capital</dt><dd>${(risk.probabilityOfRuin * 100).toFixed(2)}%</dd></div>
      <div><dt>Premium earned less expected loss</dt>
          <dd data-tone="${risk.expectedProfit >= 0 ? "ok" : "bad"}">${risk.expectedProfit.toFixed(2)} ETH</dd></div>
    </dl>
    <p class="muted">${risk.trials.toLocaleString("en-US")} trials, recomputed off the main thread whenever the book changes.</p>`;
}

function renderNotice(app: HTMLElement, state: AppState): void {
  const host = app.querySelector<HTMLElement>("[data-notice]")!;
  if (!state.notice) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.dataset.tone = state.notice.tone;
  host.textContent = state.notice.text;
}

// -------------------------------------------------------------------- writes

async function bind(store: Store<AppState>): Promise<void> {
  const state = store.state;
  const agent = currentAgent(state);
  if (!agent || state.busy) return;

  store.set({ busy: true, notice: { tone: "ok", text: "Pricing the task with the validator set…" } });
  try {
    const result = await state.backend.bind({
      principal: state.backend.account,
      obligor: agent.address,
      faceValue: toWei(state.face),
      durationHours: state.duration,
      criteria: state.criteria,
    });
    await refresh(store);
    store.set({
      notice: {
        tone: "ok",
        text: `Bond ${String(result.bondId).padStart(4, "0")} bound at ${(result.riskMult / 100).toFixed(2)}× difficulty — ${result.driver}.`,
      },
    });
  } catch (error) {
    store.set({ notice: { tone: "bad", text: (error as Error).message } });
  } finally {
    store.set({ busy: false });
  }
}

function openBond(store: Store<AppState>, bond: Bond): void {
  const dialog = document.querySelector<HTMLDialogElement>("#bond-dialog")!;
  const settled = bond.state !== "bound";

  dialog.innerHTML = `
    <form method="dialog" class="sheet">
      <header class="sheet__head">
        <span class="sheet__bond">Bond ${String(bond.id).padStart(4, "0")}</span>
        <span class="stamp stamp--${bond.state}">${bond.state}</span>
      </header>
      <p class="sheet__criteria">${bond.criteria}</p>
      <dl class="stats">
        <div><dt>Obligor</dt><dd>${addr(bond.obligor, 10, 6)}</dd></div>
        <div><dt>Face value</dt><dd>${eth(bond.faceValue, 3)} ETH</dd></div>
        <div><dt>Premium paid</dt><dd>${eth(bond.premium, 4)} ETH · ${pct(bond.premiumBps)}</dd></div>
        <div><dt>Obligor collateral</dt><dd>${eth(bond.collateral, 4)} ETH</dd></div>
        <div><dt>Difficulty</dt><dd>${(bond.riskMult / 100).toFixed(2)}×</dd></div>
        <div><dt>Deadline</dt><dd>${new Date(bond.deadline * 1000).toLocaleString()}</dd></div>
      </dl>
      ${bond.verdictNote ? `<p class="sheet__verdict">Verdict: ${bond.verdictNote}</p>` : ""}
      ${
        settled
          ? ""
          : `<label class="field">
               <span>Artifact URL</span>
               <input type="url" data-artifact placeholder="https://artifacts.genbonds.dev/run/…"
                      value="${bond.artifactUrl}" />
             </label>`
      }
      <footer class="sheet__foot">
        <button value="close" class="button button--quiet">Close</button>
        ${settled ? "" : `<button value="settle" class="button" data-settle>Settle this bond</button>`}
      </footer>
    </form>`;

  dialog.showModal();
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "settle") return;
      const artifact = dialog.querySelector<HTMLInputElement>("[data-artifact]")?.value.trim();
      const { backend } = store.state;
      store.set({ notice: { tone: "ok", text: "Validators are reading the artifact…" } });
      try {
        if (artifact) await backend.submitDelivery(bond.id, artifact);
        const outcome = await backend.settle(bond.id);
        await refresh(store);
        store.set({
          notice: {
            tone: outcome.state === "honored" ? "ok" : "bad",
            text:
              outcome.state === "honored"
                ? `Bond ${bond.id} honoured — ${outcome.note}. Collateral returned; the obligor's next bond prices at ${pct(outcome.nextPremiumBps)}.`
                : `Bond ${bond.id} breached — ${outcome.note}. Face value paid to the principal; the obligor's next bond prices at ${pct(outcome.nextPremiumBps)}.`,
          },
        });
      } catch (error) {
        store.set({ notice: { tone: "bad", text: (error as Error).message } });
      }
    },
    { once: true },
  );
}

// ------------------------------------------------------------------ template

function template(): string {
  return `
  <header class="masthead">
    <div class="masthead__mark">
      <span class="wordmark">GenBonds</span>
      <span class="wordmark__rule" aria-hidden="true"></span>
      <span class="tagline">the market prices an agent's promise</span>
    </div>
    <div class="masthead__actions">
      <span class="mode" data-mode></span>
      <button class="wallet" type="button" data-wallet>connect wallet</button>
    </div>
  </header>

  <p class="notice" data-notice hidden></p>

  <section class="panel panel--instrument">
    <div data-yardstick></div>
    <div class="roster" data-roster></div>
  </section>

  <div class="grid">
    <section class="panel panel--slip">
      <h2 class="panel__title">Price a job</h2>

      <label class="field">
        <span>Face value the principal is protected for</span>
        <span class="field__row">
          <input type="text" inputmode="decimal" data-face aria-label="Face value in ETH" />
          <em>ETH</em>
        </span>
      </label>

      <label class="field">
        <span>Time allowed · <b data-out="duration-label">24h</b></span>
        <input type="range" min="1" max="336" step="1" data-duration />
      </label>

      <label class="field">
        <span>What counts as delivered</span>
        <textarea rows="5" data-criteria
          placeholder="State the acceptance criteria precisely enough for a stranger to adjudicate them."></textarea>
      </label>

      <div class="quote">
        <div class="quote__headline">
          <span class="quote__label">Premium</span>
          <span class="quote__value" data-out="premium">—</span>
          <span class="quote__bps" data-out="premium-bps">—</span>
        </div>
        <div class="quote__headline quote__headline--minor">
          <span class="quote__label">Obligor posts</span>
          <span class="quote__value" data-out="collateral">—</span>
          <span class="quote__bps" data-out="collateral-bps">—</span>
        </div>
      </div>

      <table class="breakdown">
        <caption>How the price is built</caption>
        <tbody>
          <tr><th>Record</th><td data-out="loss-rate">—</td><td>posterior failure rate</td></tr>
          <tr><th>Time at risk</th><td data-out="duration-load">—</td><td>load for the window</td></tr>
          <tr><th>Concentration</th><td data-out="concentration">—</td><td>pool exposure to this agent</td></tr>
          <tr><th>Difficulty</th><td data-out="risk-mult">—</td><td data-out="driver">estimated locally</td></tr>
          <tr><th>Pool exposure</th><td data-out="exposure">—</td><td>capital at risk after collateral</td></tr>
        </tbody>
      </table>

      <p class="verdict" data-verdict data-tone="idle"></p>
      <button class="button button--bind" type="button" data-bind>Bind this bond</button>
      <p class="muted">Difficulty is estimated in the browser so the slip stays live. The contract re-derives it from validator consensus when the bond binds, and may disagree.</p>
    </section>

    <section class="panel panel--book">
      <div class="panel__head">
        <h2 class="panel__title">The book</h2>
        <dl class="stats stats--inline">
          <div><dt>Capital</dt><dd data-out="capital">—</dd></div>
          <div><dt>Free</dt><dd data-out="free">—</dd></div>
          <div><dt>Utilisation</dt><dd data-out="utilisation">—</dd></div>
          <div><dt>Earned</dt><dd data-out="earned">—</dd></div>
          <div><dt>Claims</dt><dd data-out="claims">—</dd></div>
          <div><dt>Live</dt><dd data-out="open-bonds">—</dd></div>
        </dl>
      </div>
      <div data-book></div>
    </section>
  </div>

  <section class="panel panel--console">
    <h2 class="panel__title">What a bad day costs</h2>
    <div data-risk></div>
  </section>

  <dialog id="bond-dialog" class="dialog"></dialog>`;
}

boot();
