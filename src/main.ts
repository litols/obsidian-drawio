import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PluginSettings } from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";
import { subscribeThemeChange } from "./lib/theme";
import { registerDemoCommand } from "./commands/demo-command";

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

      registerDemoCommand(this);
    } catch (error) {
      console.error("[obsidian-drawio] onload failed:", error);
    }
  }

  onunload(): void {
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]();
      } catch (error) {
        console.error("[obsidian-drawio] dispose failed:", error);
      }
    }
    this.disposers = [];
    this.reactMountManager?.unmountAll();
  }

  async saveSettings(): Promise<void> {
    await saveSettings(this, this.settings);
  }
}
