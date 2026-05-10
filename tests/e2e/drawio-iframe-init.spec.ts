import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { vaultRoot, samplePath } from "../helpers/vault-fs.ts";

test("drawio-iframe-init: opening empty.drawio triggers init/load postMessage", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // Obsidian のファイルエクスプローラから empty.drawio を開く
  // FIXME: Obsidian の内部 URL scheme でファイルを開く手段を task 7.2 で確認する
  // 現時点では obsidian://open?path=... を vault 起動時に渡す形を検討
  await window.evaluate((path) => {
    // Obsidian app global API 経由でファイルを開く試み
    const app = (window as unknown as { app?: { workspace?: { openLinkText?: (p: string, s: string) => void } } }).app;
    app?.workspace?.openLinkText?.(path, "");
  }, samplePath("empty.drawio"));

  const handle = getDrawioFrame(window, { selector: "iframe[sandbox]" });
  await handle.waitForReady(30_000);

  const messages = await handle.capturedMessages();
  const hasInitOrLoad = messages.some((m) => {
    const parsed = typeof m === "string" ? JSON.parse(m) as Record<string, unknown> : m as Record<string, unknown>;
    return parsed["event"] === "init" || parsed["event"] === "load";
  });
  expect(hasInitOrLoad).toBe(true);

  await app.close();
});
