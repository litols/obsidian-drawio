// @vitest-environment jsdom
/**
 * main.ts の編集導線テスト。
 * 「draw.io で編集」/「新規ダイアグラム」が setViewState に state.mode="editor" を渡し、
 * エディタで直接開くことを検証する (要件 4.3 の導線整合)。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
  Plugin: class {
    app: unknown;
    manifest: unknown;
    constructor(app?: unknown, manifest?: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
  },
  Notice: class {},
  Events: class {},
  TFile: class {},
  setIcon: () => {},
}));
vi.mock("./views/DrawioView", () => ({ DrawioView: class {}, DRAWIO_VIEW_TYPE: "drawio" }));
vi.mock("./views/SettingsTab", () => ({ DrawioSettingTab: class {} }));
vi.mock("./views/DiagramSettingsModal", () => ({ DiagramSettingsModal: class {} }));
vi.mock("./lib/external-watcher", () => ({ createExternalWatcher: () => ({}) }));
vi.mock("./lib/theme-bridge", () => ({ createThemeBridge: () => ({}) }));
vi.mock("./lib/react-mount", () => ({ createReactMountManager: () => ({}) }));
vi.mock("./lib/drawio-asset-cache", () => ({ createDrawioAssetCache: () => ({}) }));
vi.mock("./lib/per-diagram-config", () => ({ registerPerDiagramConfigLifecycle: () => {} }));
vi.mock("./lib/plugin-api", () => ({
  createDrawioPluginApi: () => ({ api: {}, dispose: () => {} }),
}));
vi.mock("./lib/drawio-embed", () => ({ registerDrawioEmbedPreview: () => () => {} }));
vi.mock("./commands/demo-command", () => ({ registerDemoCommand: () => {} }));
vi.mock("./lib/i18n", () => ({ initI18n: () => {}, t: (k: string) => k }));

import ObsidianDrawioPlugin from "./main";

interface SetViewStateArg {
  type: string;
  active?: boolean;
  state?: { file?: string; mode?: string };
}

interface TestPlugin {
  app: unknown;
  openInDrawioView(file: unknown, options?: { mode?: string }): Promise<void>;
  createNewDiagram(): Promise<void>;
}

function makePlugin() {
  const setViewState = vi.fn(async (_arg: SetViewStateArg) => {});
  const leaf = { setViewState };
  const create = vi.fn(async (p: string) => ({ path: p, name: p }));
  const app = {
    workspace: {
      getLeaf: vi.fn(() => leaf),
      revealLeaf: vi.fn(),
      getActiveFile: () => null,
    },
    fileManager: { getNewFileParent: () => ({ path: "" }) },
    vault: { getAbstractFileByPath: () => null, create },
  };
  const plugin = Object.create(ObsidianDrawioPlugin.prototype) as unknown as TestPlugin;
  plugin.app = app;
  return { plugin, setViewState, create };
}

describe("編集導線はエディタで開く", () => {
  it("openInDrawioView(file, {mode:'editor'}) は state.mode=editor を渡す (コンテキストメニュー導線)", async () => {
    const { plugin, setViewState } = makePlugin();
    await plugin.openInDrawioView({ path: "a.drawio", name: "a.drawio" } as never, {
      mode: "editor",
    });
    const arg = setViewState.mock.calls[0]![0];
    expect(arg.state?.mode).toBe("editor");
  });

  it("openInDrawioView(file) は mode を渡さない (通常オープンは defaultOpenMode に従う)", async () => {
    const { plugin, setViewState } = makePlugin();
    await plugin.openInDrawioView({ path: "a.drawio", name: "a.drawio" } as never);
    const arg = setViewState.mock.calls[0]![0];
    expect(arg.state?.mode).toBeUndefined();
  });

  it("新規ダイアグラム作成はエディタで開く (新規ダイアグラム導線)", async () => {
    const { plugin, setViewState } = makePlugin();
    await plugin.createNewDiagram();
    const arg = setViewState.mock.calls[0]![0];
    expect(arg.state?.mode).toBe("editor");
  });
});
