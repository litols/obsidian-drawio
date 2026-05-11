import { FileView, Notice, type EventRef, type TFile, type WorkspaceLeaf } from "obsidian";
import { readDrawioFile, writeDrawioFile, type DrawioFormat } from "../lib/drawio-formats";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";
import { applyLibraries } from "../lib/library-bridge";
import { resolveDrawioLanguage } from "../lib/language-bridge";
import { t } from "../lib/i18n";
import type { ExternalChangeEvent } from "../lib/external-watcher";
import type { DrawioInboundUserPrefChange } from "../lib/drawio-protocol";
import type { DrawioTheme } from "../lib/settings";
import { ExternalChangeBanner } from "./ExternalChangeBanner";
import { DiffModal } from "./DiffModal";
import type ObsidianDrawioPlugin from "../main";
import * as React from "react";

export const DRAWIO_VIEW_TYPE = "drawio";

/**
 * drawio から通知された UI バリアント (kennedy/atlas/min/sketch/dark) を
 * プラグインの DrawioTheme へ正規化する。
 * - dark → "dark"
 * - sketch → 既存 theme が "auto"/"light"/"dark" のときは "auto" のまま、明示テーマ時は変更しない
 *   (drawio v29 では sketch theme は別 UI として light/dark を内部で持つため割愛)
 * - kennedy/atlas/min → 同名の DrawioTheme
 */
function resolveThemeFromUserPref(
  uiVariant: "kennedy" | "atlas" | "min" | "sketch" | "dark" | undefined,
  setTheme: "light" | "dark",
): DrawioTheme | null {
  if (uiVariant === "dark") return "dark";
  if (uiVariant === "kennedy") return "kennedy";
  if (uiVariant === "atlas") return "atlas";
  if (uiVariant === "min") return "min";
  // sketch / undefined: 既知の保存表現がないので setTheme のみ反映
  if (uiVariant == null) return setTheme === "dark" ? "dark" : "light";
  return null;
}

export class DrawioDirtyReloadError extends Error {
  constructor(message = "DrawioView is dirty; reload requires { force: true }") {
    super(message);
    this.name = "DrawioDirtyReloadError";
  }
}

export class DrawioView extends FileView {
  public readonly plugin: ObsidianDrawioPlugin;
  private bridge: DrawioBridge | null = null;
  protected currentFormat: DrawioFormat = "drawio";
  protected currentCompressed = false;
  private _isDirty = false;
  private _lastXml: string | null = null;
  private externalChangeRef: EventRef | null = null;
  private bannerContainer: HTMLElement | null = null;
  private bannerDispose: (() => void) | null = null;
  // drawio 内操作によるグローバル設定書き込みのデバウンス用タイマ。
  // 「More Shapes ダイアログ Apply」「View > Grid トグル」を連続で行ったときの
  // saveData 連打を抑える。
  private prefSaveTimerId: ReturnType<typeof setTimeout> | null = null;
  private prefSaveDirty = false;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianDrawioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return DRAWIO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? t("view.drawio.displayText");
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  getCurrentXml(): string | null {
    return this._lastXml;
  }

  async reload(file: TFile, options?: { force?: boolean }): Promise<void> {
    if (this._isDirty && !options?.force) {
      throw new DrawioDirtyReloadError();
    }
    const result = await readDrawioFile(file, this.app.vault);
    this.currentFormat = result.format;
    this.currentCompressed = result.compressed;
    this._lastXml = result.xml;
    this._isDirty = false;

    if (this.bridge?.isMounted) {
      this.bridge.load(result.xml);
    }
  }

  private async handleSave(file: TFile, xml: string): Promise<void> {
    if (this.currentFormat === "drawio") {
      try {
        await writeDrawioFile(file, this.app.vault, { kind: "xml", xml }, "drawio", {
          compressed: this.currentCompressed,
        });
        this._isDirty = false;
        this.plugin.externalWatcher?.registerSelfWrite(file.path);
      } catch (error) {
        console.error("[drawio-view] save failed:", error);
        new Notice(t("notice.saveFailedWithName", { name: file.name }));
      }
      return;
    }

    if (this.currentFormat === "drawio-svg") {
      this.bridge?.requestExport("xmlsvg");
    } else if (this.currentFormat === "drawio-png") {
      this.bridge?.requestExport("xmlpng");
    }
  }

