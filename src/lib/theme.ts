import type { Plugin } from "obsidian";

export type Theme = "light" | "dark";

/**
 * Returns the current Obsidian theme based on the `theme-dark` body class.
 * Reads only DOM state; safe to call multiple times.
 */
export function getCurrentTheme(): Theme {
  return document.body.classList.contains("theme-dark") ? "dark" : "light";
}

/**
 * Subscribe to Obsidian theme changes.
 *
 * Calls `callback` with the current theme whenever Obsidian fires
 * `workspace.on('css-change')`. Returns a dispose function that detaches
 * the listener.
 *
 * Note: this uses `app.workspace.on(...)` + `offref(...)` directly instead
 * of `plugin.registerEvent(...)` so subscribers can dispose independently
 * of the plugin lifetime (e.g. a transient view that unmounts before the
 * plugin unloads).
 */
export function subscribeThemeChange(plugin: Plugin, callback: (theme: Theme) => void): () => void {
  const ref = plugin.app.workspace.on("css-change", () => {
    callback(getCurrentTheme());
  });
  return () => {
    plugin.app.workspace.offref(ref);
  };
}
