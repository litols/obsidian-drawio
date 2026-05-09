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
export interface PluginSettings {}

export const DEFAULT_SETTINGS: PluginSettings = {};

export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
  const persisted = (await plugin.loadData()) as PluginSettings | null;
  return Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
}

export async function saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void> {
  await plugin.saveData(settings);
}
