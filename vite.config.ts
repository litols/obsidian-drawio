import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "styles.css", dest: "." },
      ],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    target: "es2018",
    outDir: "dist",
    emptyOutDir: true,
    minify: process.env["NODE_ENV"] === "production" ? "oxc" : false,
    sourcemap: process.env["NODE_ENV"] === "development" ? "inline" : false,
    rollupOptions: {
      external: ["obsidian", "electron", ...nodeBuiltins, /^@codemirror\//, /^@lezer\//],
      output: {
        exports: "default",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css") return "styles.css";
          return assetInfo.name ?? "asset";
        },
      },
    },
  },
});
