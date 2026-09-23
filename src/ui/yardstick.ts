/**
 * The yardstick.
 *
 * One scale, every agent on it. Each obligor is a tick positioned by what its
 * promise currently costs, so the shape of the market is visible at a glance:
 * a cluster on the cheap left, stragglers out toward the expensive end, and
 * the distance between them is the spread the market charges for reliability.
 *
 * The selected agent lifts off the rule and is read out above. A dashed mark
 * shows where it would land after one more breach — the same forward-looking
 * claim, now measurable against every peer rather than against nothing.
 *
 * Built once, then only transforms and text nodes are touched, so selecting an
 * agent never triggers layout.
 */

import { pct } from "../core/format.ts";
import { PREMIUM_CAP_BPS } from "../core/pricing.ts";

const TICKS = [25, 100, 250, 500, 1000, 2000, 3500, 5000];
const W = 1200;
const H = 260;
const PAD = 52;
const BASE = 188;

/** Square-root scale: cheap risk is where the resolution is needed. */
function x(bps: number): number {
  const clamped = Math.max(0, Math.min(PREMIUM_CAP_BPS, bps));
  return PAD + Math.sqrt(clamped / PREMIUM_CAP_BPS) * (W - PAD * 2);
}

export interface Plotted {
  address: string;
  label: string;
  premiumBps: number;
}

const NS = "http://www.w3.org/2000/svg";

function make<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class Yardstick {
  #root: SVGSVGElement;
  #market: SVGGElement;
  #needle: SVGGElement;
  #ghost: SVGGElement;
  #span: SVGRectElement;
  #reading: HTMLElement;
  #name: HTMLElement;
  #caption: HTMLElement;
  #current = 0;
  #onSelect: (address: string) => void;

  constructor(host: HTMLElement, onSelect: (address: string) => void) {
    this.#onSelect = onSelect;

    host.innerHTML = `
      <div class="instrument">
        <p class="instrument__agent" data-name></p>
        <p class="instrument__readout">
          <span class="instrument__reading" data-reading>—</span>
          <span class="instrument__unit">of face value is what this agent’s word costs today</span>
        </p>
        <svg class="instrument__rule" viewBox="0 0 ${W} ${H}" role="img"
             aria-label="Every agent in the market, plotted by the price of its promise"></svg>
        <p class="instrument__caption" data-caption></p>
      </div>`;

    this.#root = host.querySelector("svg")!;
    this.#reading = host.querySelector("[data-reading]")!;
    this.#name = host.querySelector("[data-name]")!;
    this.#caption = host.querySelector("[data-caption]")!;

    // The shaded span between today's price and the post-breach price.
    this.#span = make("rect", {
      x: PAD,
      y: BASE - 30,
      width: 0,
      height: 30,
      class: "instrument__span",
    });
    this.#root.append(this.#span);

    this.#root.append(
      make("line", { x1: PAD, y1: BASE, x2: W - PAD, y2: BASE, class: "instrument__baseline" }),
    );

    for (let bps = 0; bps <= PREMIUM_CAP_BPS; bps += 100) {
      const major = TICKS.includes(bps);
      this.#root.append(
        make("line", {
          x1: x(bps),
          y1: BASE,
          x2: x(bps),
          y2: BASE + (major ? 15 : 7),
          class: major ? "instrument__tick instrument__tick--major" : "instrument__tick",
        }),
      );
    }

    for (const bps of TICKS) {
      const label = make("text", { x: x(bps), y: BASE + 38, class: "instrument__label" });
      label.textContent = bps >= 1000 ? `${bps / 1000}k` : String(bps);
      this.#root.append(label);
    }

    const unit = make("text", { x: W - PAD, y: BASE + 60, class: "instrument__axis" });
    unit.textContent = "basis points of face value";
    this.#root.append(unit);

    // Every agent in the market lives in here, rebuilt only when the roster
    // itself changes.
    this.#market = make("g", { class: "instrument__market" });
    this.#root.append(this.#market);

    this.#ghost = make("g", { class: "instrument__needle instrument__needle--ghost" });
    this.#ghost.append(
      make("line", { x1: 0, y1: BASE - 38, x2: 0, y2: BASE }),
      make("path", { d: `M0,${BASE - 38} L-6,${BASE - 50} L6,${BASE - 50} Z` }),
    );
    const ghostLabel = make("text", { x: 0, y: BASE - 58, class: "instrument__ghost-label" });
    ghostLabel.textContent = "after one breach";
    this.#ghost.append(ghostLabel);
    this.#root.append(this.#ghost);

    this.#needle = make("g", { class: "instrument__needle" });
    this.#needle.append(
      make("line", { x1: 0, y1: BASE - 56, x2: 0, y2: BASE + 20 }),
      make("path", { d: `M0,${BASE - 56} L-9,${BASE - 74} L9,${BASE - 74} Z` }),
    );
    this.#root.append(this.#needle);

    this.#market.addEventListener("click", (event) => {
      const mark = (event.target as Element).closest("[data-agent]");
      if (mark) this.#onSelect((mark as SVGElement).dataset.agent!);
    });
  }

  /** Rebuild the plotted market. Called only when the roster changes. */
  setMarket(agents: Plotted[], selected: string): void {
    this.#market.replaceChildren();
    for (const agent of agents) {
      const at = x(agent.premiumBps);
      const on = agent.address === selected;
      const group = make("g", {
        class: on ? "instrument__mark instrument__mark--on" : "instrument__mark",
        transform: `translate(${at} 0)`,
      });
      group.dataset.agent = agent.address;

      group.append(
        make("line", { x1: 0, y1: BASE, x2: 0, y2: BASE - (on ? 34 : 18) }),
        make("circle", { cx: 0, cy: BASE - (on ? 34 : 18), r: on ? 4.5 : 3 }),
      );

      const label = make("text", {
        x: 0,
        y: BASE - (on ? 46 : 30),
        class: "instrument__mark-label",
      });
      label.textContent = agent.label;
      group.append(label);

      const hit = make("rect", {
        x: -18,
        y: BASE - 52,
        width: 36,
        height: 64,
        fill: "transparent",
      });
      group.append(hit);

      this.#market.append(group);
    }
  }

  /**
   * @param bps      the selected agent's current base premium
   * @param ghostBps what it would cost after one more breach
   * @param label    the agent's name
   * @param note     one line of context under the rule
   */
  update(bps: number, ghostBps: number, label: string, note: string): void {
    const target = x(bps);
    const ghost = x(ghostBps);
    this.#needle.setAttribute("transform", `translate(${target} 0)`);
    this.#ghost.setAttribute("transform", `translate(${ghost} 0)`);
    this.#span.setAttribute("x", String(target));
    this.#span.setAttribute("width", String(Math.max(0, ghost - target)));
    this.#name.textContent = label;
    this.#caption.textContent = note;
    this.#animate(bps);
  }

  /** Count the reading up rather than snapping it — this is a gauge. */
  #animate(next: number): void {
    const from = this.#current;
    this.#current = next;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.#reading.textContent = pct(next);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 460);
      const eased = 1 - (1 - t) ** 3;
      this.#reading.textContent = pct(from + (next - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
