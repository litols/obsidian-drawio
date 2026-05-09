import type { DrawioTheme } from "./settings";
import type { Theme } from "./theme";

export interface ResolvedBridgeTheme {
  setTheme: "light" | "dark";
  uiVariant?: "kennedy" | "min" | "atlas" | "dark";
}

export function resolveBridgeTheme(
  setting: DrawioTheme,
  currentObsidianTheme: Theme,
): ResolvedBridgeTheme {
  if (setting === "auto") {
    return { setTheme: currentObsidianTheme };
  }
  if (setting === "light") {
    return { setTheme: "light" };
  }
  if (setting === "dark") {
    return { setTheme: "dark", uiVariant: "dark" };
  }
  // kennedy / min / atlas → light + uiVariant
  return { setTheme: "light", uiVariant: setting };
}
