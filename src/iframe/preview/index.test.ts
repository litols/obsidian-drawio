// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapPreviewInit } from "./index";

describe("bootstrapPreviewInit", () => {
  let parentWindow: { postMessage: ReturnType<typeof vi.fn> };
  let dispose: (() => void) | null;

  beforeEach(() => {
    parentWindow = { postMessage: vi.fn() };
    dispose = null;
  });

  afterEach(() => {
    if (dispose) dispose();
    delete (window as unknown as { GraphViewer?: unknown }).GraphViewer;
    // クリーンアップ: 前テストが挿入した preview host を除去
    document.querySelectorAll("[data-drawio-preview-host]").forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  function sendRender(xml: string, config?: Record<string, unknown>): void {
    const event = new MessageEvent("message", {
      data: { action: "render", xml, config },
      source: parentWindow as unknown as MessageEventSource,
    });
    window.dispatchEvent(event);
  }

  it("DRAWIO_BASE_URL を設定する", () => {
    dispose = bootstrapPreviewInit({ selfWindow: window, parentWindow: parentWindow as unknown as Window });
    expect(typeof (window as unknown as { DRAWIO_BASE_URL?: string }).DRAWIO_BASE_URL).toBe("string");
  });

  it("render 受信で GraphViewer.createViewerForElement を呼び preview-ready を通知する", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({ selfWindow: window, parentWindow: parentWindow as unknown as Window });
    sendRender("<mxfile><diagram>a</diagram></mxfile>");

    expect(createViewerForElement).toHaveBeenCalledTimes(1);
    // data-mxgraph に xml と toolbar が入っている
    const host = createViewerForElement.mock.calls[0]![0] as Element;
    const cfg = JSON.parse(host.getAttribute("data-mxgraph")!) as Record<string, unknown>;
    expect(cfg["xml"]).toBe("<mxfile><diagram>a</diagram></mxfile>");
    expect(cfg["toolbar"]).toBe("pages zoom layers");

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "preview-ready" }),
      "*",
    );
  });

  it("GraphViewer 不在なら preview-error を通知する", () => {
    // GraphViewer をセットしない
    dispose = bootstrapPreviewInit({ selfWindow: window, parentWindow: parentWindow as unknown as Window });
    sendRender("<mxfile/>");

    const call = parentWindow.postMessage.mock.calls.find((c) => {
      const parsed = JSON.parse(c[0] as string) as { event?: string };
      return parsed.event === "preview-error";
    });
    expect(call).toBeDefined();
  });

  it("config で toolbar 等を上書きできる", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({ selfWindow: window, parentWindow: parentWindow as unknown as Window });
    sendRender("<mxfile/>", { toolbar: "zoom" });

    const host = createViewerForElement.mock.calls[0]![0] as Element;
    const cfg = JSON.parse(host.getAttribute("data-mxgraph")!) as Record<string, unknown>;
    expect(cfg["toolbar"]).toBe("zoom");
  });

  it("2 回目の render は無視される (single render)", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({ selfWindow: window, parentWindow: parentWindow as unknown as Window });
    sendRender("<mxfile/>");
    sendRender("<mxfile/>");
    expect(createViewerForElement).toHaveBeenCalledTimes(1);
  });
});
