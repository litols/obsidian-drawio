import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { waitForLayoutReady, getActiveFilePath } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 今回追加: `.drawio.svg` / `.drawio.png` のコンテキストメニューに
// 「draw.io で編集」項目を追加し、クリックで drawio 編集ビューを開く。
//
// 実際の右クリック DOM 操作は CI (macOS) で `.menu` が安定して開かないため、
// `file-menu` ワークスペースイベントを直接発火してハンドラの挙動を検証する。
test("edit-in-drawio-context-menu: file menu adds 'Edit in draw.io' and opens the editor", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);
  await waitForLayoutReady(window);

  // 指定ファイルで file-menu を発火し、追加された項目タイトル一覧を返す。
  // invoke=true のときは「Edit in draw.io」項目の onClick を実行する。
  const runFileMenu = (path: string, invoke: boolean) =>
    window.evaluate(
      (args: { path: string; invoke: boolean }) => {
        const app = (
          globalThis as unknown as {
            app?: {
              vault: { getAbstractFileByPath(p: string): unknown };
              workspace: { trigger(name: string, ...a: unknown[]): void };
            };
          }
        ).app;
        if (!app) return { found: false, titles: [] as string[] };
        const file = app.vault.getAbstractFileByPath(args.path);
        if (!file) return { found: false, titles: [] as string[] };

        const titles: string[] = [];
        let drawioClick: (() => void) | null = null;

        // メニュー項目: 任意のメソッドを許容する chainable Proxy。
        // 他プラグインや Obsidian コアの file-menu ハンドラが setDisabled 等を
        // 呼んでも壊れないようにする。
        const makeItem = () => {
          let title = "";
          let click: (() => void) | null = null;
          const proxy: unknown = new Proxy(
            {},
            {
              get(_t, prop) {
                if (prop === "setTitle")
                  return (t: string) => {
                    title = t;
                    return proxy;
                  };
                if (prop === "onClick")
                  return (fn: () => void) => {
                    click = fn;
                    return proxy;
                  };
                return () => proxy;
              },
            },
          );
          return {
            proxy,
            finish() {
              if (title) titles.push(title);
              if (/Edit in draw\.io/i.test(title)) drawioClick = click;
            },
          };
        };

        const menu: unknown = new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "addItem")
                return (cb: (item: unknown) => void) => {
                  const it = makeItem();
                  cb(it.proxy);
                  it.finish();
                  return menu;
                };
              return () => menu;
            },
          },
        );

        app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu");
        if (args.invoke && drawioClick) (drawioClick as () => void)();
        return { found: true, titles };
      },
      { path, invoke },
    );

  // `.drawio.svg` には「Edit in draw.io」項目が追加される
  const svg = await runFileMenu("samples/sample.drawio.svg", false);
  expect(svg.found).toBe(true);
  expect(svg.titles.some((t) => /Edit in draw\.io/i.test(t))).toBe(true);

  // `.drawio.png` にも追加される
  const png = await runFileMenu("samples/sample.drawio.png", false);
  expect(png.titles.some((t) => /Edit in draw\.io/i.test(t))).toBe(true);

  // 否定ケース: drawio ではない通常ファイルには追加されない
  const md = await runFileMenu("README.md", false);
  expect(md.found).toBe(true);
  expect(md.titles.some((t) => /Edit in draw\.io/i.test(t))).toBe(false);

  // 「Edit in draw.io」の onClick は編集意図なのでエディタで直接開く
  await runFileMenu("samples/sample.drawio.svg", true);

  await expect
    .poll(() => getActiveFilePath(window), { timeout: 10_000 })
    .toMatch(/sample\.drawio\.svg$/);

  // enterDrawioEditor を呼ばずともエディタ iframe が起動する (mode:"editor" 直開き)
  const handle = getDrawioFrame(window);
  await handle.waitForReady(30_000);

  await app.close();
});
