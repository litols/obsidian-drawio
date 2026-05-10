# Changes to the Bundled draw.io Webapp

This distribution bundles the draw.io webapp (from `vendor/drawio/src/main/webapp/`)
without modifying any source files under `vendor/drawio/`.

## Runtime Bootstrap Substitution

The obsidian-drawio plugin replaces draw.io's standard HTTP-based asset loading with
a postMessage-based bootstrap and DOM API patching approach:

- The iframe is loaded from a `data:text/html,` minimal bootstrap instead of a
  direct `app://` URL, because Obsidian's internal `webRequest` filter blocks
  sub-resource requests under that scheme.
- An initialisation script (`dist/iframe-init.js`) is injected via postMessage
  into the iframe at runtime. This script patches `HTMLLinkElement`, `HTMLScriptElement`,
  `HTMLImageElement`, `XMLHttpRequest`, and inline style setters so that relative
  URL requests are resolved from a pre-loaded Blob URL table rather than the network.
- The draw.io webapp source code itself (`vendor/drawio/`) is not modified.

These changes are necessary to operate within Obsidian's Electron-based desktop
environment, which does not expose the Electron `protocol` API to Community Plugins.
