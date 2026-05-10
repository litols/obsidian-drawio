import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { ensurePluginEnabled, openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

test("drawio-iframe-init: opening empty.drawio triggers init/load postMessage", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);
  await ensurePluginEnabled(window, "obsidian-drawio");

  await openFile(window, "samples/empty.drawio");

  // iframe が DOM に挿入されるまで待ってから message capture を再アタッチ
  await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
  await installMessageCapture(window);

  const handle = getDrawioFrame(window);
  await handle.waitForReady(60_000);

  const messages = await handle.capturedMessages();
  const hasInitOrLoad = messages.some((m) => {
    const parsed =
      typeof m === "string"
        ? (JSON.parse(m) as Record<string, unknown>)
        : (m as Record<string, unknown>);
    return parsed["event"] === "init" || parsed["event"] === "load";
  });
  expect(hasInitOrLoad).toBe(true);

  await app.close();
});
