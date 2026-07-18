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
  resize: true,
  "auto-fit": true,
};

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

  const host = doc.createElement("div");
  host.setAttribute("data-drawio-preview-host", "");
  host.className = "mxgraph";
  host.style.maxWidth = "100%";
  host.style.width = "100%";
  host.style.height = "100%";

  const graphConfig = { ...DEFAULT_GRAPH_CONFIG, ...config, xml };
  host.setAttribute("data-mxgraph", JSON.stringify(graphConfig));
  doc.body.appendChild(host);

  graphViewer.createViewerForElement(host);
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
