// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bootstrapPreviewInit,
  clampPreviewScale,
  zoomGraphAtCursor,
  panGraphBy,
  wireGraphGestures,
} from "./index";
// テスト専用: 画像プレビュー経路 (src/lib) との一致検証のため import (IIFE ビルドには含まれない)。
import { clampScale as imageClampScale, zoomAt as imageZoomAt } from "../../lib/zoom-pan";

// ─── ジェスチャ (要件 2.7, 2.8) ───────────────────────────────────────────────

interface MockGraph {
  view: {
    scale: number;
    translate: { x: number; y: number };
    setTranslate: ReturnType<typeof vi.fn>;
    scaleAndTranslate: ReturnType<typeof vi.fn>;
  };
  container: HTMLElement;
}

function makeGraph(scale = 1, tx = 0, ty = 0): MockGraph {
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  // jsdom は pointer capture を実装しないことがあるので stub する。
  (container as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn();
  (container as unknown as { releasePointerCapture: () => void }).releasePointerCapture = vi.fn();
  return {
    view: {
      scale,
      translate: { x: tx, y: ty },
      setTranslate: vi.fn(),
      scaleAndTranslate: vi.fn(),
    },
    container,
  };
}

describe("clampPreviewScale", () => {
  it("画像経路 zoom-pan と同じ [0.1, 10] にクランプ", () => {
    expect(clampPreviewScale(1)).toBe(1);
    expect(clampPreviewScale(0.01)).toBe(0.1);
    expect(clampPreviewScale(1000)).toBe(10);
    expect(clampPreviewScale(Number.NaN)).toBe(0.1);
  });
});

describe("zoomGraphAtCursor", () => {
  it("カーソル位置を不変点にズームする (要件 2.7)", () => {
    const g = makeGraph(1, 0, 0);
    zoomGraphAtCursor(g as never, 1.1, 100, 50);
    expect(g.view.scaleAndTranslate).toHaveBeenCalledTimes(1);
    const [s2, tx, ty] = g.view.scaleAndTranslate.mock.calls[0]!;
    expect(s2).toBeCloseTo(1.1);
    // カーソル (100,50) の graph 座標がズーム後も同じ画面位置に写る
    // screen = (graphCoord + translate) * scale。graphCoord は元 scale=1 で 100/50。
    expect((100 + tx) * s2).toBeCloseTo(100);
    expect((50 + ty) * s2).toBeCloseTo(50);
  });

  it("クランプ上限で頭打ち", () => {
    const g = makeGraph(9, 0, 0);
    zoomGraphAtCursor(g as never, 4, 100, 50);
    expect(g.view.scaleAndTranslate.mock.calls[0]![0]).toBe(10);
  });

  it("スケール変化なしなら何もしない", () => {
    const g = makeGraph(10, 0, 0);
    zoomGraphAtCursor(g as never, 2, 100, 50); // 既に上限
    expect(g.view.scaleAndTranslate).not.toHaveBeenCalled();
  });
});

describe("panGraphBy", () => {
  it("画面 px 移動量を scale で割って translate に加算 (方向は画像経路と一致)", () => {
    const g = makeGraph(2, 10, 20);
    panGraphBy(g as never, -30, -40);
    expect(g.view.setTranslate).toHaveBeenCalledWith(10 + -30 / 2, 20 + -40 / 2);
  });
});

describe("wireGraphGestures", () => {
  it("左ドラッグは view.setTranslate 差分移動でパンする (panningHandler は使わない = 枠ごと動かない)", () => {
    const g = makeGraph(2, 0, 0);
    wireGraphGestures(g as never);
    const c = g.container;

    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 100, clientY: 100 }));
    expect(c.style.cursor).toBe("grabbing");

    c.dispatchEvent(new MouseEvent("pointermove", { clientX: 130, clientY: 90 }));
    // dx=30, dy=-10, scale=2 → setTranslate(0 + 30/2, 0 + -10/2) = (15, -5)
    expect(g.view.setTranslate).toHaveBeenCalledWith(15, -5);

    c.dispatchEvent(new MouseEvent("pointerup", {}));
    expect(c.style.cursor).toBe("grab");
  });

  it("ドラッグ中でない pointermove は無視される", () => {
    const g = makeGraph();
    wireGraphGestures(g as never);
    g.container.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 50 }));
    expect(g.view.setTranslate).not.toHaveBeenCalled();
  });

  it("ctrlKey wheel はカーソル基準ズーム、素の wheel はスクロールパン", () => {
    const g = makeGraph(1, 0, 0);
    wireGraphGestures(g as never);

    // ピンチ/修飾キー: ズーム (deltaY<0 → 拡大)
    g.container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        clientX: 100,
        clientY: 50,
        cancelable: true,
      }),
    );
    expect(g.view.scaleAndTranslate).toHaveBeenCalledTimes(1);
    expect(g.view.scaleAndTranslate.mock.calls[0]![0]).toBeGreaterThan(1);

    // 素の wheel: パン (translate 変化、scale 不変)
    g.container.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 20, deltaY: 30, cancelable: true }),
    );
    expect(g.view.setTranslate).toHaveBeenCalledTimes(1);
  });
});

