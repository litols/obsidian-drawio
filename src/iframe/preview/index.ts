/**
 * preview-init entry (task 3.1)
 *
 * viewer iframe 内で GraphViewer (viewer-static) を起動する init スクリプト。
 * bootstrap の {action:"script"} 機構で親から注入される IIFE。
 *
 * Lifecycle:
 *   1. ロード時に frame-globals を流用してグローバルを設定し、viewer-static が参照する
 *      window.DRAWIO_BASE_URL を設定する (viewer-static 注入より前に評価される前提)。
 *   2. {action:"render", xml, config} を受信したら data-mxgraph 要素を作り
 *      GraphViewer.createViewerForElement で描画する。
 *   3. 描画成功で {event:"preview-ready"}、失敗で {event:"preview-error", reason} を親へ通知する。
 *
 * Allowed imports (in-iframe IIFE build):
 *   - ../init/frame-globals / ../init/frame-messenger (in-iframe modules)
 *   - Browser globals only. NO obsidian / electron / node imports. NO src/lib import.
 *
 * Requirements: 1.3, 2.1, 2.2, 2.3, 2.4
 */

import { installFrameGlobals } from "../init/frame-globals";
import { createIframeFrameMessenger } from "../init/frame-messenger";

// ─── Ambient augmentation ────────────────────────────────────────────────────

declare global {
  interface Window {
    /** viewer-static が imageBaseUrl 算出に参照するベース URL */
    DRAWIO_BASE_URL?: string;
    /** viewer-static.min.js が公開する GraphViewer グローバル */
    GraphViewer?: {
      createViewerForElement: (element: Element, callback?: (viewer: unknown) => void) => void;
    };
  }
}

// ─── Message shapes ───────────────────────────────────────────────────────────

interface RenderMessage {
  readonly action: "render";
  readonly xml: string;
  /** GraphViewer graphConfig の上書き (toolbar トークン等) */
  readonly config?: Record<string, unknown>;
}

interface UnknownInbound {
  readonly action: string;
  readonly [key: string]: unknown;
}

type Inbound = RenderMessage | UnknownInbound;

interface PreviewOutbound {
  readonly event: "preview-ready" | "preview-error";
  readonly reason?: string;
}

/**
 * GraphViewer graphConfig の基準値。
 * toolbar は pages / zoom / layers トークンでズーム・パン・ページ切替・レイヤを提供し、
 * auto-fit で初期フィット表示する (要件 2.1-2.4)。
 */
const DEFAULT_GRAPH_CONFIG: Record<string, unknown> = {
  toolbar: "pages zoom layers",
  "toolbar-nofullscreen": true,
  // プレビューペインでは toolbar を常時表示する (既定の hover 自動非表示を無効化)。
  "toolbar-nohide": true,
  nav: true,
  // resize:true は GraphViewer にコンテナを図の内容サイズへ縮小させてしまう。
  // resize:false + auto-fit + コンテナの明示 height(100%) で、コンテナ全体を占有しつつ
  // 図を領域内にフィット表示する (要件 2.6)。center で領域内に中央寄せする。
  resize: false,
  center: true,
  "auto-fit": true,
};

// ─── Gestures (要件 2.7, 2.8) ───────────────────────────────────────────────────
// 画像プレビュー経路 (zoom-pan.ts) と同一のクランプ・感度に揃える。preview-init は
// src/lib を import できないため定数を複製する (値は zoom-pan.ts と一致させること)。
const PREVIEW_MIN_SCALE = 0.1;
const PREVIEW_MAX_SCALE = 10;
const WHEEL_ZOOM_FACTOR = 1.1;

interface MxGraphView {
  scale: number;
  translate: { x: number; y: number };
  setTranslate(dx: number, dy: number): void;
  scaleAndTranslate(scale: number, dx: number, dy: number): void;
}

interface MxGraph {
  view: MxGraphView;
  container: HTMLElement;
}

interface GraphViewerInstance {
  graph?: MxGraph;
}

export function clampPreviewScale(scale: number): number {
  if (Number.isNaN(scale)) return PREVIEW_MIN_SCALE;
  return Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, scale));
}

/**
 * カーソル位置を不変点として graph をズームする (要件 2.7)。
 * mxGraph 座標系: screen = (graph + translate) * scale。
 */
export function zoomGraphAtCursor(
  graph: MxGraph,
  factor: number,
  clientX: number,
  clientY: number,
): void {
  const view = graph.view;
  const s = view.scale;
  const s2 = clampPreviewScale(s * factor);
  if (s2 === s) return;
  const rect = graph.container.getBoundingClientRect();
  const px = clientX - rect.left + graph.container.scrollLeft;
  const py = clientY - rect.top + graph.container.scrollTop;
  const t = view.translate;
  const gx = px / s - t.x;
  const gy = py / s - t.y;
  // 新スケール後もカーソル直下の graph 座標が同じ画面位置に来るよう translate を補正。
  view.scaleAndTranslate(s2, px / s2 - gx, py / s2 - gy);
}

/** 画面 px 単位の移動量で graph をパンする (要件 2.8)。 */
export function panGraphBy(graph: MxGraph, dxScreen: number, dyScreen: number): void {
  const view = graph.view;
  const t = view.translate;
  view.setTranslate(t.x + dxScreen / view.scale, t.y + dyScreen / view.scale);
}

