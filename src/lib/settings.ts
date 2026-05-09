import type { Plugin } from "obsidian";

/**
 * Plugin-wide settings shape.
 *
 * Intentionally empty in plugin-foundation. Downstream specs extend this
 * via TypeScript declaration merging, e.g.:
 *
 *   declare module "./settings.ts" {
 *     interface PluginSettings {
 *       drawio?: { ... };
 *     }
 *   }
 */
export interface PluginSettings {
  /**
   * Legacy top-level field. Migrated by drawio-settings-and-config to
   * `drawio.openDrawioSvg` namespace. New code should read from
   * `settings.drawio.openDrawioSvg` once the migration runs; while file-io
   * is implemented in isolation this top-level lives here as the source.
   */
  openDrawioSvg?: boolean;
  /**
   * Legacy top-level. Migrated to `drawio.openDrawioPng` by settings spec.
   */
  openDrawioPng?: boolean;
  /**
   * Legacy top-level. Migrated to `drawio.compression` by settings spec.
   * When true, .drawio writer keeps the file in pako-compressed form when
   * the original was compressed.
   */
  preserveCompression?: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  openDrawioSvg: true,
  openDrawioPng: true,
  preserveCompression: true,
};

export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
  const persisted = (await plugin.loadData()) as PluginSettings | null;
  return Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
}

export async function saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void> {
  await plugin.saveData(settings);
}
