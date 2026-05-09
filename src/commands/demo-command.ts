import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import { createDrawioBridge, type DrawioBridge } from "../lib/drawio-bridge";

export const DEMO_VIEW_TYPE = "drawio-demo";

const SAMPLE_XML =
  '<mxfile host="obsidian-drawio"><diagram id="demo" name="Demo"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /><mxCell id="2" value="Hello drawio" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="160" width="160" height="60" as="geometry" /></mxCell></root></mxGraphModel></diagram></mxfile>';

class DrawioDemoView extends ItemView {
  private bridge: DrawioBridge | null = null;
  private readonly plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return DEMO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Drawio demo";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.style.padding = "0";
    container.style.height = "100%";

    this.bridge = createDrawioBridge(this.plugin.app);
    this.bridge.mount(container, {
      initialXml: SAMPLE_XML,
      callbacks: {
        onSave: (xml) => console.debug("[drawio-demo] save", xml.length),
        onAutosave: (xml) => console.debug("[drawio-demo] autosave", xml.length),
      },
    });
  }

  async onClose(): Promise<void> {
    this.bridge?.dispose();
    this.bridge = null;
  }
}

export function registerDemoCommand(plugin: Plugin): void {
  plugin.registerView(DEMO_VIEW_TYPE, (leaf) => new DrawioDemoView(leaf, plugin));

  plugin.addCommand({
    id: "open-drawio-demo",
    name: "Open drawio demo",
    callback: async () => {
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: DEMO_VIEW_TYPE, active: true });
      plugin.app.workspace.revealLeaf(leaf);
    },
  });
}
