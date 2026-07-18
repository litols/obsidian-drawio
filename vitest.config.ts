import { defineConfig, mergeConfig } from "vitest/config";
import type { Plugin } from "vite";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [
      {
        name: "strip-build-only-plugins",
        config(config) {
          config.plugins = (config.plugins as Plugin[]).filter(
            (p) => p && (p as Plugin).name !== "vite-plugin-static-copy",
          );
        },
      },
      {
        // obsidian パッケージは main:"" で Vite が解決できないため、test 実行時に空モジュールを返す
        name: "stub-obsidian",
        enforce: "pre",
        resolveId(id) {
          if (id === "obsidian") return "\0obsidian-stub";
        },
        load(id) {
          if (id === "\0obsidian-stub") return "export default {}";
        },
      },
    ],
    test: {
      environment: "node",
      globals: false,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      passWithNoTests: true,
    },
  }),
);
