import type { Plugin, Vault } from "obsidian";
import { Notice, TFile } from "obsidian";
import type { DrawioTheme } from "./settings";
import { t } from "./i18n";

export interface PerDiagramConfig {
  libraries?: string[];
  theme?: DrawioTheme;
  math?: boolean;
  grid?: boolean;
}

export function sidecarPath(filePath: string): string {
  return `${filePath}.json`;
}

export async function loadPerDiagramConfig(
  vault: Vault,
  filePath: string,
): Promise<PerDiagramConfig> {
  const path = sidecarPath(filePath);
  try {
    if (!(await vault.adapter.exists(path))) return {};
    const raw = await vault.adapter.read(path);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") return {};
    return parsed as PerDiagramConfig;
  } catch (error) {
    console.warn("[per-diagram-config] load failed:", error);
    return {};
  }
}

function isEmptyConfig(config: PerDiagramConfig): boolean {
  return Object.keys(config).length === 0;
}

export async function savePerDiagramConfig(
  vault: Vault,
  filePath: string,
  config: PerDiagramConfig,
): Promise<void> {
  const path = sidecarPath(filePath);
  if (isEmptyConfig(config)) {
    if (await vault.adapter.exists(path)) {
      await vault.adapter.remove(path);
    }
    return;
  }
  await vault.adapter.write(path, JSON.stringify(config, null, 2));
}

const DRAWIO_EXTENSIONS = [".drawio", ".drawio.svg", ".drawio.png"];

export function registerPerDiagramConfigLifecycle(plugin: Plugin): void {
  const vault = plugin.app.vault;

  plugin.registerEvent(
    vault.on("rename", async (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      const oldLower = oldPath.toLowerCase();
      if (!DRAWIO_EXTENSIONS.some((ext) => oldLower.endsWith(ext))) return;
      const oldSidecar = sidecarPath(oldPath);
      const newSidecar = sidecarPath(file.path);
      try {
        if (await vault.adapter.exists(oldSidecar)) {
          await vault.adapter.rename(oldSidecar, newSidecar);
        }
      } catch (error) {
        console.error("[per-diagram-config] sidecar rename failed:", error);
        new Notice(t("notice.sidecarRenameFailed", { path: oldPath }));
      }
    }),
  );

  plugin.registerEvent(
    vault.on("delete", async (file) => {
      if (!(file instanceof TFile)) return;
      const lower = file.path.toLowerCase();
      if (!DRAWIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return;
      const sidecar = sidecarPath(file.path);
      try {
        if (await vault.adapter.exists(sidecar)) {
          await vault.adapter.remove(sidecar);
        }
      } catch (error) {
        console.error("[per-diagram-config] sidecar delete failed:", error);
      }
    }),
  );
}
