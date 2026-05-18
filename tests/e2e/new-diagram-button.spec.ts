import { test, expect } from "@playwright/test";
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { revealFileExplorer, getActiveFilePath } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 今回追加: file explorer の「新規ノート」ボタン横に「新規ダイアグラム」ボタンを
// 追加し、クリックで空の .drawio を作成して編集ビューで開く。

test.afterEach(() => {
  // テストが作成した Untitled*.drawio (とサイドカー) を後片付けする
  for (const name of readdirSync(vaultRoot())) {
    if (/^Untitled.*\.drawio(\.json)?$/.test(name)) {
      rmSync(resolve(vaultRoot(), name), { force: true });
    }
  }
});

test("new-diagram-button: button sits next to 'New note' and creates a diagram", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);
  await revealFileExplorer(window);

  const btn = window.locator(".drawio-new-diagram-button");
  await expect(btn).toBeVisible({ timeout: 10_000 });

  // file explorer の nav ボタン列の 2 番目 (「新規ノート」の直後) に配置される
  const position = await window.evaluate(() => {
    const el = document.querySelector(".drawio-new-diagram-button");
    const nav = el?.parentElement;
    if (!el || !nav || !nav.classList.contains("nav-buttons-container")) return -1;
    return Array.prototype.indexOf.call(nav.children, el);
  });
  expect(position).toBe(1);

  // クリックすると新規 .drawio が作成され編集ビューで開く
  await btn.click();

  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  await expect
    .poll(() => getActiveFilePath(window), { timeout: 10_000 })
    .toMatch(/Untitled.*\.drawio$/);

  await app.close();
});
