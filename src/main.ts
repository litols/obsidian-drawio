import { Events, Notice, Plugin, setIcon, TFile, type TAbstractFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  saveSettings,
  type PluginSettings,
} from "./lib/settings";
import { createReactMountManager, type ReactMountManager } from "./lib/react-mount";
import { createDrawioAssetCache, type DrawioAssetCache } from "./lib/drawio-asset-cache";
import { registerDemoCommand } from "./commands/demo-command";
import { DrawioView, DRAWIO_VIEW_TYPE } from "./views/DrawioView";
import { registerPerDiagramConfigLifecycle } from "./lib/per-diagram-config";
import { createThemeBridge, type ThemeBridge } from "./lib/theme-bridge";
import { DrawioSettingTab } from "./views/SettingsTab";
import { DiagramSettingsModal } from "./views/DiagramSettingsModal";
import { createExternalWatcher, type ExternalWatcher } from "./lib/external-watcher";
import { createDrawioPluginApi, type DrawioPublicApi } from "./lib/plugin-api";
import { registerDrawioEmbedPreview } from "./lib/drawio-embed";
import { initI18n, t } from "./lib/i18n";

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";

/** 新規ダイアグラム作成時に書き込む空の drawio ドキュメント。 */
const EMPTY_DRAWIO_XML =
  '<mxfile host="obsidian-drawio"><diagram id="0" name="Page-1">' +
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" ' +
  'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" ' +
  'pageHeight="1100" math="0" shadow="0"><root><mxCell id="0" />' +
  '<mxCell id="1" parent="0" /></root></mxGraphModel></diagram></mxfile>';

