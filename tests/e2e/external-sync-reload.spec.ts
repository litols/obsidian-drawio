import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot, samplePath, writeExternal } from "../helpers/vault-fs.ts";

test("external-sync-reload: external write triggers reload banner", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, "samples/empty.drawio");

  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  await writeExternal(samplePath("empty.drawio"), "<mxfile><diagram></diagram></mxfile>");

  const banner = window.getByText(/external change|reload/i);
  await expect(banner).toBeVisible({ timeout: 10_000 });

  await app.close();
});
