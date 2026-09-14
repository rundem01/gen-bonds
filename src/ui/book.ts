/**
 * The book — every bond the pool has written, newest first.
 *
 * Windowed rendering: only the rows inside the viewport plus a small overscan
 * exist in the DOM, so a book of fifty thousand bonds costs the same to scroll
 * as a book of thirty. Row height is fixed for exactly this reason; variable
 * heights would mean measuring, and measuring means layout on every frame.
 */

import { addr, eth, pct, relativeTime } from "../core/format.ts";
import type { Bond } from "../core/types.ts";

const ROW_H = 56;
const OVERSCAN = 4;

export class BookView {
  #viewport: HTMLElement;
  #spacer: HTMLElement;
  #window: HTMLElement;
  #bonds: Bond[] = [];
  #frame = 0;
  #lastRange = "";
  #onSelect: (bond: Bond) => void;

  constructor(host: HTMLElement, onSelect: (bond: Bond) => void) {
    this.#onSelect = onSelect;
    host.innerHTML = `
      <div class="book" data-viewport>
        <div class="book__spacer" data-spacer></div>
        <div class="book__window" data-window></div>
      </div>`;
    this.#viewport = host.querySelector("[data-viewport]")!;
    this.#spacer = host.querySelector("[data-spacer]")!;
    this.#window = host.querySelector("[data-window]")!;

    this.#viewport.addEventListener("scroll", () => this.#schedule(), { passive: true });
    this.#window.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-bond]");
      if (!row) return;
      const bond = this.#bonds.find((b) => b.id === Number(row.dataset.bond));
      if (bond) this.#onSelect(bond);
    });
  }

  setBonds(bonds: Bond[]): void {
    this.#bonds = bonds;
    this.#spacer.style.height = `${bonds.length * ROW_H}px`;
    this.#lastRange = "";
    this.#schedule();
  }

  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  #render(): void {
    const scroll = this.#viewport.scrollTop;
    const height = this.#viewport.clientHeight || 420;
    const first = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
    const last = Math.min(this.#bonds.length, Math.ceil((scroll + height) / ROW_H) + OVERSCAN);

    const range = `${first}:${last}:${this.#bonds.length}`;
    if (range === this.#lastRange) return;
    this.#lastRange = range;

    this.#window.style.transform = `translateY(${first * ROW_H}px)`;
    this.#window.innerHTML = this.#bonds.slice(first, last).map(row).join("");
  }
}

function row(bond: Bond): string {
  const overdue = bond.state === "bound" && bond.deadline < Date.now() / 1000;
  return `
    <article class="bond bond--${bond.state}" data-bond="${bond.id}" tabindex="0">
      <span class="bond__id">${String(bond.id).padStart(4, "0")}</span>
      <span class="bond__party">
        <span class="bond__obligor">${addr(bond.obligor)}</span>
        <span class="bond__criteria">${escapeHtml(bond.criteria.slice(0, 68))}…</span>
      </span>
      <span class="bond__face">${eth(bond.faceValue)}<em>ETH face</em></span>
      <span class="bond__rate">${pct(bond.premiumBps)}<em>premium</em></span>
      <span class="bond__state">
        ${overdue ? "overdue" : bond.state}
        <em>${bond.state === "bound" ? relativeTime(bond.deadline) : escapeHtml(bond.verdictNote.slice(0, 34))}</em>
      </span>
    </article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
