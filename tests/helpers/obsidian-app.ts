import type { Page } from "@playwright/test";

interface WorkspaceLeafLike {
  view?: { containerEl?: HTMLElement; getViewType?: () => string };
  setViewState(state: { type: string }): Promise<void>;
}

interface ObsidianApp {
  workspace: {
    openLinkText(linkpath: string, sourcePath: string): Promise<void>;
    activeLeaf?: { view?: { containerEl?: HTMLElement } };
    getActiveFile?: () => { path: string } | null;
    onLayoutReady(cb: () => void): void;
    layoutReady?: boolean;
    getLeavesOfType(type: string): WorkspaceLeafLike[];
    getLeftLeaf?(split: boolean): WorkspaceLeafLike | null;
    revealLeaf(leaf: WorkspaceLeafLike): void;
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
    close(): void;
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

/**
 * drawio-preview-mode 導入後、ファイルは既定でプレビュー表示になる。
 * エディタ挙動を検証する既存 E2E 用に、編集モードへ遷移させる。
 */
export async function enterDrawioEditor(page: Page): Promise<void> {
  await waitForLayoutReady(page);
  await page.evaluate(() => {
    window.app.commands.executeCommandById("obsidian-drawio:drawio-enter-editor");
  });
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

/** 設定モーダルを開き、指定プラグインの設定タブへ切り替える。 */
export async function openPluginSettings(page: Page, pluginId: string): Promise<void> {
  await waitForLayoutReady(page);
  await page.evaluate((id) => {
    window.app.setting.open();
    window.app.setting.openTabById(id);
  }, pluginId);
}

/** 設定モーダルを閉じる。 */
export async function closeSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.app.setting.close());
}

/** 指定プラグインの永続化済み drawio 設定オブジェクトを取得する。 */
export async function getDrawioSettings<T = Record<string, unknown>>(
  page: Page,
  pluginId: string,
): Promise<T> {
  return page.evaluate((id) => {
    const plugin = window.app.plugins.plugins[id] as
      | { settings?: { drawio?: unknown } }
      | undefined;
    return plugin?.settings?.drawio as T;
  }, pluginId);
}

/**
 * ファイルエクスプローラの leaf を確実に開いて表示状態にする。
 * 既定レイアウトに含まれていない場合は左サイドバーに生成する。
 */
export async function revealFileExplorer(page: Page): Promise<void> {
  await waitForLayoutReady(page);
  await page.evaluate(async () => {
    const ws = window.app.workspace;
    let leaves = ws.getLeavesOfType("file-explorer");
    if (leaves.length === 0) {
      const leaf = ws.getLeftLeaf?.(false);
      if (leaf) await leaf.setViewState({ type: "file-explorer" });
      leaves = ws.getLeavesOfType("file-explorer");
    }
    if (leaves[0]) ws.revealLeaf(leaves[0]);
  });
}
