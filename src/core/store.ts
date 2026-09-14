/**
 * A ~60-line reactive store instead of a framework.
 *
 * The app re-prices on every slider frame, so the render path has to be
 * predictable: writes mark subscribers dirty, one animation frame flushes them
 * all, and each subscriber patches only the nodes it owns. No virtual DOM, no
 * diff, no reconciliation cost that scales with the size of the page.
 */

type Listener<T> = (state: T) => void;

export class Store<T extends object> {
  #state: T;
  #listeners = new Set<Listener<T>>();
  #dirty = new Set<Listener<T>>();
  #frame = 0;

  constructor(initial: T) {
    this.#state = initial;
  }

  get state(): Readonly<T> {
    return this.#state;
  }

  /** Subscribe and run once immediately, so views never need a separate mount path. */
  subscribe(listener: Listener<T>): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof T>) {
      const next = patch[key];
      if (next === undefined) continue;
      if (!Object.is(this.#state[key], next)) {
        this.#state[key] = next as T[typeof key];
        changed = true;
      }
    }
    if (changed) this.#schedule();
  }

  /** Force a flush without changing state — used after imperative DOM swaps. */
  touch(): void {
    this.#schedule();
  }

  #schedule(): void {
    for (const listener of this.#listeners) this.#dirty.add(listener);
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const pending = [...this.#dirty];
      this.#dirty.clear();
      for (const listener of pending) listener(this.#state);
    });
  }
}

/**
 * Coalesce rapid calls into one per frame. Used for pointer-driven inputs so a
 * dragged slider costs one recompute per frame, not one per event.
 */
export function perFrame<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let frame = 0;
  let latest: A;
  return (...args: A) => {
    latest = args;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn(...latest);
    });
  };
}
