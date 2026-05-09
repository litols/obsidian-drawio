import type { Plugin } from "obsidian";
import type { DrawioBridge } from "./drawio-bridge";
import type { DrawioSettings, DrawioTheme } from "./settings";
import { getCurrentTheme, subscribeThemeChange, type Theme } from "./theme";

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

export interface ThemeBridge {
  registerBridge(bridge: DrawioBridge): void;
  unregisterBridge(bridge: DrawioBridge): void;
  applyTheme(bridge: DrawioBridge): void;
  dispose(): void;
}

export function createThemeBridge(plugin: Plugin, getSettings: () => DrawioSettings): ThemeBridge {
  const bridges = new Set<DrawioBridge>();

  function applyTheme(bridge: DrawioBridge): void {
    const settings = getSettings();
    const obsidianTheme = getCurrentTheme();
    const resolved = resolveBridgeTheme(settings.theme, obsidianTheme);
    bridge.setTheme(resolved.setTheme);
    if (resolved.uiVariant) {
      bridge.sendMessage({
        action: "configure",
        config: { ui: resolved.uiVariant },
      });
    }
  }

  const disposeThemeSub = subscribeThemeChange(plugin, (_theme: Theme) => {
    const settings = getSettings();
    if (settings.theme !== "auto") return;
    for (const bridge of bridges) {
      applyTheme(bridge);
    }
  });

  return {
    registerBridge(bridge: DrawioBridge): void {
      bridges.add(bridge);
    },
    unregisterBridge(bridge: DrawioBridge): void {
      bridges.delete(bridge);
    },
    applyTheme,
    dispose(): void {
      disposeThemeSub();
      bridges.clear();
    },
  };
}
