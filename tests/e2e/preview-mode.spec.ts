import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture } from "../helpers/drawio-frame.ts";
import { openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";
import type { Page } from "@playwright/test";

/**
 * 実行中プラグインの defaultOpenMode を in-memory で書き換える。
 * onLoadFile は in-memory settings を参照するため saveSettings は不要。
 * data.json を汚さないので共有 vault を使う並列テストに影響しない。
 */
async function setDefaultOpenMode(page: Page, mode: "preview" | "editor"): Promise<void> {
  // onload 完了を待ってから設定する。plugin.settings の初期値は DEFAULT_SETTINGS で
  // 既に .drawio を持つため、settings.drawio の有無では onload 前後を区別できない。
  // onload 終盤で生成される assetCache の存在を onload 完了の指標として待つ
  // (これより前は onload が this.settings を差し替えるため in-memory 変更が失われる)。
  await page.waitForFunction(
    () => {
      const p = (
        globalThis as unknown as {
          app?: {
            plugins?: {
              plugins?: Record<string, { assetCache?: unknown; settings?: { drawio?: unknown } }>;
            };
          };
        }
      ).app?.plugins?.plugins?.["obsidian-drawio"];
      return !!p?.assetCache && !!p?.settings?.drawio;
    },
    { timeout: 30_000 },
  );
  await page.evaluate((m) => {
    interface PluginShape {
      settings: { drawio?: { defaultOpenMode?: string } };
    }
    const obsidianApp = (
      globalThis as unknown as { app: { plugins: { plugins: Record<string, PluginShape> } } }
    ).app;
    const drawio = obsidianApp.plugins.plugins["obsidian-drawio"];
    if (drawio?.settings?.drawio) {
      drawio.settings.drawio.defaultOpenMode = m;
    }
  }, mode);
}

/** 実行中プラグインの previewBackground を in-memory で設定する (onload 完了を待つ)。 */
async function setPreviewBackground(page: Page, color: string): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = (
        globalThis as unknown as {
          app?: {
            plugins?: {
              plugins?: Record<string, { assetCache?: unknown; settings?: { drawio?: unknown } }>;
            };
          };
        }
      ).app?.plugins?.plugins?.["obsidian-drawio"];
      return !!p?.assetCache && !!p?.settings?.drawio;
    },
    { timeout: 30_000 },
  );
  await page.evaluate((c) => {
    const p = (
      globalThis as unknown as {
        app: {
          plugins: {
            plugins: Record<string, { settings: { drawio?: { previewBackground?: string } } }>;
          };
        };
      }
    ).app.plugins.plugins["obsidian-drawio"];
    if (p?.settings?.drawio) p.settings.drawio.previewBackground = c;
  }, color);
}

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

test("preview-mode: defaultOpenMode=editor makes a newly opened file open in the editor", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // 既定表示モードをエディタに変更後、新たにファイルを開く (要件 1.4, 6.3)
  await setDefaultOpenMode(window, "editor");
  await openFile(window, "samples/empty.drawio");

  // エディタ iframe が直接起動し、プレビュー iframe は生成されない
  await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
  expect(await window.locator("iframe[data-drawio-preview]").count()).toBe(0);

  await app.close();
});

test("preview-mode: previewBackground setting is applied to the image preview", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // 背景色を変更してから画像プレビューを開く (要件 6.6)
  await setPreviewBackground(window, "rgb(200, 100, 50)");
  await openFile(window, "samples/sample.drawio.svg");

  const viewport = window.locator(".drawio-image-preview-viewport");
  await expect(viewport).toBeVisible({ timeout: 15_000 });
  await expect(viewport).toHaveCSS("background-color", "rgb(200, 100, 50)");

  await app.close();
});

test("preview-mode: multi-page .drawio preview provides pages toolbar and zoom controls", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  await openFile(window, "samples/multipage.drawio");

  await window
    .locator("iframe[data-drawio-preview]")
    .waitFor({ state: "attached", timeout: 30_000 });
  await waitForPreviewEvent(window, "preview-ready", 30_000);

  const frame = window.frameLocator("iframe[data-drawio-preview]");
  // GraphViewer が図を描画している
  await expect(frame.locator("svg").first()).toBeVisible({ timeout: 15_000 });
  // toolbar のズーム等ボタン (img.geAdaptiveAsset) が存在する = zoom 手段の提供 (要件 2.1-2.3)
  await expect(frame.locator("img.geAdaptiveAsset").first()).toBeVisible({ timeout: 15_000 });
  expect(await frame.locator("img.geAdaptiveAsset").count()).toBeGreaterThanOrEqual(3);
  // ページ切替 UI: pages toolbar のページ表示 "1 / 2" が存在する (要件 2.4)。クリックは行わない
  await expect(frame.getByText(/\d+\s*\/\s*\d+/).first()).toBeVisible({ timeout: 15_000 });

  // 全面表示 (要件 2.6): GraphViewer の描画ホストが iframe 幅をほぼ占有する
  // (resize:true だとホストが図サイズへ縮小し「小さく」表示される回帰のガード)。
  const fill = await window.evaluate(() => {
    const ifr = document.querySelector("iframe[data-drawio-preview]") as HTMLIFrameElement | null;
    const iframeW = ifr?.getBoundingClientRect().width ?? 0;
    return { iframeW };
  });
  const hostW = await frame
    .locator("[data-drawio-preview-host]")
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(fill.iframeW).toBeGreaterThan(200);
  expect(hostW).toBeGreaterThanOrEqual(Math.round(fill.iframeW * 0.9));

  // ジェスチャ配線 (要件 2.7): ctrl+wheel でズームすると graph の transform が変化する。
  // (ジェスチャの忠実なシミュレーションではなく transform 変化の確認に留める)
  const readTransforms = () =>
    frame
      .locator("svg")
      .first()
      .evaluate((svg) =>
        Array.from(svg.querySelectorAll("g[transform]"))
          .map((g) => g.getAttribute("transform"))
          .join("|"),
      );
  const beforeT = await readTransforms();
  await frame
    .locator("svg")
    .first()
    .evaluate((svg) => {
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -240,
          ctrlKey: true,
          clientX: 200,
          clientY: 200,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await expect.poll(readTransforms, { timeout: 5_000 }).not.toBe(beforeT);

  await app.close();
});
