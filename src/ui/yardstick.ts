/**
 * The yardstick.
 *
 * A rule marked in basis points, with a needle at the agent's current price
 * and a ghost needle at the price it would carry after one more breach. The
 * gap between the two is the whole argument: reliability here is a distance on
 * a scale someone pays to move along, not a badge.
 *
 * The SVG is built once and then only its transforms and text nodes are
 * touched, so a drag on the quote slip never triggers layout on this element.
 */

import { pct } from "../core/format.ts";
import { PREMIUM_CAP_BPS } from "../core/pricing.ts";

const TICKS = [25, 100, 250, 500, 1000, 2000, 3500, 5000];
const W = 1000;
const H = 190;
const PAD = 44;

/** Square-root scale: cheap risk is where the resolution is needed. */
function x(bps: number): number {
  const clamped = Math.max(0, Math.min(PREMIUM_CAP_BPS, bps));
  return PAD + (Math.sqrt(clamped / PREMIUM_CAP_BPS) * (W - PAD * 2));
}

export class Yardstick {
  #root: SVGSVGElement;
  #needle: SVGGElement;
  #ghost: SVGGElement;
  #span: SVGRectElement;
  #reading: HTMLElement;
  #caption: HTMLElement;
  #current = 0;

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <div class="yardstick">
        <div class="yardstick__readout">
          <span class="yardstick__reading" data-reading>—</span>
          <span class="yardstick__unit">of face value, per bond</span>
        </div>
        <svg class="yardstick__rule" viewBox="0 0 ${W} ${H}" role="img"
             aria-label="Price of trust on a basis-point scale"></svg>
        <p class="yardstick__caption" data-caption></p>
      </div>`;

    this.#root = host.querySelector("svg")!;
    this.#reading = host.querySelector("[data-reading]")!;
    this.#caption = host.querySelector("[data-caption]")!;

    const make = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number> = {},
    ): SVGElementTagNameMap[K] => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      return el;
    };

    const baseline = H - 64;

    // The shaded span between today's price and the post-breach price.
    this.#span = make("rect", {
      x: PAD,
      y: baseline - 26,
      width: 0,
      height: 26,
      class: "yardstick__span",
    });
    this.#root.append(this.#span);

    this.#root.append(make("line", { x1: PAD, y1: baseline, x2: W - PAD, y2: baseline, class: "yardstick__baseline" }));

    // Minor ticks every 100 bps, drawn on the same square-root scale.
    for (let bps = 0; bps <= PREMIUM_CAP_BPS; bps += 100) {
      const major = TICKS.includes(bps);
      this.#root.append(
        make("line", {
          x1: x(bps),
          y1: baseline,
          x2: x(bps),
          y2: baseline + (major ? 14 : 7),
          class: major ? "yardstick__tick yardstick__tick--major" : "yardstick__tick",
        }),
      );
    }

    for (const bps of TICKS) {
      const label = make("text", { x: x(bps), y: baseline + 34, class: "yardstick__label" });
      label.textContent = bps >= 1000 ? `${bps / 1000}k` : String(bps);
      this.#root.append(label);
    }

    const unit = make("text", { x: W - PAD, y: baseline + 54, class: "yardstick__axis-unit" });
    unit.textContent = "basis points of face value";
    this.#root.append(unit);

    this.#ghost = make("g", { class: "yardstick__needle yardstick__needle--ghost" });
    this.#ghost.append(
      make("path", { d: `M0,${baseline - 34} L-7,${baseline - 48} L7,${baseline - 48} Z` }),
      make("line", { x1: 0, y1: baseline - 34, x2: 0, y2: baseline }),
    );
    const ghostLabel = make("text", { x: 0, y: baseline - 56, class: "yardstick__needle-label" });
    ghostLabel.textContent = "after one breach";
    this.#ghost.append(ghostLabel);
    this.#root.append(this.#ghost);

    this.#needle = make("g", { class: "yardstick__needle" });
    this.#needle.append(
      make("path", { d: `M0,${baseline - 34} L-9,${baseline - 52} L9,${baseline - 52} Z` }),
      make("line", { x1: 0, y1: baseline - 34, x2: 0, y2: baseline + 18 }),
    );
    this.#root.append(this.#needle);
  }

  /**
   * @param bps      the agent's current base premium
   * @param ghostBps the premium it would carry after one more breach
   * @param note     one line of context under the rule
   */
  update(bps: number, ghostBps: number, note: string): void {
    const target = x(bps);
    const ghost = x(ghostBps);
    this.#needle.setAttribute("transform", `translate(${target} 0)`);
    this.#ghost.setAttribute("transform", `translate(${ghost} 0)`);
    this.#span.setAttribute("x", String(target));
    this.#span.setAttribute("width", String(Math.max(0, ghost - target)));
    this.#caption.textContent = note;
    this.#animateReading(bps);
  }

  /** Count the reading up rather than snapping it — this is a gauge, not a label. */
  #animateReading(next: number): void {
    const from = this.#current;
    this.#current = next;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.#reading.textContent = pct(next);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 420);
      const eased = 1 - (1 - t) ** 3;
      this.#reading.textContent = pct(from + (next - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
