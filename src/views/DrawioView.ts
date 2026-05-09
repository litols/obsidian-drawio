import { FileView, Notice, type TFile, type WorkspaceLeaf } from "obsidian";
import { readDrawioFile, writeDrawioFile, type DrawioFormat } from "../lib/drawio-formats";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";
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
  }

  async onUnloadFile(_file: TFile): Promise<void> {
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
    this.bridge?.dispose();
    this.bridge = null;
    this._isDirty = false;
    this._lastXml = null;
  }
}
