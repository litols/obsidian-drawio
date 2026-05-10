import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

export function getDefaultUnpackedDir(): string {
  return resolve(REPO_ROOT, ".obsidian-unpacked");
}

export function getDefaultUserDataDir(): string {
  return resolve(REPO_ROOT, ".obsidian-userdata");
}

function provisionUserDataDir(seedDir?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "obsidian-e2e-"));
  const seed = seedDir ?? getDefaultUserDataDir();
  if (existsSync(seed)) {
    cpSync(seed, dir, { recursive: true });
    rmSync(resolve(dir, "SingletonLock"), { force: true });
    rmSync(resolve(dir, "SingletonCookie"), { force: true });
    rmSync(resolve(dir, "SingletonSocket"), { force: true });
  }
  return dir;
}

export async function launchObsidian(options?: {
  obsidianUnpackedDir?: string;
  userDataDir?: string;
  isolated?: boolean;
}): Promise<ElectronApplication> {
  const unpackedDir = options?.obsidianUnpackedDir ?? getDefaultUnpackedDir();
  const mainJs = resolve(unpackedDir, "main.js");
  const isolated = options?.isolated ?? true;
  const userDataDir =
    options?.userDataDir ?? (isolated ? provisionUserDataDir() : getDefaultUserDataDir());

  if (!existsSync(mainJs)) {
    throw new Error(
      `Obsidian unpacked main.js not found at ${mainJs}. Run \`bash scripts/setup-obsidian.sh\` first.`,
    );
  }

  rmSync(resolve(userDataDir, "SingletonLock"), { force: true });
  rmSync(resolve(userDataDir, "SingletonCookie"), { force: true });
  rmSync(resolve(userDataDir, "SingletonSocket"), { force: true });

  const app = await electron.launch({
    args: [
      mainJs,
      `--user-data-dir=${userDataDir}`,
      "--lang=en-US",
      "--disable-web-security",
      "open",
    ],
  });

  // attach userDataDir for cleanup if needed
  Object.defineProperty(app, "_userDataDir", { value: userDataDir, configurable: true });
  return app;
}

export async function openVaultViaDialog(
  app: ElectronApplication,
  vaultPath: string,
): Promise<Page> {
  let window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await app.evaluate(async ({ dialog }, fakePath) => {
    dialog.showOpenDialogSync = () => [fakePath];
  }, vaultPath);

  await window.getByRole("button", { name: /^(Open|開く)$/ }).click();

  window = await app.waitForEvent("window");
  await window.waitForLoadState("domcontentloaded");
  return window;
}

export async function launchObsidianForVault(
  _vaultPath: string,
  options?: { obsidianUnpackedDir?: string; userDataDir?: string },
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await launchObsidian(options);
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  return { app, window };
}
