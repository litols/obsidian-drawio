import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { vaultRoot, samplePath } from "../helpers/vault-fs.ts";

// FIXME: 設定 UI のセレクタ (theme 切替ボタン) は task 7.2 で実機確認してから enable する
test.skip("theme-follow: switching theme propagates configure message to drawio iframe", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // empty.drawio を開く
  await window.evaluate((path) => {
    const app = (
      window as unknown as {
        app?: { workspace?: { openLinkText?: (p: string, s: string) => void } };
      }
    ).app;
    app?.workspace?.openLinkText?.(path, "");
  }, samplePath("empty.drawio"));

  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  // FIXME: Obsidian 設定画面のテーマ切替 UI セレクタを確認して実装する
  // 例: await window.getByRole('button', { name: /settings/i }).click()
  //     await window.getByText(/appearance/i).click()
  //     await window.getByLabel(/theme/i).selectOption('dark')

  // テーマ切替後に configure メッセージが送信されることを確認
  const messages = await handle.capturedMessages();
  const hasConfigure = messages.some((m) => {
    const parsed =
      typeof m === "string"
        ? (JSON.parse(m) as Record<string, unknown>)
        : (m as Record<string, unknown>);
    return parsed["action"] === "configure";
  });

  // FIXME: 実機でセレクタ確認後に expect を有効化する
  void hasConfigure;

  await app.close();
});
