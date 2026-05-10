import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { ensurePluginEnabled, openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// FIXME: Obsidian の app:// protocol handler が drawio webapp の sub-resource
// (js/main.js, styles/grapheditor.css 等) を ERR_BLOCKED_BY_CLIENT で拒否する
// ため、現状 iframe が bootstrap せず init message を観測できない。
// drawio-embed-bridge spec のリソース配信戦略 (file:// or 専用 protocol or asset
// 同梱) を見直す必要があり、本 spec の適用範囲外。
test.fixme("drawio-iframe-init: opening empty.drawio triggers init/load postMessage", async () => {
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