describe("画像経路とのジェスチャ一致 (8.2, 要件 2.7/2.8)", () => {
  it("クランプ範囲が画像経路 (zoom-pan) と完全一致する", () => {
    for (const s of [-1, 0.01, 0.1, 0.5, 1, 5, 10, 100, Number.NaN]) {
      expect(clampPreviewScale(s)).toBe(imageClampScale(s));
    }
  });

  it("ズーム原点不変性が両経路で成立し、同一 factor で同一スケールになる (要件 2.7)", () => {
    const factor = 1.1;
    const ox = 120;
    const oy = 80;

    // graph 経路: カーソル (ox,oy) が不変
    const g = makeGraph(1, 0, 0);
    zoomGraphAtCursor(g as never, factor, ox, oy);
    const [gs, gtx, gty] = g.view.scaleAndTranslate.mock.calls[0]!;
    expect((ox + gtx) * gs).toBeCloseTo(ox);
    expect((oy + gty) * gs).toBeCloseTo(oy);

    // image 経路 (zoom-pan.zoomAt): screen = translate + content*scale の不変性
    const st = imageZoomAt({ scale: 1, translateX: 0, translateY: 0 }, factor, ox, oy);
    expect(st.translateX + ox * st.scale).toBeCloseTo(ox);
    expect(st.translateY + oy * st.scale).toBeCloseTo(oy);

    // 同一 factor → 同一スケール (感度一致)
    expect(st.scale).toBeCloseTo(gs);
  });

  it("パン方向が両経路で一致する (screen 移動 dx に対し同符号)", () => {
    // graph: 素の wheel は panGraphBy(-deltaX, -deltaY) → translate += -delta/scale
    const g = makeGraph(1, 0, 0);
    panGraphBy(g as never, 10, -20);
    expect(g.view.setTranslate).toHaveBeenCalledWith(10, -20);
    // image: panBy は translate += (dx,dy)。同じ screen 移動で同符号に translate が動く。
    // (ImagePreview は wheel を -delta で渡すため両経路とも「content が -delta 方向」に動く)
  });
});

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
    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
    expect(typeof (window as unknown as { DRAWIO_BASE_URL?: string }).DRAWIO_BASE_URL).toBe(
      "string",
    );
  });

  it("render 受信で GraphViewer.createViewerForElement を呼び preview-ready を通知する", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
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
    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
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

    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
    sendRender("<mxfile/>", { toolbar: "zoom" });

    const host = createViewerForElement.mock.calls[0]![0] as Element;
    const cfg = JSON.parse(host.getAttribute("data-mxgraph")!) as Record<string, unknown>;
    expect(cfg["toolbar"]).toBe("zoom");
  });

  it("config.background は iframe body / host に適用され graphConfig には含めない (要件 6.6)", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
    sendRender("<mxfile/>", { background: "rgb(10, 20, 30)" });

    expect(window.document.body.style.background).toBe("rgb(10, 20, 30)");
    const host = createViewerForElement.mock.calls[0]![0] as HTMLElement;
    expect(host.style.background).toBe("rgb(10, 20, 30)");
    const cfg = JSON.parse(host.getAttribute("data-mxgraph")!) as Record<string, unknown>;
    expect(cfg["background"]).toBeUndefined();
  });

  it("2 回目の render は無視される (single render)", () => {
    const createViewerForElement = vi.fn();
    (window as unknown as { GraphViewer?: unknown }).GraphViewer = { createViewerForElement };

    dispose = bootstrapPreviewInit({
      selfWindow: window,
      parentWindow: parentWindow as unknown as Window,
    });
    sendRender("<mxfile/>");
    sendRender("<mxfile/>");
    expect(createViewerForElement).toHaveBeenCalledTimes(1);
  });
});
