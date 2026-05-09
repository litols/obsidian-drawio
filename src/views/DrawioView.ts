import { FileView, type TFile, type WorkspaceLeaf } from "obsidian";
import { readDrawioFile, type DrawioFormat } from "../lib/drawio-formats";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";
import type ObsidianDrawioPlugin from "../main";

export const DRAWIO_VIEW_TYPE = "drawio";

export class DrawioView extends FileView {
  protected readonly plugin: ObsidianDrawioPlugin;
  private bridge: DrawioBridge | null = null;
  protected currentFormat: DrawioFormat = "drawio";
  protected currentCompressed = false;

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
    });
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.bridge?.dispose();
    this.bridge = null;
    this.currentFormat = "drawio";
    this.currentCompressed = false;
  }

  async onClose(): Promise<void> {
    this.bridge?.dispose();
    this.bridge = null;
  }
}
