import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PluginSettings } from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";

export default class ObsidianDrawioPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  reactMountManager!: ReactMountManager;
  private disposers: Array<() => void> = [];

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    this.reactMountManager = createReactMountManager();
  }

  onunload(): void {
    for (const dispose of this.disposers) dispose();
    this.reactMountManager.unmountAll();
  }

  async saveSettings(): Promise<void> {
    await saveSettings(this, this.settings);
  }
}
