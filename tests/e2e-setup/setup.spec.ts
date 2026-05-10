import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture } from "../helpers/drawio-frame.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

test("e2e-setup: trust author and warm vault", async () => {
  installPluginIntoVault();

  const { app, window } = await launchObsidianForVault(vaultRoot());

  await installMessageCapture(window);

  // trust author ダイアログが表示された場合のみ突破
  try {
    const trustButton = window.getByRole("button", { name: /trust author/i });
    await trustButton.waitFor({ timeout: 5000 });
    await trustButton.click();
  } catch {
    // ダイアログ未表示 (既に trust 済) の場合はスキップ
  }

  // プラグイン有効化を待つ
  await window.waitForTimeout(3000);

  await app.close();
});
