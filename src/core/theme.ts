/**
 * Theme.
 *
 * Dark is the default because the instrument was designed to be read lit —
 * bone marks on a dark plate. Light is the paper the same numbers get written
 * onto. Neither is a tint of the other; both are full token sets.
 *
 * Order of authority: an explicit choice the person made, then the system
 * preference, then dark. A stored choice survives reloads and is never
 * overridden by the system changing underneath it.
 */

export type Theme = "dark" | "light";

const KEY = "genbonds:theme";

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Private browsing and blocked storage both throw. Not worth surfacing.
    return null;
  }
}

function systemPrefers(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export class ThemeController {
  #theme: Theme;
  #listeners = new Set<(theme: Theme) => void>();

  constructor() {
    this.#theme = stored() ?? systemPrefers();
    this.#apply();

    // Follow the system only while the person hasn't expressed a preference.
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (stored()) return;
      this.#theme = systemPrefers();
      this.#apply();
    });
  }

  get theme(): Theme {
    return this.#theme;
  }

  subscribe(listener: (theme: Theme) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#theme);
    return () => this.#listeners.delete(listener);
  }

  toggle(): void {
    this.set(this.#theme === "dark" ? "light" : "dark");
  }

  set(theme: Theme): void {
    this.#theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Choice still applies for this session.
    }
    this.#apply();
  }

  #apply(): void {
    document.documentElement.dataset.theme = this.#theme;
    // Keep form controls and scrollbars in step with the palette.
    document.documentElement.style.colorScheme = this.#theme;
    for (const listener of this.#listeners) listener(this.#theme);
  }
}
