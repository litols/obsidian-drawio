import { FileView, Notice, type EventRef, type TFile, type WorkspaceLeaf } from "obsidian";
import { readDrawioFile, writeDrawioFile, type DrawioFormat } from "../lib/drawio-formats";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";
import { applyLibraries } from "../lib/library-bridge";
import { resolveDrawioLanguage } from "../lib/language-bridge";
import type { ExternalChangeEvent } from "../lib/external-watcher";
import type ObsidianDrawioPlugin from "../main";

export const DRAWIO_VIEW_TYPE = "drawio";

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

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianDrawioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return DRAWIO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? "Drawio";
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
        new Notice(`drawio: failed to save ${file.name}`);
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
      new Notice(`drawio: failed to save ${file.name}`);
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    const result = await readDrawioFile(file, this.app.vault);
    this.currentFormat = result.format;
    this.currentCompressed = result.compressed;

    const container = this.contentEl;
    container.empty();
    container.style.padding = "0";
    container.style.height = "100%";

    this.bridge = createDrawioBridge(this.app);
    this.bridge.mount(container, {
      initialXml: result.xml,
      lang: resolveDrawioLanguage(this.plugin.settings.drawio?.language ?? "auto"),
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

  private async onExternalChange(ev: ExternalChangeEvent): Promise<void> {
    if (ev.type === "rename" && ev.oldPath === this.file?.path) {
      this.file = ev.file;
      return;
    }

    if (!this.file || ev.file.path !== this.file.path) return;

    if (ev.type === "delete") {
      new Notice("ダイアグラムが削除されました");
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
            // race で dirty になった: banner mount は task 4.2 で実装
            console.warn(
              "[drawio] reload failed (became dirty during race); falling back to banner",
            );
          } else {
            console.error("[drawio] reload failed:", err);
            new Notice("ダイアグラムの読み込みに失敗しました");
          }
        }
      } else if (this.isDirty) {
        // dirty: banner は task 4.2 で実装
        console.debug("[drawio] external change while dirty; banner not yet implemented");
      }
    }
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.externalChangeRef) {
      this.plugin.events.offref(this.externalChangeRef);
      this.externalChangeRef = null;
    }
    if (this.bridge && this.plugin.themeBridge) {
      this.plugin.themeBridge.unregisterBridge(this.bridge);
    }
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
    this.bridge?.dispose();
    this.bridge = null;
    this._isDirty = false;
    this._lastXml = null;
  }
}
