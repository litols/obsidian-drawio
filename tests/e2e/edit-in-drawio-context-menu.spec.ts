import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { waitForLayoutReady, getActiveFilePath } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 今回追加: `.drawio.svg` / `.drawio.png` のコンテキストメニューに
// 「draw.io で編集」項目を追加し、クリックで drawio 編集ビューを開く。
test("edit-in-drawio-context-menu: a .drawio.svg file menu opens the drawio editor", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);
  await waitForLayoutReady(window);

  // 否定ケース: drawio ではないファイルにはメニュー項目を出さない
  await window.locator('.nav-file-title[data-path="README.md"]').click({ button: "right" });
  await expect(window.locator(".menu")).toBeVisible({ timeout: 5_000 });
  await expect(window.locator(".menu .menu-item", { hasText: "Edit in draw.io" })).toHaveCount(0);
  await window.keyboard.press("Escape");

  // file explorer の `samples` フォルダを展開する
  const fileTitle = window.locator('.nav-file-title[data-path="samples/sample.drawio.svg"]');
  if (!(await fileTitle.isVisible())) {
    await window.locator('.nav-folder-title[data-path="samples"]').click();
  }
  await expect(fileTitle).toBeVisible({ timeout: 5_000 });

  // コンテキストメニューを開き「Edit in draw.io」をクリック
  await fileTitle.click({ button: "right" });
  const menuItem = window.locator(".menu .menu-item", { hasText: "Edit in draw.io" });
  await expect(menuItem).toBeVisible({ timeout: 5_000 });
  await menuItem.click();

  // drawio 編集ビューが当該ファイルで開く
  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  await expect
    .poll(() => getActiveFilePath(window), { timeout: 10_000 })
    .toMatch(/sample\.drawio\.svg$/);

  await app.close();
});
