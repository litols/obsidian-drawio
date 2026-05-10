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
    ],
    test: {
      environment: "node",
      globals: false,
      include: ["src/**/*.{test,spec}.ts"],
      passWithNoTests: true,
    },
  }),
);
