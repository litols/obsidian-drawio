import type { Vault } from "obsidian";
import type { DrawioSettings } from "./settings";

/**
 * Vault 上の .mxlibrary XML を読んで {title, entries} 形式に変換する。
 * drawio embed 側で customEntries として食わせる形。
 */
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

/**
 * plugin.settings から drawio embed の configure payload を組み立てる。
 *   - defaultLibraries: 内蔵ライブラリ選択 (semicolon-joined ID 列)。
 *     drawio 側で Sidebar.prototype.defaultEntries にセットされる。
 *   - libraries: Vault XML から読んだカスタムパレット一覧。
 *     drawio 側で Sidebar.prototype.customEntries にセットされる。
 */
export async function buildDrawioConfig(
  settings: DrawioSettings,
  vault: Vault,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {};
  const baseline = settings.baselineLibraries.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  const userDefaults = settings.defaultLibraries.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  // baseline を常に含める。user が More Shapes で追加したカテゴリ (aws4 等) は
  // baseline 後に追記する形で order も安定させる。
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...baseline, ...userDefaults]) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  config.defaultLibraries = merged.join(";");
  const customs = await loadCustomLibraries(vault, settings.customLibraries);
  if (customs.length > 0) {
    config.libraries = customs;
  }
  return config;
}
