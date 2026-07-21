import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile, enterDrawioEditor } from "../helpers/obsidian-app.ts";
import { vaultRoot, type SampleName } from "../helpers/vault-fs.ts";

const FORMATS: SampleName[] = ["empty.drawio", "sample.drawio.svg", "sample.drawio.png"];

test("three-formats-roundtrip: all three formats open and iframe becomes ready", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  for (const fmt of FORMATS) {
    await openFile(window, `samples/${fmt}`);
    // 既定はプレビュー表示なので編集モードへ遷移してエディタ iframe を起動する
    await enterDrawioEditor(window);

    const handle = getDrawioFrame(window);
    // 他 editor 系 spec と同じ 60s に統一 (cold ロードが重い環境向け)。
    await handle.waitForReady(60_000);
  }

  await app.close();
});
