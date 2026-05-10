import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { vaultRoot, samplePath, writeExternal } from "../helpers/vault-fs.ts";

test("external-sync-reload: external write triggers reload banner", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // empty.drawio を開く
  await window.evaluate((path) => {
    const app = (window as unknown as { app?: { workspace?: { openLinkText?: (p: string, s: string) => void } } }).app;
    app?.workspace?.openLinkText?.(path, "");
  }, samplePath("empty.drawio"));

  const handle = getDrawioFrame(window, { selector: "iframe[sandbox]" });
  await handle.waitForReady(30_000);

  // 外部書き込みで echo suppression を回避しつつ変更を注入 (default sleepMs=5000)
  await writeExternal(samplePath("empty.drawio"), "<mxfile><diagram></diagram></mxfile>");

  // reload バナーが表示されることを確認
  // FIXME: バナーの実際の文言は task 7.2 で実機確認してセレクタを調整する
  const banner = window.getByText(/外部.*変更|external change|reload/i);
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // reload 採用ボタンを押して iframe が再ロードされることを確認
  // FIXME: reload ボタンのセレクタは task 7.2 で実機確認する
  const reloadBtn = window.getByRole("button", { name: /reload|revert|採用/i });
  await reloadBtn.click();

  // 再ロード後に新たな load event が capturedMessages に含まれることを確認
  const messages = await handle.capturedMessages();
  const hasLoad = messages.some((m) => {
    const parsed = typeof m === "string" ? JSON.parse(m) as Record<string, unknown> : m as Record<string, unknown>;
    return parsed["event"] === "load";
  });
  expect(hasLoad).toBe(true);

  await app.close();
});