  private async handleExportResult(file: TFile, data: string, format: string): Promise<void> {
    try {
      if (format === "xmlsvg" && this.currentFormat === "drawio-svg") {
        let svg: string;
        if (data.startsWith("data:")) {
          const base64 = data.slice(data.indexOf(",") + 1);
          svg = atob(base64);
        } else {
          svg = data;
        }
        await writeDrawioFile(
          file,
          this.app.vault,
          { kind: "svg", exportedSvg: svg },
          "drawio-svg",
        );
        this._isDirty = false;
        this.plugin.externalWatcher?.registerSelfWrite(file.path);
      } else if (format === "xmlpng" && this.currentFormat === "drawio-png") {
        const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await writeDrawioFile(
          file,
          this.app.vault,
          { kind: "png", exportedPng: bytes.buffer as ArrayBuffer },
          "drawio-png",
        );
        this._isDirty = false;
        this.plugin.externalWatcher?.registerSelfWrite(file.path);
      } else {
        console.warn(
          `[drawio-view] unexpected export format=${format} for currentFormat=${this.currentFormat}`,
        );
      }
    } catch (error) {
      console.error("[drawio-view] export save failed:", error);
      new Notice(t("notice.saveFailedWithName", { name: file.name }));
    }
  }

  /**
   * drawio エディタ内のユーザー操作 (More Shapes / View > Grid / View > Theme) を
   * グローバル設定 (plugin.settings.drawio) に反映する。
   * 保存自体は schedulePrefSave() で 400ms デバウンスして実行。
   */
  private handleUserPrefChange(msg: DrawioInboundUserPrefChange): void {
    const drawio = this.plugin.settings.drawio;
    if (!drawio) return;

    if (msg.pref === "libraries") {
      // drawio 内で操作できる内蔵ライブラリ集合のみ書き換える。
      // customLibraries (Vault パス) は drawio 内 UI から追加できない領域なので保持。
      drawio.defaultLibraries = [...msg.value.defaults];
      this.schedulePrefSave();
      return;
    }

    if (msg.pref === "theme") {
      const next = resolveThemeFromUserPref(msg.value.uiVariant, msg.value.setTheme);
      if (next != null && drawio.theme !== next) {
        drawio.theme = next;
        this.schedulePrefSave();
      }
      return;
    }

    if (msg.pref === "grid") {
      if (drawio.grid !== msg.value) {
        drawio.grid = msg.value;
        this.schedulePrefSave();
      }
      return;
    }
  }

  private schedulePrefSave(): void {
    this.prefSaveDirty = true;
    if (this.prefSaveTimerId !== null) {
      clearTimeout(this.prefSaveTimerId);
    }
    this.prefSaveTimerId = setTimeout(() => {
      this.prefSaveTimerId = null;
      if (!this.prefSaveDirty) return;
      this.prefSaveDirty = false;
      void this.plugin.saveSettings();
    }, 400);
  }

  async onLoadFile(file: TFile): Promise<void> {
    const result = await readDrawioFile(file, this.app.vault);
    this.currentFormat = result.format;
    this.currentCompressed = result.compressed;

    const container = this.contentEl;
    container.empty();
    container.style.padding = "0";
    container.style.height = "100%";

    this.bridge = createDrawioBridge(this.app, this.plugin.manifest.dir);
    this.bridge.mount(container, {
      initialXml: result.xml,
      lang: resolveDrawioLanguage(this.plugin.settings.drawio?.language ?? "auto"),
      // 保存はすべて autosave に集約: 手動 Save / Exit / 統合 Save&Exit を UI から外す。
      noSaveBtn: true,
      noExitBtn: true,
      saveAndExit: false,
      autosave: true,
      // drawio.com の従来 UI (Kennedy) を強制。Atlas (default) ではサイドバーが出ない。
      ui: "kennedy",
      callbacks: {
        onAutosave: (xml) => {
          this._lastXml = xml;
          this._isDirty = true;
          void this.handleSave(file, xml);
        },
        onSave: (xml) => {
          this._lastXml = xml;
          this._isDirty = true;
          void this.handleSave(file, xml);
        },
        onExport: (data, format) => {
          void this.handleExportResult(file, data, format);
        },
        onUserPrefChange: (msg) => this.handleUserPrefChange(msg),
      },
    });
    this._lastXml = result.xml;
    this._isDirty = false;

    if (this.bridge && this.plugin.themeBridge) {
      this.plugin.themeBridge.registerBridge(this.bridge);
      this.plugin.themeBridge.applyTheme(this.bridge);
    }
    if (this.bridge && this.plugin.settings.drawio) {
      void applyLibraries(this.bridge, this.plugin.settings.drawio, this.app.vault);
    }

    // 重複購読を防ぐため既存 ref を先に解除
    if (this.externalChangeRef) {
      this.plugin.events.offref(this.externalChangeRef);
      this.externalChangeRef = null;
    }
    this.externalChangeRef = this.plugin.events.on(
      "drawio:external-change",
      (ev: unknown) => void this.onExternalChange(ev as ExternalChangeEvent),
    );
  }

