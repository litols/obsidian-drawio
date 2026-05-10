import { existsSync } from "node:fs";
import { resolve } from "node:path";

export default function globalSetup() {
  const root = resolve(import.meta.dirname, "..");
  const required = [
    ["dist/main.js", "Run `pnpm build` to generate the plugin bundle."],
    ["dist/manifest.json", "Run `pnpm build` to generate the plugin bundle."],
    ["dist/drawio/index.html", "Run `pnpm build` to copy drawio assets."],
  ] as const;

  const missing = required
    .filter(([path]) => !existsSync(resolve(root, path)))
    .map(([path, hint]) => `  - ${path}: ${hint}`);

  if (missing.length > 0) {
    throw new Error(
      `E2E preflight failed — required build artifacts are missing:\n${missing.join("\n")}`,
    );
  }
}
