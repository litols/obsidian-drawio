import { Plugin, type TFile } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PluginSettings } from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";
import { subscribeThemeChange } from "./lib/theme";
import { registerDemoCommand } from "./commands/demo-command";
import { DrawioView, DRAWIO_VIEW_TYPE } from "./views/DrawioView";

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

      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioView(leaf, this));
      this.registerExtensions(["drawio"], DRAWIO_VIEW_TYPE);

      this.registerEvent(
        this.app.workspace.on("file-open", async (file: TFile | null) => {
          if (!file) return;
          const name = file.name.toLowerCase();
          const isSvg = name.endsWith(".drawio.svg");
          const isPng = name.endsWith(".drawio.png");
          if (!isSvg && !isPng) return;

          if (isSvg && this.settings.openDrawioSvg !== true) return;
          if (isPng && this.settings.openDrawioPng !== true) return;

          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf) return;
          if (leaf.view?.getViewType() === DRAWIO_VIEW_TYPE) return;

          await leaf.setViewState({
            type: DRAWIO_VIEW_TYPE,
            state: { file: file.path },
          });
        }),
      );

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
