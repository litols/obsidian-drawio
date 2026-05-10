import type { Page } from "@playwright/test";

interface ObsidianApp {
  workspace: {
    openLinkText(linkpath: string, sourcePath: string): Promise<void>;
    activeLeaf?: { view?: { containerEl?: HTMLElement } };
    getActiveFile?: () => { path: string } | null;
    onLayoutReady(cb: () => void): void;
    layoutReady?: boolean;
  };
  plugins: {
    enabledPlugins: Set<string>;
    plugins: Record<string, unknown>;
    enablePluginAndSave(id: string): Promise<void>;
    setEnable(enable: boolean): Promise<void>;
  };
  vault: {
    getAbstractFileByPath(path: string): { path: string } | null;
  };
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
  commands: {
    executeCommandById(id: string): boolean;
  };
}

declare global {
  interface Window {
    app: ObsidianApp;
  }
}

export async function waitForLayoutReady(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        if (window.app.workspace.layoutReady) {
          res();
          return;
        }
        window.app.workspace.onLayoutReady(() => res());
      }),
  );
}

export async function openFile(page: Page, vaultRelativePath: string): Promise<void> {
  await waitForLayoutReady(page);
  await page.evaluate(async (path) => {
    await window.app.workspace.openLinkText(path, "");
  }, vaultRelativePath);
}

export async function isPluginEnabled(page: Page, id: string): Promise<boolean> {
  return page.evaluate((pluginId) => window.app.plugins.enabledPlugins.has(pluginId), id);
}

export async function ensurePluginEnabled(page: Page, id: string): Promise<void> {
  await waitForLayoutReady(page);
  await page.evaluate(async (pluginId) => {
    if (!window.app.plugins.enabledPlugins.has(pluginId)) {
      await window.app.plugins.setEnable(true);
      await window.app.plugins.enablePluginAndSave(pluginId);
    }
  }, id);
}

export async function getActiveFilePath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.app.workspace.getActiveFile?.()?.path ?? null);
}
