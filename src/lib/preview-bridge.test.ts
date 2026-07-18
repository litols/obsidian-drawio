// @vitest-environment jsdom
/**
 * preview-bridge のユニットテスト。
 * frame メッセージングをモックし、mount→ready 到達 / error / timeout 分岐 /
 * dispose 時の iframe 破棄を検証する (preview-init の実体には依存しない)。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPreviewBridge } from "./preview-bridge";
import type { DrawioAssetCache } from "./drawio-asset-cache";
import type { DataAdapter } from "obsidian";

const PREVIEW_INIT_SOURCE = "console.log('preview-init')";
const VIEWER_SCRIPT = "console.log('viewer-static')";

function buildDeps() {
  const cache = {
    loadAll: vi.fn(),
    getViewerScript: vi.fn().mockResolvedValue(VIEWER_SCRIPT),
    invalidate: vi.fn(),
    dispose: vi.fn(),
  } as unknown as DrawioAssetCache;
  const adapter = {
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path.includes("preview-init.js")) return PREVIEW_INIT_SOURCE;
      return "";
    }),
  } as unknown as DataAdapter;
  return { cache, adapter };
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function simulateIframeMessage(source: WindowProxy | null, data: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: source as Window,
      data: JSON.stringify(data),
      origin: "null",
    }),
  );
}

function getIframe(container: HTMLElement): HTMLIFrameElement | null {
  return container.querySelector("iframe[data-drawio-preview]");
}

describe("createPreviewBridge", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (container.parentNode) container.remove();
    vi.restoreAllMocks();
  });

  it("mount は data:text/html iframe を生成する", async () => {
    const { cache, adapter } = buildDeps();
    const bridge = createPreviewBridge(cache, adapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile/>" });
    await flushAsync();

    const iframe = getIframe(container);
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toMatch(/^data:text\/html,/);
    expect(bridge.isMounted).toBe(false); // preview-ready 前
    bridge.dispose();
  });

  it("{event:'iframe'} で preview-init / viewer / render を順に postMessage する", async () => {
    const { cache, adapter } = buildDeps();
    const bridge = createPreviewBridge(cache, adapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile><diagram>a</diagram></mxfile>" });
    await flushAsync();

    const iframe = getIframe(container)!;
    const spy = vi.spyOn(iframe.contentWindow!, "postMessage");
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });

    const msgs = spy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const scripts = msgs.filter((m) => m["action"] === "script");
    expect(scripts.some((m) => m["script"] === PREVIEW_INIT_SOURCE)).toBe(true);
    expect(scripts.some((m) => m["script"] === VIEWER_SCRIPT)).toBe(true);
    const render = msgs.find((m) => m["action"] === "render");
    expect(render).toBeDefined();
    expect(render!["xml"]).toBe("<mxfile><diagram>a</diagram></mxfile>");

    bridge.dispose();
  });

  it("{event:'preview-ready'} で isMounted=true かつ onReady 呼び出し", async () => {
    const { cache, adapter } = buildDeps();
    const onReady = vi.fn();
    const bridge = createPreviewBridge(cache, adapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile/>", callbacks: { onReady } });
    await flushAsync();

    const iframe = getIframe(container)!;
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    simulateIframeMessage(iframe.contentWindow, { event: "preview-ready" });

    expect(bridge.isMounted).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("{event:'preview-error'} で onError 呼び出し + iframe 破棄", async () => {
    const { cache, adapter } = buildDeps();
    const onError = vi.fn();
    const bridge = createPreviewBridge(cache, adapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile/>", callbacks: { onError } });
    await flushAsync();

    const iframe = getIframe(container)!;
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    simulateIframeMessage(iframe.contentWindow, { event: "preview-error", reason: "boom" });

    expect(onError).toHaveBeenCalledWith("boom");
    expect(getIframe(container)).toBeNull();
    expect(bridge.isMounted).toBe(false);
    bridge.dispose();
  });

  it("bootstrap タイムアウトで onError", async () => {
    vi.useFakeTimers();
    try {
      const { cache, adapter } = buildDeps();
      const onError = vi.fn();
      const bridge = createPreviewBridge(cache, adapter, "test-plugin");
      bridge.mount(container, { xml: "<mxfile/>", callbacks: { onError } });
      // async mount IIFE を進める
      await vi.advanceTimersByTimeAsync(0);
      // {event:'iframe'} を送らずタイムアウトさせる
      await vi.advanceTimersByTimeAsync(5_001);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toContain("bootstrap");
      bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("render タイムアウト (preview-ready 未達) で onError", async () => {
    vi.useFakeTimers();
    try {
      const { cache, adapter } = buildDeps();
      const onError = vi.fn();
      const bridge = createPreviewBridge(cache, adapter, "test-plugin");
      bridge.mount(container, { xml: "<mxfile/>", callbacks: { onError } });
      await vi.advanceTimersByTimeAsync(0);
      const iframe = getIframe(container)!;
      simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toContain("preview-ready");
      bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose で iframe が破棄される", async () => {
    const { cache, adapter } = buildDeps();
    const bridge = createPreviewBridge(cache, adapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile/>" });
    await flushAsync();
    expect(getIframe(container)).not.toBeNull();
    bridge.dispose();
    expect(getIframe(container)).toBeNull();
  });

  it("アセット読み込み失敗で onError", async () => {
    const { cache } = buildDeps();
    const failingAdapter = {
      read: vi.fn().mockRejectedValue(new Error("read fail")),
    } as unknown as DataAdapter;
    const onError = vi.fn();
    const bridge = createPreviewBridge(cache, failingAdapter, "test-plugin");
    bridge.mount(container, { xml: "<mxfile/>", callbacks: { onError } });
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toContain("Preview asset loading failed");
  });
});
