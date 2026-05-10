import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { installMessageCapture, getDrawioFrame } from "../helpers/drawio-frame.ts";
import { vaultRoot, samplePath, type SampleName } from "../helpers/vault-fs.ts";

const FORMATS: SampleName[] = ["empty.drawio", "sample.drawio.svg", "sample.drawio.png"];

test("three-formats-roundtrip: all three formats open and iframe becomes ready", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());
  await installMessageCapture(window);

  for (const fmt of FORMATS) {
    // FIXME: Obsidian workspace API でのファイルオープン手段は task 7.2 で確認する
    await window.evaluate((path) => {
      const app = (
        window as unknown as {
          app?: { workspace?: { openLinkText?: (p: string, s: string) => void } };
        }
      ).app;
      app?.workspace?.openLinkText?.(path, "");
    }, samplePath(fmt));

    const handle = getDrawioFrame(window, { selector: "iframe[sandbox]" });
    await handle.waitForReady(30_000);
  }

  await app.close();
});
