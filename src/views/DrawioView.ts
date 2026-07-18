import {
  FileView,
  Notice,
  setIcon,
  type EventRef,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import {
  readDrawioFile,
  writeDrawioFile,
  type DrawioFormat,
  type ReadDrawioResult,
} from "../lib/drawio-formats";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";
import { createPreviewBridge, type PreviewBridge } from "../lib/preview-bridge";
import { selectPreviewStrategy } from "../lib/preview-mode";
import { buildDrawioConfig } from "../lib/library-bridge";
import { resolveDrawioLanguage } from "../lib/language-bridge";
import { t } from "../lib/i18n";
import type { ExternalChangeEvent } from "../lib/external-watcher";
import type { DrawioInboundUserPrefChange } from "../lib/drawio-protocol";
import type { DrawioOpenMode, DrawioTheme } from "../lib/settings";
import { ExternalChangeBanner } from "./ExternalChangeBanner";
import { ImagePreview } from "./preview/ImagePreview";
import { PreviewErrorPanel } from "./preview/PreviewErrorPanel";
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
  // 表示モード状態機械。preview / editor は排他的にマウントされる。
  private mode: DrawioOpenMode = "preview";
  private previewBridge: PreviewBridge | null = null;
  // ImagePreview / PreviewErrorPanel の React root dispose。
  private previewReactDispose: (() => void) | null = null;
  // ビューヘッダのモード切替アクション (pencil / eye) 要素。
  private modeActionEl: HTMLElement | null = null;
  // in-flight のモード遷移中は追加の遷移を無視する (二重マウント禁止)。
  private transitioning = false;
  // setViewState の state.mode で渡された初期モード上書き (編集導線用)。
  // 次の onLoadFile で 1 度だけ消費される。未指定時は defaultOpenMode に従う。
  private pendingModeOverride: DrawioOpenMode | null = null;
  // 進行中の保存 (handleSave / export roundtrip) を追跡する Promise チェーン (要件 3.3, 3.4)。
  private pendingSaves: Promise<unknown> = Promise.resolve();
  // svg/png の export roundtrip 完了を待つためのバリア resolver。
  private exportBarrierResolve: (() => void) | null = null;
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

    // svg/png は export roundtrip: requestExport → onExport → handleExportResult で書込。
    // roundtrip 全体を pendingSaves に含めるため、書込完了まで解決しないバリアを await する。
    if (!this.bridge?.isMounted) return;
    const done = this.createExportBarrier();
    if (this.currentFormat === "drawio-svg") {
      this.bridge.requestExport("xmlsvg");
    } else if (this.currentFormat === "drawio-png") {
      this.bridge.requestExport("xmlpng");
    } else {
      this.resolveExportBarrier();
    }
    await done;
  }

  /** 新しい export バリアを作成する。前のバリアが未解決なら先に解決してリークを防ぐ。 */
  private createExportBarrier(): Promise<void> {
    this.resolveExportBarrier();
    return new Promise<void>((resolve) => {
      this.exportBarrierResolve = resolve;
    });
  }

  private resolveExportBarrier(): void {
    if (this.exportBarrierResolve) {
      const resolve = this.exportBarrierResolve;
      this.exportBarrierResolve = null;
      resolve();
    }
  }

  /** 進行中の保存を pendingSaves チェーンに追跡する (rejection でチェーンを壊さない)。 */
  private trackSave(p: Promise<void>): void {
    this.pendingSaves = Promise.allSettled([this.pendingSaves, p]);
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
    } finally {
      // roundtrip 完了を pendingSaves の待ち手へ通知する (成功・失敗いずれも解決)
      this.resolveExportBarrier();
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
      // baseline (general/basic 等) は buildDrawioConfig で常に union されるため、
      // 設定側にも重複保存すると設定 UI がノイジーになる → 保存時に除外する。
      const baseline = new Set<string>(drawio.baselineLibraries);
      drawio.defaultLibraries = msg.value.defaults.filter((id) => !baseline.has(id));
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

  /**
   * setViewState の state.mode を初期モード上書きとして捕捉する。
   * 「draw.io で編集」メニューや「新規ダイアグラム」など編集意図の導線から
   * `{ mode: "editor" }` を渡すとプレビューを経ずエディタで開く (要件 4.3 の導線整合)。
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state != null && typeof state === "object") {
      const mode = (state as { mode?: unknown }).mode;
      if (mode === "preview" || mode === "editor") {
        this.pendingModeOverride = mode;
      }
    }
    await super.setState(state, result);
  }

  async onLoadFile(file: TFile): Promise<void> {
    const result = await readDrawioFile(file, this.app.vault);
    this.currentFormat = result.format;
    this.currentCompressed = result.compressed;
    this._lastXml = result.xml;
    this._isDirty = false;

    const container = this.contentEl;
    container.empty();
    this.ensureFullContentArea();

    this.ensureModeAction();

    // 初期モード: state.mode 上書き (編集導線) を優先し、無ければ既定表示モード設定
    // に従う (要件 1.1, 1.4)。上書きは 1 度だけ消費する。
    this.mode =
      this.pendingModeOverride ?? this.plugin.settings.drawio?.defaultOpenMode ?? "preview";
    this.pendingModeOverride = null;
    if (this.mode === "editor") {
      await this.mountEditor(file, result.xml);
    } else {
      await this.mountPreview(file, result);
    }
    this.updateModeAction();

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

  /** フルエディタ (drawio-bridge) をマウントする。アセットは plugin.assetCache を注入。 */
  private async mountEditor(file: TFile, xml: string): Promise<void> {
    const container = this.contentEl;
    this.ensureFullContentArea();

    // drawio 起動時 configure protocol に渡す payload を先に組み立てる。
    // ここに詰めた設定 (defaultLibraries など) が Sidebar.defaultEntries に反映される。
    const drawioConfig = this.plugin.settings.drawio
      ? await buildDrawioConfig(this.plugin.settings.drawio, this.app.vault)
      : undefined;

    this.bridge = createDrawioBridge(this.app, this.plugin.manifest.dir, this.plugin.assetCache);
    this.bridge.mount(container, {
      initialXml: xml,
      lang: resolveDrawioLanguage(this.plugin.settings.drawio?.language ?? "auto"),
      // 保存はすべて autosave に集約: 手動 Save / Exit / 統合 Save&Exit を UI から外す。
      noSaveBtn: true,
      noExitBtn: true,
      saveAndExit: false,
      autosave: true,
      // drawio.com の従来 UI (Kennedy) を強制。Atlas (default) ではサイドバーが出ない。
      ui: "kennedy",
      drawioConfig,
      callbacks: {
        onAutosave: (autoXml) => {
          this._lastXml = autoXml;
          this._isDirty = true;
          this.trackSave(this.handleSave(file, autoXml));
        },
        onSave: (savedXml) => {
          this._lastXml = savedXml;
          this._isDirty = true;
          this.trackSave(this.handleSave(file, savedXml));
        },
        onExport: (data, format) => {
          void this.handleExportResult(file, data, format);
        },
        onUserPrefChange: (msg) => this.handleUserPrefChange(msg),
      },
    });
    this._lastXml = xml;

    if (this.bridge && this.plugin.themeBridge) {
      this.plugin.themeBridge.registerBridge(this.bridge);
      this.plugin.themeBridge.applyTheme(this.bridge);
    }
  }

  /**
   * プレビュー/エディタ領域をビューのコンテンツ領域全体に広げる (要件 2.6)。
   * padding を除去し幅・高さ 100% を占有させる。ビューのリサイズには子 (iframe / React)
   * の 100% 指定で追従する。
   */
  private ensureFullContentArea(): void {
    const container = this.contentEl;
    container.style.padding = "0";
    container.style.width = "100%";
    container.style.height = "100%";
  }

  /** 戦略選択に従い画像プレビュー or GraphViewer プレビューを排他マウントする (要件 1.2, 1.3)。 */
  private async mountPreview(file: TFile, result: ReadDrawioResult): Promise<void> {
    const container = this.contentEl;
    this.ensureFullContentArea();
    const strategy = selectPreviewStrategy(result.format, result.xml);
    const background = this.plugin.settings.drawio?.previewBackground ?? "#ffffff";

    if (strategy === "image") {
      // svg/png の内包画像を vault リソース URL 直接指定で表示 (read 不要)。
      const src = this.app.vault.getResourcePath(file);
      this.previewReactDispose = this.plugin.reactMountManager.mount(
        container,
        React.createElement(ImagePreview, {
          src,
          onRequestEdit: () => void this.enterEditor(),
          onError: () => this.showPreviewError(),
          background,
        }),
      );
      return;
    }

    // XML / 複数ページは GraphViewer で描画。失敗時はエラーパネルへフォールバック。
    // 背景色は render config で渡し、preview-init が iframe body / host に適用する。
    this.previewBridge = createPreviewBridge(
      this.plugin.assetCache,
      this.app.vault.adapter,
      this.plugin.manifest.dir,
    );
    this.previewBridge.mount(container, {
      xml: result.xml,
      config: { background },
      callbacks: {
        onError: (reason) => this.showPreviewError(reason),
      },
    });
  }

  /** プレビュー描画失敗時にエラーパネル (「エディタで開く」導線付き) を表示する (要件 1.5)。 */
  private showPreviewError(reason?: string): void {
    if (reason) console.warn("[drawio-preview] preview render failed:", reason);
    this.disposePreviewResources();
    const container = this.contentEl;
    container.empty();
    this.ensureFullContentArea();
    this.previewReactDispose = this.plugin.reactMountManager.mount(
      container,
      React.createElement(PreviewErrorPanel, {
        message: t("preview.error.render"),
        onOpenEditor: () => void this.enterEditor(),
      }),
    );
  }

  private disposePreviewResources(): void {
    this.previewReactDispose?.();
    this.previewReactDispose = null;
    this.previewBridge?.dispose();
    this.previewBridge = null;
  }

  private disposeEditorResources(): void {
    if (this.bridge && this.plugin.themeBridge) {
      this.plugin.themeBridge.unregisterBridge(this.bridge);
    }
    this.unmountBanner();
    this.bridge?.dispose();
    this.bridge = null;
  }

  /** ビューヘッダにモード切替アクションを 1 度だけ追加する。 */
  private ensureModeAction(): void {
    if (this.modeActionEl) return;
    this.modeActionEl = this.addAction("pencil", t("command.enterEditor"), () => this.toggleMode());
  }

  /** 現在モードに応じてアクションのアイコン / ラベルを更新する。 */
  private updateModeAction(): void {
    if (!this.modeActionEl) return;
    const toEditor = this.mode === "preview";
    setIcon(this.modeActionEl, toEditor ? "pencil" : "eye");
    this.modeActionEl.setAttribute(
      "aria-label",
      toEditor ? t("command.enterEditor") : t("command.enterPreview"),
    );
  }

  private toggleMode(): void {
    if (this.mode === "preview") void this.enterEditor();
    else void this.enterPreview();
  }

  /** プレビュー → エディタ遷移。旧モード資源を dispose してから排他マウント (要件 3.1)。 */
  private async enterEditor(): Promise<void> {
    if (this.mode === "editor" || this.transitioning || !this.file) return;
    this.transitioning = true;
    try {
      this.disposePreviewResources();
      this.contentEl.empty();
      this.mode = "editor";
      await this.mountEditor(this.file, this._lastXml ?? "");
      this.updateModeAction();
    } finally {
      this.transitioning = false;
    }
  }

  /** エディタ → プレビュー遷移。進行中の保存完了を待ってから最新内容で再描画 (要件 3.3, 3.4)。 */
  private async enterPreview(): Promise<void> {
    if (this.mode === "preview" || this.transitioning || !this.file) return;
    this.transitioning = true;
    try {
      // 進行中の保存 (export roundtrip 含む) の完了を待つ
      await this.pendingSaves;
      this.disposeEditorResources();
      this.contentEl.empty();
      // 保存済みの最新内容でプレビューを再描画する
      const result = await readDrawioFile(this.file, this.app.vault);
      this.currentFormat = result.format;
      this.currentCompressed = result.compressed;
      this._lastXml = result.xml;
      this._isDirty = false;
      this.mode = "preview";
      await this.mountPreview(this.file, result);
      this.updateModeAction();
    } finally {
      this.transitioning = false;
    }
  }

  /** コマンドパレット / 外部からのエディタモード遷移。 */
  async enterEditorMode(): Promise<void> {
    await this.enterEditor();
  }

  /** コマンドパレット / 外部からのプレビューモード遷移。 */
  async enterPreviewMode(): Promise<void> {
    await this.enterPreview();
  }

  get currentMode(): DrawioOpenMode {
    return this.mode;
  }

  /** プレビュー中に最新のディスク内容で再描画する (外部変更追従用)。 */
  private async remountPreview(): Promise<void> {
    if (!this.file || this.mode !== "preview") return;
    const result = await readDrawioFile(this.file, this.app.vault);
    this.currentFormat = result.format;
    this.currentCompressed = result.compressed;
    this._lastXml = result.xml;
    this._isDirty = false;
    this.disposePreviewResources();
    this.contentEl.empty();
    await this.mountPreview(this.file, result);
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
      // 新しいファイルパスを追跡して表示を継続する (要件 4.2)。
      this.file = ev.file;
      // プレビュー中はリソース URL がパスに依存するため再描画する。
      if (this.mode === "preview") await this.remountPreview();
      return;
    }

    if (!this.file || ev.file.path !== this.file.path) return;

    if (ev.type === "delete") {
      new Notice(t("notice.diagramDeleted"));
      this.leaf.detach();
      return;
    }

    // プレビュー中は dirty 概念がないため無条件で最新内容へ再描画する (要件 4.1)。
    if (ev.type === "modify" && this.mode === "preview") {
      await this.remountPreview();
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
    this.disposePreviewResources();
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
    this.disposePreviewResources();
    this.bridge?.dispose();
    this.bridge = null;
    this._isDirty = false;
    this._lastXml = null;
  }
}
