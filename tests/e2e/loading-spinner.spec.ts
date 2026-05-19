import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 今回追加: drawio 読み込み中のインジケータを、左上テキストから
// コンテナ中央のスピナーに変更した。
test("loading-spinner: a centered spinner is shown while drawio loads and removed when ready", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, "samples/empty.drawio");

  // 読み込み中はスピナーが表示される
  const spinner = window.locator(".drawio-loading-spinner");
  await expect(spinner).toBeVisible({ timeout: 10_000 });

  // スピナーは読み込みオーバーレイの中央に配置される
  const offset = await window.evaluate(() => {
    const sp = document.querySelector(".drawio-loading-spinner");
    const host = document.querySelector("[data-drawio-loading]");
    if (!sp || !host) return null;
    const s = sp.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return {
      dx: Math.abs(s.left + s.width / 2 - (h.left + h.width / 2)),
      dy: Math.abs(s.top + s.height / 2 - (h.top + h.height / 2)),
    };
  });
  expect(offset).not.toBeNull();
  expect(offset!.dx).toBeLessThan(2);
  expect(offset!.dy).toBeLessThan(2);

  // ready になるとスピナーは取り除かれる
  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);
  await expect(spinner).toBeHidden({ timeout: 10_000 });

  await app.close();
});