export default class ObsidianDrawioPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  reactMountManager!: ReactMountManager;
  themeBridge!: ThemeBridge;
  /** エディタバンドル / viewer スクリプトのセッションキャッシュ (アセット I/O の唯一の所有者) */
  assetCache!: DrawioAssetCache;
  events: Events = new Events();
  externalWatcher: ExternalWatcher | null = null;
  api!: DrawioPublicApi;
  private disposers: Array<() => void> = [];
  private newDiagramButtons: HTMLElement[] = [];

  async onload(): Promise<void> {
    try {
      initI18n();
      const persisted = (await this.loadData()) as Record<string, unknown> | null;
      const drawioSettings = migrateSettings(persisted);
      this.settings = { drawio: drawioSettings };
      await saveSettings(this, this.settings);

      this.reactMountManager = createReactMountManager();
      this.themeBridge = createThemeBridge(this, () => this.settings.drawio!);
      this.assetCache = createDrawioAssetCache(this.app.vault.adapter, this.manifest.dir ?? "");

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

      // `.drawio.svg` / `.drawio.png` のコンテキストメニューに「draw.io で編集」を追加
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
          if (!(file instanceof TFile)) return;
          const name = file.name.toLowerCase();
          if (!name.endsWith(".drawio.svg") && !name.endsWith(".drawio.png")) return;
          menu.addItem((item) => {
            item
              .setTitle(t("menu.editInDrawio"))
              .setIcon("pencil")
              .onClick(() => void this.openInDrawioView(file));
          });
        }),
      );

      // 埋め込み drawio リンクをライブプレビューに置き換える
      this.disposers.push(registerDrawioEmbedPreview(this));

      // ファイルエクスプローラの「新規ノート」ボタン横に「新規ダイアグラム」を追加
      this.app.workspace.onLayoutReady(() => this.installNewDiagramButtons());
      this.registerEvent(
        this.app.workspace.on("layout-change", () => this.installNewDiagramButtons()),
      );

      this.addCommand({
        id: "edit-per-diagram-settings",
        name: t("command.editPerDiagramSettings"),
        callback: () => {
          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf || leaf.view?.getViewType() !== DRAWIO_VIEW_TYPE) {
            new Notice(t("notice.openDrawioFileFirst"));
            return;
          }
          const view = leaf.view as DrawioView;
          if (!view.file) {
            new Notice(t("notice.noDrawioFileOpen"));
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
        name: t("command.refreshFromDisk"),
        callback: () => {
          const leaf = this.app.workspace.getMostRecentLeaf();
          if (!leaf || leaf.view?.getViewType() !== DRAWIO_VIEW_TYPE) {
            new Notice(t("notice.openDrawioFileFirst"));
            return;
          }
          const view = leaf.view as DrawioView;
          if (!view.file) {
            new Notice(t("notice.noDrawioFileOpen"));
            return;
          }
          void view.reload(view.file, { force: true }).catch((err) => {
            console.error("[drawio] refresh-from-disk failed:", err);
            new Notice(t("notice.reloadFailed"));
          });
        },
      });

      this.addCommand({
        id: "drawio-enter-editor",
        name: t("command.enterEditor"),
        callback: () => {
          const view = this.getActiveDrawioView();
          if (!view) {
            new Notice(t("notice.openDrawioFileFirst"));
            return;
          }
          void view.enterEditorMode();
        },
      });

      this.addCommand({
        id: "drawio-enter-preview",
        name: t("command.enterPreview"),
        callback: () => {
          const view = this.getActiveDrawioView();
          if (!view) {
            new Notice(t("notice.openDrawioFileFirst"));
            return;
          }
          void view.enterPreviewMode();
        },
      });

      registerDemoCommand(this);
    } catch (error) {
      console.error("[obsidian-drawio] onload failed:", error);
    }
  }

  onunload(): void {
    for (const btn of this.newDiagramButtons) btn.remove();
    this.newDiagramButtons = [];
    this.externalWatcher?.dispose();
    this.externalWatcher = null;
    this.themeBridge?.dispose();
    // 保持していたエディタ / viewer アセットを解放する (要件 5.4)
    this.assetCache?.dispose();
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

  /** アクティブな leaf が DrawioView ならそれを返す (コマンドのモード切替用)。 */
  private getActiveDrawioView(): DrawioView | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf || leaf.view?.getViewType() !== DRAWIO_VIEW_TYPE) return null;
    const view = leaf.view as DrawioView;
    return view.file ? view : null;
  }

  /** 指定ファイルを drawio 編集ビューで開く。 */
  async openInDrawioView(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: DRAWIO_VIEW_TYPE,
      active: true,
      state: { file: file.path },
    });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 新規の空 drawio ファイルを作成して編集ビューで開く。 */
  private async createNewDiagram(): Promise<void> {
    try {
      const parent = this.app.fileManager.getNewFileParent(
        this.app.workspace.getActiveFile()?.path ?? "",
      );
      const base = parent.path && parent.path !== "/" ? `${parent.path}/` : "";
      let path = `${base}Untitled.drawio`;
      for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) {
        path = `${base}Untitled ${i}.drawio`;
      }
      const file = await this.app.vault.create(path, EMPTY_DRAWIO_XML);
      await this.openInDrawioView(file);
    } catch (error) {
      console.error("[obsidian-drawio] create new diagram failed:", error);
      new Notice(t("notice.createDiagramFailed"));
    }
  }

  /** ファイルエクスプローラの nav ヘッダに「新規ダイアグラム」ボタンを差し込む (冪等)。 */
  private installNewDiagramButtons(): void {
    const leaves = this.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE);
    for (const leaf of leaves) {
      const containerEl = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
      const nav = containerEl?.querySelector<HTMLElement>(".nav-buttons-container");
      if (!nav || nav.querySelector(".drawio-new-diagram-button")) continue;

      const btn = document.createElement("div");
      btn.className = "clickable-icon nav-action-button drawio-new-diagram-button";
      btn.setAttribute("aria-label", t("action.newDiagram"));
      setIcon(btn, "shapes");
      btn.addEventListener("click", () => void this.createNewDiagram());

      // 「新規ノート」ボタン (先頭) の直後に配置する
      nav.insertBefore(btn, nav.children[1] ?? null);
      this.newDiagramButtons.push(btn);
    }
  }
}
