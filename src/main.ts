import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PluginSettings } from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";
import { subscribeThemeChange } from "./lib/theme";

export default class ObsidianDrawioPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  reactMountManager!: ReactMountManager;
  private disposers: Array<() => void> = [];

  async onload(): Promise<void> {
    try {
      this.settings = await loadSettings(this);
      this.reactMountManager = createReactMountManager();

      const disposeTheme = subscribeThemeChange(this, (theme) => {
        console.debug("[obsidian-drawio] theme changed:", theme);
      });
      this.disposers.push(disposeTheme);
    } catch (error) {
      console.error("[obsidian-drawio] onload failed:", error);
    }
  }

  onunload(): void {
    for (const dispose of this.disposers) dispose();
    this.reactMountManager.unmountAll();
  }

  async saveSettings(): Promise<void> {
    await saveSettings(this, this.settings);
  }
}
