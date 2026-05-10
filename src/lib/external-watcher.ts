import { Events, Notice, type EventRef, type Plugin, type TFile, type Vault } from "obsidian";
import type { ExternalSyncSettings } from "./settings";

export interface ExternalChangeEvent {
  file: TFile;
  oldPath?: string;
  type: "modify" | "rename" | "delete";
  mtime: number;
  sourceHint?: string;
}

export interface ExternalWatcher {
  registerSelfWrite(path: string, mtime?: number): void;
  dispose(): void;
}

const DRAWIO_EXT = [".drawio", ".drawio.svg", ".drawio.png"];

export function isDrawioFile(path: string): boolean {
  const lower = path.toLowerCase();
  return DRAWIO_EXT.some((ext) => lower.endsWith(ext));
}

export function isSelfWriteSuppressed(
  recentTs: number | undefined,
  now: number,
  echoSuppressionMs: number,
): boolean {
  return recentTs !== undefined && now - recentTs < echoSuppressionMs;
}

export function createExternalWatcher(
  plugin: Plugin & { events: Events },
  vault: Vault,
  getSettings: () => ExternalSyncSettings,
): ExternalWatcher {
  const recentSelfWrites = new Map<string, number>();
  const pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  const statusBarItem = plugin.addStatusBarItem();
  let disposed = false;

  const refs: EventRef[] = [];

  function emit(ev: ExternalChangeEvent): void {
    if (disposed) return;
    plugin.events.trigger("drawio:external-change", ev);

    const settings = getSettings();
    if (!settings.notifyOnExternalChange) return;

    const message = ev.sourceHint
      ? `Diagram updated by ${ev.sourceHint}`
      : "Diagram updated externally";

    const level = settings.notificationLevel;
    if (level === "statusbar" || level === "notice" || level === "banner") {
      statusBarItem.setText(message);
    }
    if (level === "notice" || level === "banner") {
      new Notice(message);
    }
  }

  function debouncedEmit(ev: ExternalChangeEvent): void {
    const settings = getSettings();
    const path = ev.file.path;
    const existing = pendingDebounce.get(path);
    if (existing !== undefined) clearTimeout(existing);
    const handle = setTimeout(() => {
      pendingDebounce.delete(path);
      emit(ev);
    }, settings.dedupDebounceMs);
    pendingDebounce.set(path, handle);
  }

  const refModify = vault.on("modify", (file) => {
    if (!("path" in file)) return;
    const f = file as TFile;
    if (!isDrawioFile(f.path)) return;
    const settings = getSettings();
    const recent = recentSelfWrites.get(f.path);
    if (recent !== undefined && Date.now() - recent < settings.echoSuppressionMs) return;
    debouncedEmit({ file: f, type: "modify", mtime: f.stat?.mtime ?? Date.now() });
  });
  refs.push(refModify);

  const refRename = vault.on("rename", (file, oldPath) => {
    if (!("path" in file)) return;
    const f = file as TFile;
    if (!isDrawioFile(oldPath) && !isDrawioFile(f.path)) return;
    emit({ file: f, oldPath, type: "rename", mtime: f.stat?.mtime ?? Date.now() });
  });
  refs.push(refRename);

  const refDelete = vault.on("delete", (file) => {
    if (!("path" in file)) return;
    const f = file as TFile;
    if (!isDrawioFile(f.path)) return;
    emit({ file: f, type: "delete", mtime: 0 });
  });
  refs.push(refDelete);

  return {
    registerSelfWrite(path: string, mtime?: number): void {
      const ts = mtime ?? Date.now();
      recentSelfWrites.set(path, ts);
      const settings = getSettings();
      setTimeout(() => recentSelfWrites.delete(path), settings.echoSuppressionMs + 100);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const handle of pendingDebounce.values()) clearTimeout(handle);
      pendingDebounce.clear();
      recentSelfWrites.clear();
      for (const ref of refs) vault.offref(ref);
      refs.length = 0;
      statusBarItem.remove();
    },
  };
}
