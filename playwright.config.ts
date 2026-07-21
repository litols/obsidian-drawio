import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  // CI は共有 vault の並列競合を避けるため直列 (workers=1) + リトライで安定化する。
  // (vault の launch ごと isolate 化は将来改善: research.md 参照)
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  timeout: 300_000,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "e2e-setup",
      testDir: "./tests/e2e-setup",
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      // _-prefixed spec は手動・診断用なので通常 e2e からは除外する
      testIgnore: /_.*\.spec\.ts$/,
    },
    {
      name: "e2e-manual",
      testDir: "./tests/e2e",
      testMatch: /_manual\.spec\.ts$/,
    },
    {
      // 診断用 spec を任意で実行するためのプロジェクト
      name: "e2e-debug",
      testDir: "./tests/e2e",
      testMatch: /_.*\.spec\.ts$/,
    },
  ],
});
