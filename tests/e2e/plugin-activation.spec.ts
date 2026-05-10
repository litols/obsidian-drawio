import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { isPluginEnabled } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

test("plugin-activation: drawio plugin is enabled", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await expect
    .poll(() => isPluginEnabled(window, "obsidian-drawio"), { timeout: 10_000 })
    .toBe(true);

  await app.close();
});