/**
 * GraphViewer プレビューに画像経路と同等のジェスチャを配線する。
 * - ctrlKey/metaKey wheel (トラックパッドのピンチ含む) → カーソル基準ズーム
 * - 修飾キーなし wheel → 2 本指スクロールパン (preventDefault でページスクロール抑止)
 * - 左ドラッグ → ポインタ差分を **wheel スクロールパンと同一の `view.setTranslate` 移動**で適用する。
 *   mxGraph の panningHandler (キャンバス DOM ごと CSS オフセット = 枠ごと動く) は使わない。
 * toolbar (pages / zoom) は従来どおり併存する。
 */
export function wireGraphGestures(graph: MxGraph): void {
  const container = graph.container;

  container.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        zoomGraphAtCursor(graph, factor, e.clientX, e.clientY);
      } else {
        panGraphBy(graph, -e.deltaX, -e.deltaY);
      }
    },
    { passive: false },
  );

  // ドラッグパン: ポインタ差分を view.setTranslate で適用 (画像経路 ImagePreview のドラッグと
  // 同じく content がカーソルに追従。枠ごと動く panningHandler は使わない)。
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  container.style.cursor = "grab";

  container.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return; // 左ボタンのみ
    // toolbar (pages/zoom) は container 内 (SVG の兄弟) に配置されるため、SVG キャンバス
    // 内から発生した pointerdown のみドラッグ開始する。これをしないと toolbar ボタン上の
    // pointerdown がドラッグ開始 + setPointerCapture で click を潰す (回帰対策)。
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== "function" || !target.closest("svg")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      container.setPointerCapture?.(e.pointerId);
    } catch {
      // 無効な pointerId (合成イベント等) では捕捉できないが無視してドラッグは継続。
    }
    container.style.cursor = "grabbing";
    e.preventDefault();
  });

  container.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    panGraphBy(graph, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try {
      container.releasePointerCapture?.(e.pointerId);
    } catch {
      // 同上
    }
    container.style.cursor = "grab";
  };
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function renderViewer(win: Window, xml: string, config?: Record<string, unknown>): void {
  const graphViewer = win.GraphViewer;
  if (!graphViewer || typeof graphViewer.createViewerForElement !== "function") {
    throw new Error("GraphViewer is not available (viewer-static not injected)");
  }

  const doc = win.document;
  // 既存の描画があれば差し替える (再 render に備える)
  const previous = doc.querySelector("[data-drawio-preview-host]");
  if (previous) previous.remove();

  // background は GraphViewer graphConfig ではなく iframe の背景として適用する (要件 6.6)。
  const { background, ...restConfig } = config ?? {};
  if (typeof background === "string" && background !== "") {
    doc.body.style.background = background;
  }

  const host = doc.createElement("div");
  host.setAttribute("data-drawio-preview-host", "");
  host.className = "mxgraph";
  host.style.maxWidth = "100%";
  host.style.width = "100%";
  host.style.height = "100%";
  if (typeof background === "string" && background !== "") {
    host.style.background = background;
  }

  const graphConfig = { ...DEFAULT_GRAPH_CONFIG, ...restConfig, xml };
  host.setAttribute("data-mxgraph", JSON.stringify(graphConfig));
  doc.body.appendChild(host);

  // viewer 生成後に graph へジェスチャを配線する (要件 2.7, 2.8)。
  graphViewer.createViewerForElement(host, (viewer: unknown) => {
    const graph = (viewer as GraphViewerInstance | null)?.graph;
    if (!graph) return;
    try {
      wireGraphGestures(graph);
    } catch (err) {
      console.warn("[drawio-preview] gesture wiring failed:", err);
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BootstrapPreviewInitInput {
  readonly selfWindow: Window;
  readonly parentWindow: Window;
}

/**
 * preview iframe の init シーケンスを配線する。
 * 戻り値はテストクリーンアップ用の dispose 関数。
 */
export function bootstrapPreviewInit(input: BootstrapPreviewInitInput): () => void {
  const { selfWindow, parentWindow } = input;

  // viewer-static が要求するグローバルを設定 (mxLoadResources / isLocalStorage / urlParams 等)。
  // viewer iframe にはアセット表を渡さないため loadScript は既定の script 要素生成に留める。
  installFrameGlobals({
    urlParams: {},
    loadScript: (src: string, onLoad?: () => void): void => {
      const script = selfWindow.document.createElement("script");
      if (onLoad) script.addEventListener("load", () => onLoad());
      script.src = src;
      selfWindow.document.head.appendChild(script);
    },
  });

  // viewer-static の imageBaseUrl 算出のため DRAWIO_BASE_URL を設定 (viewer 注入前に確定させる)。
  if (typeof selfWindow.DRAWIO_BASE_URL !== "string") {
    selfWindow.DRAWIO_BASE_URL = ".";
  }

  const messenger = createIframeFrameMessenger<Inbound, PreviewOutbound>({
    selfWindow,
    parentWindow,
  });

  let rendered = false;

  const unregister = messenger.onMessage((msg: Inbound) => {
    if (msg.action !== "render") return;
    if (rendered) return;
    rendered = true;

    const { xml, config } = msg as RenderMessage;
    try {
      renderViewer(selfWindow, xml, config);
      messenger.send({ event: "preview-ready" });
    } catch (err) {
      messenger.send({ event: "preview-error", reason: String(err) });
    }
  });

  return (): void => {
    unregister();
    messenger.destroy();
  };
}

// ─── Auto-execution ───────────────────────────────────────────────────────────
// Only runs when loaded as the real in-iframe script. In jsdom tests,
// window.parent === window so this block is skipped.
if (typeof window !== "undefined" && window.parent !== window) {
  bootstrapPreviewInit({ selfWindow: window, parentWindow: window.parent });
}
