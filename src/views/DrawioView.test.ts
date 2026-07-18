// @vitest-environment jsdom
/**
 * DrawioView モード状態機械の統合テスト。
 * bridge / readDrawioFile をモックし、初期マウント分岐 / editor→preview の save flush →
 * 再読込順序 / preview 中の external-change 3 分岐を検証する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── モック (vi.hoisted で共有スパイを用意) ─────────────────────────────
const h = vi.hoisted(() => ({
  createDrawioBridge: vi.fn(),
  createPreviewBridge: vi.fn(),
  readDrawioFile: vi.fn(),
  writeDrawioFile: vi.fn(),
  buildDrawioConfig: vi.fn(),
  resolveDrawioLanguage: vi.fn(),
  noticeCtor: vi.fn(),
}));

vi.mock("obsidian", () => {
  class FileView {
    leaf: { detach: () => void; [k: string]: unknown };
    app: unknown;
    file: unknown = null;
    contentEl: HTMLElement;
    constructor(leaf: { app: unknown; detach: () => void }) {
      this.leaf = leaf;
      this.app = leaf.app;
      this.contentEl = document.createElement("div");
    }
    addAction(_icon: string, _title: string, _cb: () => void): HTMLElement {
      return document.createElement("div");
    }
    async setState(_state: unknown, _result: unknown): Promise<void> {
      // 実 Obsidian の FileView.setState 相当 (ここでは no-op)
    }
  }
  class Notice {
    constructor(msg?: string) {
      h.noticeCtor(msg);
    }
  }
  return { FileView, Notice, setIcon: () => {} };
});

vi.mock("../lib/drawio-bridge", () => ({ createDrawioBridge: h.createDrawioBridge }));
vi.mock("../lib/preview-bridge", () => ({ createPreviewBridge: h.createPreviewBridge }));
vi.mock("../lib/library-bridge", () => ({ buildDrawioConfig: h.buildDrawioConfig }));
vi.mock("../lib/language-bridge", () => ({ resolveDrawioLanguage: h.resolveDrawioLanguage }));
vi.mock("./DiffModal", () => ({ DiffModal: class {} }));
vi.mock("../lib/drawio-formats", async (orig) => {
  const actual = await orig<typeof import("../lib/drawio-formats")>();
  return { ...actual, readDrawioFile: h.readDrawioFile, writeDrawioFile: h.writeDrawioFile };
});

import { DrawioView } from "./DrawioView";
import { ImagePreview } from "./preview/ImagePreview";
import type { ReadDrawioResult } from "../lib/drawio-formats";

// Obsidian は HTMLElement に .empty() を生やすが jsdom には無いので polyfill する。
(HTMLElement.prototype as unknown as { empty: () => void }).empty = function empty(
  this: HTMLElement,
): void {
  while (this.firstChild) this.removeChild(this.firstChild);
};

interface FakeFile {
  path: string;
  name: string;
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function makeEditorBridge() {
  const captured: { opts?: Record<string, unknown> } = {};
  const bridge = {
    mount: vi.fn((_c: HTMLElement, o: Record<string, unknown>) => {
      captured.opts = o;
    }),
    dispose: vi.fn(),
    load: vi.fn(),
    replaceContent: vi.fn(),
    requestSave: vi.fn(),
    requestExport: vi.fn(),
    setTheme: vi.fn(),
    sendMessage: vi.fn(),
    isMounted: true,
  };
  return { bridge, captured };
}

function makePreviewBridge() {
  const captured: { opts?: Record<string, unknown> } = {};
  const bridge = {
    mount: vi.fn((_c: HTMLElement, o: Record<string, unknown>) => {
      captured.opts = o;
    }),
    dispose: vi.fn(),
    isMounted: true,
  };
  return { bridge, captured };
}

function setup(defaultOpenMode: "preview" | "editor", read: ReadDrawioResult) {
  h.readDrawioFile.mockResolvedValue(read);
  h.writeDrawioFile.mockResolvedValue(undefined);
  h.buildDrawioConfig.mockResolvedValue({});
  h.resolveDrawioLanguage.mockReturnValue("en");

  const eventCbs: Array<(ev: unknown) => void> = [];
  const detach = vi.fn();
  const reactMount = {
    mount: vi.fn((_c: HTMLElement, _n: unknown) => vi.fn()),
    unmount: vi.fn(),
    unmountAll: vi.fn(),
  };
  const themeBridge = {
    registerBridge: vi.fn(),
    unregisterBridge: vi.fn(),
    applyTheme: vi.fn(),
  };
  const app = {
    vault: {
      getResourcePath: vi.fn(() => "app://resource/x?v=1"),
      adapter: { read: vi.fn() },
    },
  };
  const plugin = {
    settings: { drawio: { defaultOpenMode, language: "auto", externalSync: {} } },
    reactMountManager: reactMount,
    themeBridge,
    assetCache: {
      loadAll: vi.fn(),
      getViewerScript: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    },
    manifest: { dir: "plug" },
    externalWatcher: { registerSelfWrite: vi.fn() },
    events: {
      on: vi.fn((_name: string, cb: (ev: unknown) => void) => {
        eventCbs.push(cb);
        return {};
      }),
      offref: vi.fn(),
    },
  };
  const leaf = { app, detach };
  const view = new DrawioView(leaf as never, plugin as never);
  return { view, plugin, reactMount, themeBridge, app, eventCbs, detach };
}

const SINGLE_SVG: ReadDrawioResult = {
  xml: "<mxfile><diagram>a</diagram></mxfile>",
  format: "drawio-svg",
  compressed: false,
};
const XML_DOC: ReadDrawioResult = {
  xml: "<mxfile><diagram>a</diagram></mxfile>",
  format: "drawio",
  compressed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DrawioView 初期マウント分岐", () => {
  it("defaultOpenMode=editor はエディタ bridge をマウントする", async () => {
    const { bridge } = makeEditorBridge();
    h.createDrawioBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view } = setup("editor", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;

    await view.onLoadFile(file as never);

    expect(h.createDrawioBridge).toHaveBeenCalledTimes(1);
    expect(bridge.mount).toHaveBeenCalledTimes(1);
    expect(h.createPreviewBridge).not.toHaveBeenCalled();
    expect(view.currentMode).toBe("editor");
  });

  it("state.mode='editor' は defaultOpenMode=preview を上書きしてエディタで開く (編集導線)", async () => {
    const { bridge } = makeEditorBridge();
    h.createDrawioBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view } = setup("preview", XML_DOC); // 既定はプレビュー
    (view as unknown as { file: FakeFile }).file = file;

    // 「draw.io で編集」/「新規ダイアグラム」導線相当: state.mode=editor
    await view.setState({ file: file.path, mode: "editor" }, {} as never);
    await view.onLoadFile(file as never);

    expect(h.createDrawioBridge).toHaveBeenCalledTimes(1);
    expect(h.createPreviewBridge).not.toHaveBeenCalled();
    expect(view.currentMode).toBe("editor");
  });

  it("state.mode 上書きは 1 回のみ消費され、次回は defaultOpenMode に戻る", async () => {
    const { bridge: editor } = makeEditorBridge();
    h.createDrawioBridge.mockReturnValue(editor);
    const { bridge: preview } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(preview);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view } = setup("preview", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;

    await view.setState({ file: file.path, mode: "editor" }, {} as never);
    await view.onLoadFile(file as never);
    expect(view.currentMode).toBe("editor");

    // 2 回目 (setState 上書きなし) は既定の preview に戻る
    await view.onLoadFile(file as never);
    expect(view.currentMode).toBe("preview");
  });

  it("defaultOpenMode=preview かつ svg 単一ページは ImagePreview をマウントする", async () => {
    const file: FakeFile = { path: "a.drawio.svg", name: "a.drawio.svg" };
    const { view, reactMount, app } = setup("preview", SINGLE_SVG);
    (view as unknown as { file: FakeFile }).file = file;

    await view.onLoadFile(file as never);

    expect(h.createPreviewBridge).not.toHaveBeenCalled();
    expect(app.vault.getResourcePath).toHaveBeenCalledWith(file);
    expect(reactMount.mount).toHaveBeenCalledTimes(1);
    const node = reactMount.mount.mock.calls[0]![1] as { type: unknown };
    expect(node.type).toBe(ImagePreview);
    expect(view.currentMode).toBe("preview");
  });

  it("defaultOpenMode=preview かつ XML は PreviewBridge (GraphViewer) をマウントする", async () => {
    const { bridge } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view } = setup("preview", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;

    await view.onLoadFile(file as never);

    expect(h.createPreviewBridge).toHaveBeenCalledTimes(1);
    expect(bridge.mount).toHaveBeenCalledTimes(1);
    expect(h.createDrawioBridge).not.toHaveBeenCalled();
  });
});

describe("DrawioView editor→preview 遷移", () => {
  it("進行中の保存完了を待ってから再読込しプレビューをマウントする", async () => {
    const { bridge: editor, captured } = makeEditorBridge();
    h.createDrawioBridge.mockReturnValue(editor);
    const { bridge: preview } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(preview);

    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view } = setup("editor", XML_DOC);

    // setup が writeDrawioFile を上書きするので、その後に保留 mock を設定する。
    // 書込を保留させて save flush の待ちを観測する。
    let resolveWrite!: () => void;
    h.writeDrawioFile.mockReturnValue(
      new Promise<void>((r) => {
        resolveWrite = r;
      }),
    );
    (view as unknown as { file: FakeFile }).file = file;
    await view.onLoadFile(file as never);
    expect(h.readDrawioFile).toHaveBeenCalledTimes(1);

    // 進行中の autosave を発火 (writeDrawioFile が保留 → pendingSaves 未解決)
    const callbacks = captured.opts!["callbacks"] as { onAutosave: (xml: string) => void };
    callbacks.onAutosave("<mxfile><diagram>b</diagram></mxfile>");

    // プレビューへ遷移開始 (pendingSaves を待つのでまだ preview は出ない)
    const p = view.enterPreviewMode();
    await flush();
    expect(h.createPreviewBridge).not.toHaveBeenCalled();

    // 保存完了 → 遷移が進み再読込 + preview マウント
    resolveWrite();
    await p;
    expect(h.readDrawioFile).toHaveBeenCalledTimes(2); // onLoadFile + 遷移時の再読込
    expect(h.createPreviewBridge).toHaveBeenCalledTimes(1);
    expect(editor.dispose).toHaveBeenCalled();
    expect(view.currentMode).toBe("preview");
  });
});

describe("DrawioView プレビュー中の external-change", () => {
  it("modify は最新内容で再描画する", async () => {
    const { bridge } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view, eventCbs } = setup("preview", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;
    await view.onLoadFile(file as never);
    expect(h.createPreviewBridge).toHaveBeenCalledTimes(1);

    await eventCbs[0]!({ type: "modify", file });
    // remount で readDrawioFile 再実行 + preview 再マウント
    expect(h.readDrawioFile).toHaveBeenCalledTimes(2);
    expect(h.createPreviewBridge).toHaveBeenCalledTimes(2);
  });

  it("rename はファイル追跡を更新し再描画する", async () => {
    const { bridge } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const newFile: FakeFile = { path: "b.drawio", name: "b.drawio" };
    const { view, eventCbs } = setup("preview", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;
    await view.onLoadFile(file as never);

    await eventCbs[0]!({ type: "rename", oldPath: "a.drawio", file: newFile });
    expect((view as unknown as { file: FakeFile }).file).toBe(newFile);
    expect(h.createPreviewBridge).toHaveBeenCalledTimes(2);
  });

  it("delete は通知してビューを閉じる", async () => {
    const { bridge } = makePreviewBridge();
    h.createPreviewBridge.mockReturnValue(bridge);
    const file: FakeFile = { path: "a.drawio", name: "a.drawio" };
    const { view, eventCbs, detach } = setup("preview", XML_DOC);
    (view as unknown as { file: FakeFile }).file = file;
    await view.onLoadFile(file as never);

    await eventCbs[0]!({ type: "delete", file });
    expect(h.noticeCtor).toHaveBeenCalled();
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
