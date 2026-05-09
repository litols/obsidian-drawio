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
  protected readonly plugin: ObsidianDrawioPlugin;
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
    if (this.currentFormat !== "drawio") {
      // .drawio.svg / .drawio.png は task 5.2 で対応
      return;
    }
    try {
      await writeDrawioFile(file, this.app.vault, { kind: "xml", xml }, "drawio", {
        compressed: this.currentCompressed,
      });
      this._isDirty = false;
    } catch (error) {
      console.error("[drawio-view] save failed:", error);
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
      },
    });
    this._lastXml = result.xml;
    this._isDirty = false;
  }

  async onUnloadFile(_file: TFile): Promise<void> {
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
