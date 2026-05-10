import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture } from "../helpers/drawio-frame.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

test("plugin-activation: drawio plugin is enabled and visible in settings", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // drawio という文字列が UI のどこかに表示されていることを確認
  await expect(window.getByText(/drawio/i)).toBeVisible({ timeout: 10_000 });

  await app.close();
});
