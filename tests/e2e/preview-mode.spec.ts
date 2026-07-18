import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture } from "../helpers/drawio-frame.ts";
import { openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";
import type { Page } from "@playwright/test";

/** 親ウィンドウが捕捉した preview iframe → 親メッセージから指定 event を待つ。 */
async function waitForPreviewEvent(page: Page, event: string, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const messages: unknown[] = await page.evaluate(() => globalThis.__drawioMessages ?? []);
        return messages.some((m) => {
          const parse = (v: unknown): Record<string, unknown> | null => {
            if (typeof v === "string") {
              try {
                return JSON.parse(v) as Record<string, unknown>;
              } catch {
                return null;
              }
            }
            return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
          };
          return parse(m)?.["event"] === event;
        });
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

test("preview-mode: .drawio opens as GraphViewer preview without loading the editor", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, "samples/empty.drawio");

  // プレビュー iframe が表示され、エディタ用 iframe は生成されない (要件 1.1, 5.1)
  await window
    .locator("iframe[data-drawio-preview]")
    .waitFor({ state: "attached", timeout: 30_000 });
  expect(await window.locator("iframe[data-drawio]").count()).toBe(0);

  // GraphViewer が描画完了して preview-ready を親へ通知する (要件 1.3)
  await waitForPreviewEvent(window, "preview-ready", 30_000);

  await app.close();
});

test("preview-mode: single-page .drawio.svg opens as an image preview", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, "samples/sample.drawio.svg");

  // 画像プレビューが即時表示され、エディタ / GraphViewer iframe は生成されない (要件 1.2, 5.1)
  const img = window.locator(".drawio-image-preview-img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect(img).toHaveAttribute("src", /.+/);
  expect(await window.locator("iframe[data-drawio]").count()).toBe(0);
  expect(await window.locator("iframe[data-drawio-preview]").count()).toBe(0);

  await app.close();
});
