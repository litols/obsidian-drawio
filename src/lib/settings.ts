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
