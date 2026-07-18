import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile, enterDrawioEditor } from "../helpers/obsidian-app.ts";
import { vaultRoot, type SampleName } from "../helpers/vault-fs.ts";

const FORMATS: SampleName[] = ["empty.drawio", "sample.drawio.svg", "sample.drawio.png"];

/**
 * EDITOR_ASSET_EXCLUDES 適用後も、3 形式すべてでエディタが従来どおり起動する (init 到達) ことを
 * 確認する回帰テスト (要件 3.5, 5.2)。除外が必須アセットを落としていれば init に到達しない。
 */
test("editor-exclude-regression: editor still boots for all three formats after asset exclusion", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  for (const fmt of FORMATS) {
    await installMessageCapture(window);
    await openFile(window, `samples/${fmt}`);
    await enterDrawioEditor(window);
    await window.locator("iframe[data-drawio]").waitFor({ state: "attached", timeout: 30_000 });
    await getDrawioFrame(window).waitForReady(60_000);
  }

  await app.close();
});
