export type Theme = "light" | "dark";

/**
 * Returns the current Obsidian theme based on the `theme-dark` body class.
 * Reads only DOM state; safe to call multiple times.
 */
export function getCurrentTheme(): Theme {
  return document.body.classList.contains("theme-dark") ? "dark" : "light";
}
