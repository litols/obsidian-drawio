// @vitest-environment jsdom
/**
 * Tests for iframe-init/user-pref-hooks
 *
 * 本モジュールは drawio の内部 API (EditorUi / Graph / mxSettings) を monkey-patch
 * してプリファレンス変更を親へ通知する。drawio 本体は実環境にしか存在しないため、
 * ここでは host window 上に最小のスタブを置いて patch 動作を検証する。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installUserPrefHooks } from "./user-pref-hooks";

interface ParentStub {
  postMessage: ReturnType<typeof vi.fn>;
}

function makeParent(): ParentStub {
  return { postMessage: vi.fn() };
}

function readSent(parent: ParentStub): Array<Record<string, unknown>> {
  return parent.postMessage.mock.calls.map((c) => JSON.parse(c[0] as string));
}

describe("installUserPrefHooks", () => {
  let host: any;
  let parent: ParentStub;

  beforeEach(() => {
    // host はテスト内に閉じた擬似 window。setTimeout/setInterval は本物に委譲。
    host = {
      EditorUi: undefined,
      mxSettings: undefined,
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    };
    parent = makeParent();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("EditorUi が現れないままタイムアウトしても例外を投げない", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installUserPrefHooks({
      parentWindow: parent as unknown as Window,
      hostWindow: host,
      readyTimeoutMs: 10,
      pollIntervalMs: 1,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EditorUi did not appear within timeout"),
    );
    warnSpy.mockRestore();
  });

  it("EditorUi.prototype.init を patch し、init 呼び出し後に grid hook が貼られる", async () => {
    // EditorUi クラスとインスタンスを擬似化
    class FakeGraph {
      setGridEnabled(_v: boolean): void {
        // no-op
      }
    }
    class FakeEditor {
      graph = new FakeGraph();
    }
    class FakeEditorUi {
      editor = new FakeEditor();
      init(): void {
        // drawio 実装の init が裏で何かする想定。テストでは特に何もしない。
      }
    }
    host.EditorUi = FakeEditorUi;

    installUserPrefHooks({
      parentWindow: parent as unknown as Window,
      hostWindow: host,
      readyTimeoutMs: 200,
      pollIntervalMs: 1,
    });
    // class hook 反映待ち (ポーリングなので少し待つ)
    await new Promise((r) => setTimeout(r, 30));

    const ui = new FakeEditorUi();
    ui.init();

    // grid トグルを呼ぶ → userPrefChange(grid) が postMessage される
    ui.editor.graph.setGridEnabled(false);

    const sent = readSent(parent);
    const gridMsg = sent.find((m) => m["pref"] === "grid");
    expect(gridMsg).toEqual({ event: "userPrefChange", pref: "grid", value: false });
  });

  it("setCurrentTheme(dark) で theme 変更が親へ通知される", async () => {
    class FakeEditorUi {
      editor = { graph: { setGridEnabled: () => undefined } };
      init(): void {}
      setCurrentTheme(_value: string): void {
        // no-op
      }
    }
    host.EditorUi = FakeEditorUi;

    installUserPrefHooks({
      parentWindow: parent as unknown as Window,
      hostWindow: host,
      readyTimeoutMs: 200,
      pollIntervalMs: 1,
    });
    await new Promise((r) => setTimeout(r, 30));

    const ui = new FakeEditorUi();
    ui.init();
    ui.setCurrentTheme("dark");

    const sent = readSent(parent);
    const themeMsg = sent.find((m) => m["pref"] === "theme");
    expect(themeMsg).toEqual({
      event: "userPrefChange",
      pref: "theme",
      value: { setTheme: "dark", uiVariant: "dark" },
    });
  });

  it("mxSettings.save() 呼び出し時に現在のライブラリ集合を通知する", async () => {
    class FakeEditorUi {
      editor = { graph: { setGridEnabled: () => undefined } };
      init(): void {}
    }
    host.EditorUi = FakeEditorUi;
    // user-pref-hooks は内部で `window.mxSettings` を参照するため、jsdom の window に
    // mxSettings をぶら下げる必要がある。
    (window as any).mxSettings = {
      currentLibraries: "general;uml;flowchart",
      customLibraries: [],
      save(): void {
        /* drawio 実装では localStorage 保存 */
      },
    };

    installUserPrefHooks({
      parentWindow: parent as unknown as Window,
      hostWindow: host,
      readyTimeoutMs: 200,
      pollIntervalMs: 1,
    });
    await new Promise((r) => setTimeout(r, 30));

    const ui = new FakeEditorUi();
    ui.init();

    // ライブラリ集合を変更してから save
    (window as any).mxSettings.currentLibraries = "general;er";
    (window as any).mxSettings.save();

    const sent = readSent(parent);
    const libMsg = sent.find((m) => m["pref"] === "libraries");
    expect(libMsg).toEqual({
      event: "userPrefChange",
      pref: "libraries",
      value: { defaults: ["general", "er"], customs: [] },
    });

    // クリーンアップ
    delete (window as any).mxSettings;
  });

  it("ライブラリ集合に変化がなければ重複送信しない", async () => {
    class FakeEditorUi {
      editor = { graph: { setGridEnabled: () => undefined } };
      init(): void {}
    }
    host.EditorUi = FakeEditorUi;
    (window as any).mxSettings = {
      currentLibraries: "general",
      customLibraries: [],
      save(): void {},
    };

    installUserPrefHooks({
      parentWindow: parent as unknown as Window,
      hostWindow: host,
      readyTimeoutMs: 200,
      pollIntervalMs: 1,
    });
    await new Promise((r) => setTimeout(r, 30));

    new FakeEditorUi().init();
    // 値を変えずに2回 save
    (window as any).mxSettings.save();
    (window as any).mxSettings.save();

    const sent = readSent(parent);
    const libMsgs = sent.filter((m) => m["pref"] === "libraries");
    expect(libMsgs).toHaveLength(0);

    delete (window as any).mxSettings;
  });
});
