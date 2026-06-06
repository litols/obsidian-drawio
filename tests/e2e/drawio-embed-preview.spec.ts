import { test, expect } from "@playwright/test";
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile, getActiveFilePath } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 今回追加: 埋め込み drawio リンク (`![[*.drawio]]`) を、ライブ drawio iframe
// プレビューに置き換え、プレビューのクリックで編集ビューに遷移する。
const NOTE_REL = "drawio-embed-test.md";
const notePath = resolve(vaultRoot(), NOTE_REL);

test.afterEach(() => {
  rmSync(notePath, { force: true });
});

test("drawio-embed-preview: embedded .drawio renders a live preview that opens the editor on click", async () => {
  // drawio を埋め込んだノートを用意する
  writeFileSync(notePath, "# Embed test\n\n![[empty.drawio]]\n");

  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, NOTE_REL);

  // 既定のファイルチップではなくプレビューコンテナが描画される
  const preview = window.locator(".drawio-embed-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });

  // プレビュー内のライブ drawio iframe が ready になる (遅延マウント)
  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  // プレビューをクリックすると埋め込み元の drawio ファイルが編集ビューで開く
  await preview.click();
  await expect.poll(() => getActiveFilePath(window), { timeout: 10_000 }).toMatch(/empty\.drawio$/);

  await app.close();
});
