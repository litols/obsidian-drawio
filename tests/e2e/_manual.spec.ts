import { test } from "@playwright/test";
import { launchObsidianForVault } from "../helpers/obsidian-launch.ts";
import { installPluginIntoVault } from "../helpers/plugin-install.ts";
import { ensurePluginEnabled, openFile } from "../helpers/obsidian-app.ts";
import { vaultRoot } from "../helpers/vault-fs.ts";

// 手動確認用 — Obsidian ウィンドウを開いて、ユーザがアプリを閉じるまで待機する。
// `pnpm playwright test --project=e2e tests/e2e/_manual.spec.ts` で起動。
test.setTimeout(0);

test("manual: open vault and wait until app closes", async () => {
  installPluginIntoVault();
  const { app, window } = await launchObsidianForVault(vaultRoot());

  await ensurePluginEnabled(window, "obsidian-drawio");
  await openFile(window, "samples/empty.drawio");

  console.log("\n[manual] Obsidian launched. Close the window to end the test.\n");
  await app.waitForEvent("close", { timeout: 0 });
  console.log("[manual] App closed.");
});
