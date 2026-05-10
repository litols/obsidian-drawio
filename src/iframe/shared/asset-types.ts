/**
 * Shared type definitions consumed by both parent-side code (drawio-asset-loader)
 * and in-iframe code (iframe-init/*).
 *
 * mediaType encoding convention:
 *   - A plain MIME type (e.g. "text/javascript", "text/css") means `source` is a
 *     UTF-8 text string.
 *   - A MIME type with a ";base64" suffix (e.g. "image/png;base64", "image/gif;base64")
 *     means `source` is a base64-encoded string of the binary content.
 *     In-iframe RequestManager uses this suffix to decide whether to decode before
 *     creating a Blob URL.
 *
 * All types are pure data shapes — no imports from "obsidian", "electron", or Node
 * builtins so that this module is safe to include in the in-iframe IIFE build.
 */

export interface DrawioResponseEntry {
  readonly mediaType: string; // e.g. "text/javascript", "image/png;base64"
  readonly href: string; // relative path, e.g. "js/main.js"
  readonly source: string; // utf-8 text or base64 string (see mediaType convention above)
}

export interface DrawioAssetBundle {
  readonly responses: readonly DrawioResponseEntry[];
  readonly indexHtml: string;
  readonly appJsSource: string;
}
