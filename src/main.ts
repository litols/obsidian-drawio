import { Events, Notice, Plugin, type TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  saveSettings,
  type PluginSettings,
} from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";
import { registerDemoCommand } from "./commands/demo-command";
import { DrawioView, DRAWIO_VIEW_TYPE } from "./views/DrawioView";
import { registerPerDiagramConfigLifecycle } from "./lib/per-diagram-config";
import { createThemeBridge, type ThemeBridge } from "./lib/theme-bridge";
import { DrawioSettingTab } from "./views/SettingsTab";
import { DiagramSettingsModal } from "./views/DiagramSettingsModal";
import { createExternalWatcher, type ExternalWatcher } from "./lib/external-watcher";
import { createDrawioPluginApi, type DrawioPublicApi } from "./lib/plugin-api";

export default class ObsidianDrawioPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  reactMountManager!: ReactMountManager;
  themeBridge!: ThemeBridge;
  events: Events = new Events();
  externalWatcher: ExternalWatcher | null = null;
  api!: DrawioPublicApi;
  private disposers: Array<() => void> = [];

  async onload(): Promise<void> {
    try {
      const persisted = (await this.loadData()) as Record<string, unknown> | null;
      const drawioSettings = migrateSettings(persisted);
      this.settings = { drawio: drawioSettings };
      await saveSettings(this, this.settings);

      this.reactMountManager = createReactMountManager();
      this.themeBridge = createThemeBridge(this, () => this.settings.drawio!);

      this.externalWatcher = createExternalWatcher(
        this,
        this.app.vault,
        () => this.settings.drawio!.externalSync,
      );
      const apiResult = createDrawioPluginApi(this);
      this.api = apiResult.api;
      this.disposers.push(apiResult.dispose);

      this.addSettingTab(new DrawioSettingTab(this.app, this));
      registerPerDiagramConfigLifecycle(this);
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioView(leaf, this));
      this.registerExtensions(["drawio"], DRAWIO_VIEW_TYPE);

      this.registerEvent(
        this.app.workspace.on("file-open", async (file: TFile | null) => {
          if (!file) return;
          const name = file.name.toLowerCase();
          const isSvg = name.endsWith(".drawio.svg");
          const isPng = name.endsWith(".drawio.png");
          if (!isSvg && !isPng) return;

          if (isSvg && this.settings.drawio?.openDrawioSvg !== true) return;
          if (isPng && this.settings.drawio?.openDrawioPng !== true) return;

          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf) return;
          if (leaf.view?.getViewType() === DRAWIO_VIEW_TYPE) return;

          await leaf.setViewState({
            type: DRAWIO_VIEW_TYPE,
            state: { file: file.path },
          });
        }),
      );

      this.addCommand({
        id: "edit-per-diagram-settings",
        name: "drawio: 図の設定を編集",
        callback: () => {
          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf || leaf.view?.getViewType() !== DRAWIO_VIEW_TYPE) {
            new Notice("draw.io ファイルを開いた状態で実行してください");
            return;
          }
          const view = leaf.view as DrawioView;
          if (!view.file) {
            new Notice("draw.io ファイルが開かれていません");
            return;
          }
          new DiagramSettingsModal(this.app, this, view.file, () => {
            void view.reload(view.file!).catch((err) => {
              console.warn("[drawio] reload after per-diagram save failed:", err);
            });
          }).open();
        },
      });

      this.addCommand({
        id: "drawio-refresh-from-disk",
        name: "Refresh diagram from disk",
        callback: () => {
          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf || leaf.view?.getViewType() !== DRAWIO_VIEW_TYPE) {
            new Notice("draw.io ファイルを開いた状態で実行してください");
            return;
          }
          const view = leaf.view as DrawioView;
          if (!view.file) {
            new Notice("draw.io ファイルが開かれていません");
            return;
          }
          void view.reload(view.file, { force: true }).catch((err) => {
            console.error("[drawio] refresh-from-disk failed:", err);
            new Notice("ダイアグラムの再読み込みに失敗しました");
          });
        },
      });

      registerDemoCommand(this);
    } catch (error) {
      console.error("[obsidian-drawio] onload failed:", error);
    }
  }

  onunload(): void {
    this.externalWatcher?.dispose();
    this.externalWatcher = null;
    this.themeBridge?.dispose();
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
