import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  rmSync,
  cpSync,
} from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

export interface InstallPluginOptions {
  distDir?: string;
  vaultPath?: string;
  pluginId?: string;
}

export function installPluginIntoVault(options?: InstallPluginOptions): { pluginDir: string } {
  const distDir = options?.distDir ?? resolve(REPO_ROOT, "dist");
  const vaultPath = options?.vaultPath ?? resolve(REPO_ROOT, "e2e-vault");
  const pluginId = options?.pluginId ?? "obsidian-drawio";

  if (!existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir}. Run \`pnpm build\` first.`);
  }
  if (!existsSync(resolve(distDir, "main.js"))) {
    throw new Error(
      `dist/main.js not found at ${resolve(distDir, "main.js")}. Run \`pnpm build\` first.`,
    );
  }

  const pluginDir = resolve(vaultPath, ".obsidian", "plugins", pluginId);
  mkdirSync(pluginDir, { recursive: true });

  const items = [
    "main.js",
    "iframe-init.js",
    "preview-init.js",
    "manifest.json",
    "styles.css",
    "drawio",
  ];
  for (const item of items) {
    const src = resolve(distDir, item);
    const dest = resolve(pluginDir, item);

    if (!existsSync(src)) continue;

    // file/dir どちらも symlink を優先する。並列ワーカー下で冪等になり、
    // ディレクトリ (drawio アセット) の rmSync+cpSync 競合を避けられる。
    const stat = lstatSync(dest, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() && readlinkSync(dest) === src) {
      continue;
    }
    if (stat !== undefined) {
      rmSync(dest, { recursive: true, force: true });
    }
    try {
      symlinkSync(src, dest);
    } catch {
      // 競合した別ワーカーが先にシンボリックリンクを張ったケースを許容
      const after = lstatSync(dest, { throwIfNoEntry: false });
      if (after?.isSymbolicLink() && readlinkSync(dest) === src) {
        continue;
      }
      cpSync(src, dest, { recursive: true });
    }
  }

  return { pluginDir };
}
