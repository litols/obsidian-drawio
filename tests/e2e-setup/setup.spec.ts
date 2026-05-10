import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "@playwright/test";
import {
  getDefaultUserDataDir,
  launchObsidian,
  openVaultViaDialog,
} from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

test("e2e-setup: trust author and warm vault", async () => {
  installPluginIntoVault();

  rmSync(resolve(vaultRoot(), ".obsidian", "workspace.json"), {
    force: true,
    recursive: true,
  });
  rmSync(getDefaultUserDataDir(), { force: true, recursive: true });

  const app = await launchObsidian({
    userDataDir: getDefaultUserDataDir(),
    isolated: false,
  });

  try {
    const window = await openVaultViaDialog(app, vaultRoot());

    try {
      await window
        .getByRole("button", {
          name: /Trust author and enable plugins|作成者を信頼してプラグインを有効化/,
        })
        .click({ timeout: 10_000 });
    } catch {
      // 既に trust 済 / ダイアログ未表示
    }

    await window.keyboard.press("Escape");

    // obsidian-drawio plugin を有効化 (community plugin 設定もオン)
    await window.evaluate(async () => {
      const obsidianApp = (globalThis as unknown as { app: ObsidianApp }).app;
      await obsidianApp.plugins.setEnable(true);
      await obsidianApp.plugins.enablePluginAndSave("obsidian-drawio");
    });

    await window.waitForTimeout(2000);
  } finally {
    await app.close();
  }
});

interface ObsidianApp {
  plugins: {
    setEnable(enable: boolean): Promise<void>;
    enablePluginAndSave(id: string): Promise<void>;
  };
}
