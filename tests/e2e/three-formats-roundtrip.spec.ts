import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot, type SampleName } from "../helpers/vault-fs.ts";

const FORMATS: SampleName[] = ["empty.drawio", "sample.drawio.svg", "sample.drawio.png"];

// FIXME: drawio iframe sub-resource が ERR_BLOCKED_BY_CLIENT (drawio-iframe-init
// spec の FIXME 参照)。upstream 解決後に enable する。
test.fixme("three-formats-roundtrip: all three formats open and iframe becomes ready", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  for (const fmt of FORMATS) {
    await openFile(window, `samples/${fmt}`);

    const handle = getDrawioFrame(window);
    await handle.waitForReady(30_000);
  }

  await app.close();
});
