import type { Vault } from "obsidian";
import type { DrawioBridge } from "./drawio-bridge";
import type { DrawioSettings } from "./settings";

export async function loadCustomLibraries(
  vault: Vault,
  paths: string[],
): Promise<ReadonlyArray<{ title: string; entries: unknown[] }>> {
  const result: { title: string; entries: unknown[] }[] = [];
  for (const path of paths) {
    try {
      const content = await vault.adapter.read(path);
      const match = content.match(/<mxlibrary[^>]*>([\s\S]*?)<\/mxlibrary>/);
      if (!match) {
        console.warn(`[library-bridge] not a valid mxlibrary file: ${path}`);
        continue;
      }
      const entries = JSON.parse(match[1]) as unknown[];
      const title =
        path
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? path;
      result.push({ title, entries });
    } catch (error) {
      console.warn(`[library-bridge] failed to load ${path}:`, error);
    }
  }
  return result;
}

export async function applyLibraries(
  bridge: DrawioBridge,
  settings: DrawioSettings,
  vault: Vault,
): Promise<void> {
  const defaults = settings.defaultLibraries.map((title) => ({
    title,
    entries: [] as unknown[],
  }));
  const customs = await loadCustomLibraries(vault, settings.customLibraries);
  bridge.setLibraries([...defaults, ...customs]);
}
