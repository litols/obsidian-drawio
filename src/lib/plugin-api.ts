import type { EventRef, TFile } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import type { ExternalChangeEvent } from "./external-watcher";
import { readDrawioFile, writeDrawioFile } from "./drawio-formats";
import { DRAWIO_VIEW_TYPE } from "../views/DrawioView";
import type { DrawioView } from "../views/DrawioView";

export interface DrawioPublicApi {
  readonly version: 1;
  getDiagramXml(file: TFile): Promise<string>;
  setDiagramXml(file: TFile, xml: string, opts?: { reason?: string }): Promise<void>;
  requestReload(file: TFile): Promise<void>;
  subscribe(listener: (e: ExternalChangeEvent) => void): () => void;
}

export function createDrawioPluginApi(plugin: ObsidianDrawioPlugin): {
  api: DrawioPublicApi;
  dispose: () => void;
} {
  let dead = false;

  function ensureAlive(): void {
    if (dead) throw new Error("[drawio] plugin api is unloaded");
  }

  const api: DrawioPublicApi = {
    version: 1,

    async getDiagramXml(file: TFile): Promise<string> {
      ensureAlive();
      const r = await readDrawioFile(file, plugin.app.vault);
      return r.xml;
    },

    async setDiagramXml(file: TFile, xml: string, opts?: { reason?: string }): Promise<void> {
      ensureAlive();
      const ext = file.path.toLowerCase();
      if (ext.endsWith(".drawio.svg") || ext.endsWith(".drawio.png")) {
        throw new Error(
          "[drawio] setDiagramXml on .drawio.svg/.png requires drawio export pipeline; not supported via API",
        );
      }
      await writeDrawioFile(file, plugin.app.vault, { kind: "xml", xml }, "drawio", {
        compressed: false,
      });
      const ev: ExternalChangeEvent = {
        file,
        type: "modify",
        mtime: Date.now(),
        sourceHint: opts?.reason,
      };
      plugin.events.trigger("drawio:external-change", ev);
    },

    async requestReload(file: TFile): Promise<void> {
      ensureAlive();
      const leaves = plugin.app.workspace.getLeavesOfType(DRAWIO_VIEW_TYPE);
      for (const leaf of leaves) {
        const view = leaf.view as DrawioView;
        if (view.file?.path === file.path) {
          await view.reload(file, { force: true });
          return;
        }
      }
    },

    subscribe(listener: (e: ExternalChangeEvent) => void): () => void {
      if (dead) return () => {};
      const ref: EventRef = plugin.events.on(
        "drawio:external-change",
        listener as (...data: unknown[]) => unknown,
      );
      return () => plugin.events.offref(ref);
    },
  };

  return {
    api,
    dispose: () => {
      dead = true;
    },
  };
}
