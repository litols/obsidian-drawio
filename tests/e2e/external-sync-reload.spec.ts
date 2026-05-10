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

  // banner is only shown when autoReloadWhenClean=false OR the view is dirty.
  // disable autoReload here so the banner is the expected outcome for a clean file.
  await window.evaluate(async () => {
    interface PluginShape {
      settings: { drawio?: { externalSync: { autoReloadWhenClean: boolean } } };
      saveSettings?: () => Promise<void>;
    }
    const obsidianApp = (globalThis as unknown as {
      app: { plugins: { plugins: Record<string, PluginShape> } };
    }).app;
    const drawio = obsidianApp.plugins.plugins["obsidian-drawio"];
    if (drawio?.settings?.drawio?.externalSync) {
      drawio.settings.drawio.externalSync.autoReloadWhenClean = false;
      await drawio.saveSettings?.();
    }
  });

  await writeExternal(samplePath("empty.drawio"), "<mxfile><diagram></diagram></mxfile>");

  const banner = window.getByText(/external change|reload/i);
  await expect(banner).toBeVisible({ timeout: 10_000 });

  await app.close();
});
