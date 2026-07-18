/**
 * preview-bridge
 *
 * viewer iframe の親側ライフサイクル管理。bootstrap iframe を生成し、preview-init.js と
 * viewer-static スクリプトを注入して GraphViewer で XML を描画する。
 * 読み取り専用: ファイル書き込みに至る API を一切持たない (要件 2.5 の構造的保証)。
 *
 * State machine: idle → loading → ready | error → disposed
 *
 * Requirements: 1.3, 2.4, 2.5, 5.1
 */

import type { DataAdapter } from "obsidian";
import type { DrawioAssetCache } from "./drawio-asset-cache";
import { buildBootstrapHtml } from "./drawio-bootstrap-html";

const LOG_PREFIX = "[drawio-preview]";

// bootstrap iframe の {event:"iframe"} 待ち / render 後の ready 待ちのタイムアウト
const TIMEOUT_BOOTSTRAP_MS = 5_000;
const TIMEOUT_RENDER_MS = 10_000;

export interface PreviewBridgeCallbacks {
  onReady?: () => void;
  onError?: (reason: string) => void;
}

export interface PreviewBridgeMountOptions {
  xml: string;
  /** GraphViewer graphConfig に渡す表示設定 (toolbar トークン等) の上書き */
  config?: Record<string, unknown>;
  callbacks?: PreviewBridgeCallbacks;
}

export interface PreviewBridge {
  mount(container: HTMLElement, opts: PreviewBridgeMountOptions): void;
  dispose(): void;
  readonly isMounted: boolean;
}

type PreviewState = "idle" | "loading" | "ready" | "error" | "disposed";

interface RawPreviewMessage {
  readonly event?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export function createPreviewBridge(
  cache: DrawioAssetCache,
  adapter: DataAdapter,
  pluginDir?: string,
): PreviewBridge {
  let state: PreviewState = "idle";
  let iframe: HTMLIFrameElement | null = null;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let callbacks: PreviewBridgeCallbacks = {};
  let mounted = false;

  let bootstrapTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let renderTimeoutId: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (bootstrapTimeoutId !== null) {
      clearTimeout(bootstrapTimeoutId);
      bootstrapTimeoutId = null;
    }
    if (renderTimeoutId !== null) {
      clearTimeout(renderTimeoutId);
      renderTimeoutId = null;
    }
  }

  function teardownIframe(): void {
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    if (iframe) {
      iframe.src = "about:blank";
      iframe.remove();
      iframe = null;
    }
  }

  function transitionToError(reason: string): void {
    console.error(`${LOG_PREFIX} PreviewBridge error:`, reason);
    state = "error";
    mounted = false;
    clearTimers();
    teardownIframe();
    callbacks.onError?.(reason);
  }

  function disposeInternal(): void {
    if (state === "idle" || state === "disposed") {
      // 未マウント / 既に破棄済みでも iframe/handler の後始末は行う
      clearTimers();
      teardownIframe();
      state = "disposed";
      mounted = false;
      return;
    }
    clearTimers();
    teardownIframe();
    callbacks = {};
    state = "disposed";
    mounted = false;
  }

  function buildMessageHandler(
    iframeRef: { current: HTMLIFrameElement | null },
    previewInitSource: string,
    viewerScript: string,
    xml: string,
    config: Record<string, unknown> | undefined,
  ): (event: MessageEvent) => void {
    return function handleMessage(event: MessageEvent): void {
      const currentIframe = iframeRef.current;
      if (!currentIframe || event.source !== currentIframe.contentWindow) return;

      let raw: RawPreviewMessage;
      try {
        raw = JSON.parse(event.data as string) as RawPreviewMessage;
      } catch {
        return;
      }
      if (!("event" in raw)) return;

      if (state === "loading" && raw.event === "iframe") {
        if (bootstrapTimeoutId !== null) {
          clearTimeout(bootstrapTimeoutId);
          bootstrapTimeoutId = null;
        }
        const win = currentIframe.contentWindow;
        if (win) {
          // parent→iframe の script / render は structured clone オブジェクトのまま送る。
          // 1. preview-init IIFE を注入 (frame-globals + DRAWIO_BASE_URL 設定)
          win.postMessage({ action: "script", script: previewInitSource }, "*");
          // 2. viewer-static.min.js を注入 (GraphViewer を定義)
          win.postMessage({ action: "script", script: viewerScript }, "*");
          // 3. render 指示 (GraphViewer.createViewerForElement)
          win.postMessage({ action: "render", xml, config }, "*");
        }
        // render 完了 (preview-ready) を待つ
        renderTimeoutId = setTimeout(() => {
          transitionToError("Timeout waiting for {event:'preview-ready'}");
        }, TIMEOUT_RENDER_MS);
        return;
      }

      if (raw.event === "preview-ready") {
        state = "ready";
        mounted = true;
        clearTimers();
        callbacks.onReady?.();
        return;
      }

      if (raw.event === "preview-error") {
        transitionToError(
          typeof raw.reason === "string" ? raw.reason : "preview render failed",
        );
        return;
      }
    };
  }

  return {
    get isMounted(): boolean {
      return mounted;
    },

    mount(container: HTMLElement, opts: PreviewBridgeMountOptions): void {
      // 再 mount 時は先に内部 dispose する (drawio-bridge と同じ規律・同時マウント禁止)
      if (mounted || state === "loading") {
        disposeInternal();
      }

      state = "loading";
      mounted = false;
      callbacks = opts.callbacks ?? {};

      const previewInitPath = pluginDir ? `${pluginDir}/preview-init.js` : "preview-init.js";
      const iframeRef: { current: HTMLIFrameElement | null } = { current: null };

      void (async () => {
        let previewInitSource: string;
        let viewerScript: string;
        try {
          [previewInitSource, viewerScript] = await Promise.all([
            adapter.read(previewInitPath),
            cache.getViewerScript(),
          ]);
        } catch (err) {
          transitionToError(`Preview asset loading failed: ${String(err)}`);
          return;
        }

        // ロード中に dispose された場合は中断
        if (state !== "loading") return;

        const bootstrapHtml = buildBootstrapHtml();
        const newIframe = document.createElement("iframe");
        newIframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
        newIframe.setAttribute("data-drawio-preview", "");
        newIframe.style.width = "100%";
        newIframe.style.height = "100%";
        newIframe.style.border = "none";
        newIframe.src = "data:text/html," + encodeURIComponent(bootstrapHtml);

        iframe = newIframe;
        iframeRef.current = newIframe;

        const handler = buildMessageHandler(
          iframeRef,
          previewInitSource,
          viewerScript,
          opts.xml,
          opts.config,
        );
        messageHandler = handler;
        window.addEventListener("message", handler);

        bootstrapTimeoutId = setTimeout(() => {
          transitionToError("Timeout waiting for iframe bootstrap {event:'iframe'}");
        }, TIMEOUT_BOOTSTRAP_MS);

        container.appendChild(newIframe);
      })();
    },

    dispose(): void {
      disposeInternal();
    },
  };
}
