import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Separate Vite config for the in-iframe preview initialisation bundle.
// Must be built as IIFE so it can be injected via postMessage as a raw script string.
// Mirrors vite.iframe-init.config.ts. Must NOT list obsidian / electron / node builtins
// as external — those runtimes are unavailable inside the iframe context.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/iframe/preview/index.ts"),
      formats: ["iife"],
      name: "DrawioPreviewInit",
      fileName: () => "preview-init.js",
    },
    target: "es2018",
    outDir: "dist",
    // Do NOT wipe dist/ here; the main build (vite.config.ts) runs first and
    // owns the emptyOutDir pass.
    emptyOutDir: false,
    minify: process.env["NODE_ENV"] === "production" ? "oxc" : false,
    sourcemap: process.env["NODE_ENV"] === "development" ? "inline" : false,
    rollupOptions: {
      // No externals: iframe runtime has no access to obsidian / electron / node.
      external: [],
    },
  },
});
