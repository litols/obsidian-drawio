import { test, expect } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile, enterDrawioEditor } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";
import type { ElectronApplication } from "@playwright/test";

/**
 * 全プロセスの workingSetSize (KB, RSS 相当) の合計を返す。
 * performance.memory は iframe realm を含まないため使わず、Electron main の
 * getAppMetrics() を用いる (research.md の計測方針)。
 */
async function totalRssKb(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ app: electronApp }) => {
    const metrics = electronApp.getAppMetrics();
    return metrics.reduce(
      (sum: number, p: { memory?: { workingSetSize?: number } }) =>
        sum + (p.memory?.workingSetSize ?? 0),
      0,
    );
  });
}

test("oom: preview->editor transition memory spike stays under 200MB", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  // プレビューで開く (既定)。エディタ用アセットはまだロードされない。
  await openFile(window, "samples/empty.drawio");
  await window
    .locator("iframe[data-drawio-preview]")
    .waitFor({ state: "attached", timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 500));

  const baseline = await totalRssKb(app);

  // 遷移中の一時的な RSS ピークを捉えるためポーリングする。
  let polling = true;
  let peak = baseline;
  const pollLoop = (async () => {
    while (polling) {
      try {
        const rss = await totalRssKb(app);
        if (rss > peak) peak = rss;
      } catch {
        // app 終了時などは無視
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  })();

  // preview → editor 遷移: チャンク段階配信でアセットを供給する。
  await enterDrawioEditor(window);
  await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
  await getDrawioFrame(window).waitForReady(60_000);
  // テール配信を含む起動直後のピークも拾う。
  await new Promise((r) => setTimeout(r, 2000));
  polling = false;
  await pollLoop;

  // 遷移が落ち着いた後の安定 RSS を測る。
  await new Promise((r) => setTimeout(r, 5000));
  const stable = await totalRssKb(app);

  // transient spike = peak − 遷移後 stable。段階配信 (ack backpressure + tail lazy) が
  // 縮小させるのはこの一時増分 (旧実装は単一 ~110MB postMessage の構造化複製で発生)。
  // エディタ本体の恒常フットプリント (~+800MB) は inherent なため peak−baseline では測らない。
  const transientMb = (peak - stable) / 1024;
  const growthMb = (stable - baseline) / 1024;
  console.log(
    `OOM metrics — baseline: ${(baseline / 1024).toFixed(0)}MB, peak: ${(peak / 1024).toFixed(0)}MB, stable: ${(stable / 1024).toFixed(0)}MB | transient(peak-stable): +${transientMb.toFixed(0)}MB, growth(stable-baseline): +${growthMb.toFixed(0)}MB`,
  );

  // 遷移の一時スパイクが +200MB 未満であること (要件 5.5 / task 7.2 改定基準)。
  expect(transientMb).toBeLessThan(200);

  await app.close();
});
