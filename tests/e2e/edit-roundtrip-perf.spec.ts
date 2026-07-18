import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile, enterDrawioEditor } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";
import type { Page } from "@playwright/test";

async function enterPreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.app.commands.executeCommandById("obsidian-drawio:drawio-enter-preview");
  });
}

/**
 * 同一セッションで 2 回目のエディタ起動が、アセットのディスク再読込を行わないことを検証する
 * (要件 5.2)。DrawioAssetCache がディスク読込時に出力する console.debug ログの回数で判定する。
 */
test("edit-roundtrip-perf: second editor launch reuses cached assets (no disk reload)", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // DrawioAssetCache のディスクロードログを数える
  let diskLoadCount = 0;
  window.on("console", (msg) => {
    if (msg.text().includes("asset-cache: loading editor bundle from disk")) {
      diskLoadCount += 1;
    }
  });

  await openFile(window, "samples/empty.drawio");

  // 1 回目: プレビュー → エディタ
  await enterDrawioEditor(window);
  await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
  await getDrawioFrame(window).waitForReady(60_000);
  expect(diskLoadCount).toBe(1);

  // プレビューへ戻す
  await enterPreview(window);
  await window
    .locator("iframe[data-drawio-preview]")
    .waitFor({ state: "attached", timeout: 30_000 });

  // 2 回目のエディタ起動: キャッシュ再利用でディスク再読込は発生しない
  await installMessageCapture(window);
  await enterDrawioEditor(window);
  await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
  await getDrawioFrame(window).waitForReady(60_000);
  expect(diskLoadCount).toBe(1);

  await app.close();
});
