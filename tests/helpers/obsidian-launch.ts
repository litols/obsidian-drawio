import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

export function getDefaultUnpackedDir(): string {
  return resolve(REPO_ROOT, ".obsidian-unpacked");
}

export async function launchObsidianForVault(
  vaultPath: string,
  options?: { obsidianUnpackedDir?: string },
): Promise<{ app: ElectronApplication; window: Page }> {
  const unpackedDir = options?.obsidianUnpackedDir ?? getDefaultUnpackedDir();
  const mainJs = resolve(unpackedDir, "main.js");

  if (!existsSync(mainJs)) {
    throw new Error(
      `Obsidian unpacked main.js not found at ${mainJs}. Run \`bash scripts/setup-obsidian.sh\` first.`,
    );
  }

  const app = await electron.launch({
    args: [mainJs, "open", `obsidian://open?path=${encodeURIComponent(vaultPath)}`],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  return { app, window };
}
