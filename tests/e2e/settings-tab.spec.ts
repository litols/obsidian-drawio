import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { openPluginSettings, closeSettings, getDrawioSettings } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// settings-ui-refresh task 3: 設定タブが Obsidian 標準の設定行構造で描画され、
// 値変更が永続化され、ライブラリ一覧の追加/削除/リセット/重複無視/不正パスエラーが
// 正しく機能することを検証する。

const PLUGIN_ID = "obsidian-drawio";

interface DrawioSettingsShape {
  compression: boolean;
  baselineLibraries: string[];
  customLibraries: string[];
}

// テストは永続設定 (vault の data.json) を書き換えるため、毎回リセットして独立させる。
test.afterEach(() => {
  rmSync(resolve(vaultRoot(), ".obsidian", "plugins", PLUGIN_ID, "data.json"), { force: true });
});

test("settings-tab: renders standard setting rows without a top-level heading", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await openPluginSettings(window, PLUGIN_ID);

  const intro = window.locator(".drawio-settings-intro");
  await expect(intro).toBeVisible({ timeout: 10_000 });

  // intro の親要素が PluginSettingTab の containerEl。ここに配下を限定して検証する。
  const container = intro.locator("xpath=..");

  // 各設定項目が標準の .setting-item 行として描画されている (要件 1.1, 2.1)
  await expect(container.locator(".setting-item").first()).toBeVisible();
  expect(await container.locator(".setting-item").count()).toBeGreaterThan(5);

  // トップレベル見出し (h1/h2) を出力しない (要件 1.2)
  expect(await container.locator("h1, h2").count()).toBe(0);

  await app.close();
});

test("settings-tab: toggling a boolean persists across reopen", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await openPluginSettings(window, PLUGIN_ID);
  await expect(window.locator(".drawio-settings-intro")).toBeVisible({ timeout: 10_000 });

  const before = (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).compression;

  // Compression 行の toggle をクリックする
  const row = window.locator(".setting-item", { hasText: "Compression" }).first();
  await row.locator(".checkbox-container").click();

  // 即時永続化される (要件 2.2)
  await expect
    .poll(async () => (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).compression)
    .toBe(!before);

  // 閉じて再度開くと新しい値が UI に反映されている (要件 2.5)
  await closeSettings(window);
  await openPluginSettings(window, PLUGIN_ID);
  await expect(window.locator(".drawio-settings-intro")).toBeVisible();

  const reopenedToggle = window
    .locator(".setting-item", { hasText: "Compression" })
    .first()
    .locator(".checkbox-container");
  const classAttr = (await reopenedToggle.getAttribute("class")) ?? "";
  expect(classAttr.includes("is-enabled")).toBe(!before);

  await app.close();
});

test("settings-tab: baseline library add (button + Enter), dedupe, remove, reset", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await openPluginSettings(window, PLUGIN_ID);
  await expect(window.locator(".drawio-settings-intro")).toBeVisible({ timeout: 10_000 });

  const baselineInput = window.locator('input[placeholder="e.g. general"]');
  const baselineAddRow = window.locator(".setting-item", { has: baselineInput });

  // ボタン経由で追加
  await baselineInput.fill("mockup");
  await baselineAddRow.getByRole("button", { name: "Add" }).click();
  await expect
    .poll(async () =>
      (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).baselineLibraries.includes(
        "mockup",
      ),
    )
    .toBe(true);

  // 重複追加は無視される (要件 2.3)
  await baselineInput.fill("mockup");
  await baselineAddRow.getByRole("button", { name: "Add" }).click();
  await expect
    .poll(
      async () =>
        (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).baselineLibraries.filter(
          (id) => id === "mockup",
        ).length,
    )
    .toBe(1);

  // Enter キーで追加
  await baselineInput.fill("android");
  await baselineInput.press("Enter");
  await expect
    .poll(async () =>
      (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).baselineLibraries.includes(
        "android",
      ),
    )
    .toBe(true);

  // エントリ行の削除ボタン (trash ExtraButton) で削除
  const androidRow = window
    .locator(".setting-item")
    .filter({ has: window.locator(".setting-item-name", { hasText: /^android$/ }) });
  await androidRow.locator(".extra-setting-button").click();
  await expect
    .poll(async () =>
      (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).baselineLibraries.includes(
        "android",
      ),
    )
    .toBe(false);

  // Reset で drawio 既定値 (7 カテゴリ) に戻る (要件 2.3)
  await window
    .locator(".setting-item", { hasText: "Baseline libraries" })
    .first()
    .getByRole("button", { name: "Reset to drawio default" })
    .click();
  await expect
    .poll(
      async () =>
        (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).baselineLibraries.length,
    )
    .toBe(7);

  await app.close();
});

test("settings-tab: invalid custom library path shows inline error and is not added", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await openPluginSettings(window, PLUGIN_ID);
  await expect(window.locator(".drawio-settings-intro")).toBeVisible({ timeout: 10_000 });

  const before = (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).customLibraries
    .length;

  const customInput = window.locator('input[placeholder="e.g. libraries/custom.xml"]');
  const customAddRow = window.locator(".setting-item", { has: customInput });

  await customInput.fill("https://evil.example/lib.xml");
  await customAddRow.getByRole("button", { name: "Add" }).click();

  // インラインエラーが表示され (要件 2.4)、一覧は変化しない
  await expect(window.getByText("External URLs are not allowed")).toBeVisible();
  const after = (await getDrawioSettings<DrawioSettingsShape>(window, PLUGIN_ID)).customLibraries
    .length;
  expect(after).toBe(before);

  await app.close();
});
