import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  timeout: 300_000,
  reporter: [["list"], ["html", { open: "never" }]],
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
  ],
});