  private mountBanner(ev: ExternalChangeEvent): void {
    if (!this.bannerContainer) {
      this.bannerContainer = this.contentEl.createDiv("drawio-banner-host");
      this.contentEl.insertBefore(this.bannerContainer, this.contentEl.firstChild);
    }
    this.bannerDispose?.();
    this.bannerDispose = this.plugin.reactMountManager.mount(
      this.bannerContainer,
      React.createElement(ExternalChangeBanner, {
        sourceHint: ev.sourceHint,
        onReload: () => void this.handleBannerReload(),
        onDiff: () => void this.handleBannerDiff(),
        onKeepMine: () => void this.handleBannerKeepMine(),
      }),
    );
  }

  private unmountBanner(): void {
    this.bannerDispose?.();
    this.bannerDispose = null;
    this.bannerContainer?.remove();
    this.bannerContainer = null;
  }

  private async handleBannerReload(): Promise<void> {
    if (!this.file) return;
    try {
      await this.reload(this.file, { force: true });
      this.unmountBanner();
    } catch (err) {
      console.error("[drawio] banner reload failed:", err);
      new Notice(t("notice.reloadFailed"));
    }
  }

  private async handleBannerDiff(): Promise<void> {
    if (!this.file) return;
    const current = this.getCurrentXml() ?? "";
    const latestResult = await readDrawioFile(this.file, this.app.vault);
    const latest = latestResult.xml;
    new DiffModal(
      this.app,
      this.plugin,
      current,
      latest,
      () => void this.handleBannerReload(),
      () => void this.handleBannerKeepMine(),
    ).open();
  }

  private async handleBannerKeepMine(): Promise<void> {
    if (!this.file) return;
    const xml = this.getCurrentXml();
    if (xml == null) return;
    if (!confirm(t("confirm.keepMine"))) return;
    try {
      await this.handleSave(this.file, xml);
      this.unmountBanner();
    } catch (err) {
      console.error("[drawio] banner keep-mine save failed:", err);
      new Notice(t("notice.saveFailed"));
    }
  }

  private async onExternalChange(ev: ExternalChangeEvent): Promise<void> {
    if (ev.type === "rename" && ev.oldPath === this.file?.path) {
      this.file = ev.file;
      return;
    }

    if (!this.file || ev.file.path !== this.file.path) return;

    if (ev.type === "delete") {
      new Notice(t("notice.diagramDeleted"));
      this.leaf.detach();
      return;
    }

    if (ev.type === "modify") {
      const settings = this.plugin.settings.drawio?.externalSync;
      if (!settings) return;

      if (!this.isDirty && settings.autoReloadWhenClean) {
        try {
          await this.reload(this.file);
        } catch (err) {
          if (err instanceof DrawioDirtyReloadError) {
            // race で dirty になった: banner にフォールバック
            console.warn(
              "[drawio] reload failed (became dirty during race); falling back to banner",
            );
            this.mountBanner(ev);
          } else {
            console.error("[drawio] reload failed:", err);
            new Notice(t("notice.loadFailed"));
          }
        }
      } else if (this.isDirty) {
        this.mountBanner(ev);
      } else {
        // autoReloadWhenClean === false: banner 表示
        this.mountBanner(ev);
      }
    }
  }

  private flushPrefSave(): void {
    if (this.prefSaveTimerId !== null) {
      clearTimeout(this.prefSaveTimerId);
      this.prefSaveTimerId = null;
    }
    if (this.prefSaveDirty) {
      this.prefSaveDirty = false;
      void this.plugin.saveSettings();
    }
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.externalChangeRef) {
      this.plugin.events.offref(this.externalChangeRef);
      this.externalChangeRef = null;
    }
    this.unmountBanner();
    if (this.bridge && this.plugin.themeBridge) {
      this.plugin.themeBridge.unregisterBridge(this.bridge);
    }
    this.flushPrefSave();
    this.bridge?.dispose();
    this.bridge = null;
    this.currentFormat = "drawio";
    this.currentCompressed = false;
    this._isDirty = false;
    this._lastXml = null;
  }

  async onClose(): Promise<void> {
    if (this.externalChangeRef) {
      this.plugin.events.offref(this.externalChangeRef);
      this.externalChangeRef = null;
    }
    this.unmountBanner();
    this.flushPrefSave();
    this.bridge?.dispose();
    this.bridge = null;
    this._isDirty = false;
    this._lastXml = null;
  }
}
