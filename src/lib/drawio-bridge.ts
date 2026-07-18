/**
 * drawio-bridge
 *
 * Orchestrates the drawio iframe lifecycle using a data:text/html bootstrap
 * with postMessage script injection (no app:// URL dependency).
 *
 * State machine: idle → loading → bootstrapped → configuring → ready | error → disposed
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.3, 6.1, 6.2, 6.3
 */

import type { App } from "obsidian";
import type { DrawioInbound, DrawioInboundUserPrefChange, DrawioOutbound } from "./drawio-protocol";
import { buildDrawioUrl, type DrawioUrlOptions } from "./drawio-url";
import { createDrawioAssetLoader } from "./drawio-asset-loader";
import type { DrawioAssetProvider } from "./drawio-asset-cache";
import { buildBootstrapHtml } from "./drawio-bootstrap-html";
import { t } from "./i18n";

// ─── Public types (frozen — do not change) ───────────────────────────────────

// 'xmlpng' / 'xmlsvg' は mxfile XML を PNG/SVG バイナリに埋め込む drawio embed 標準 format (drawio-file-io 用)
export type DrawioExportFormat = "png" | "svg" | "xml" | "pdf" | "xmlpng" | "xmlsvg";

// 'light'/'dark' は obsidian テーマ → drawio `ui` 値 への logical alias
export type DrawioThemeMode = "light" | "dark" | "kennedy" | "atlas" | "min";

export interface DrawioBridgeCallbacks {
  onSave?: (xml: string, exit?: boolean) => void;
  onAutosave?: (xml: string) => void;
  onExport?: (data: string, format: string) => void;
  onExit?: (modified?: boolean) => void;
  // drawio エディタ内でユーザーが操作したプリファレンス (ライブラリ / テーマ / グリッド)
  // を反映するためのコールバック。詳細は drawio-protocol.ts の DrawioInboundUserPrefChange。
  onUserPrefChange?: (msg: DrawioInboundUserPrefChange) => void;
  /** bridge が ready ({event:"init"} 受信) に到達した後に呼ばれる。ready 前の
   *  sendMessage 警告を避けて初期テーマ適用等を行うためのフック。 */
  onReady?: () => void;
}

export interface DrawioBridgeMountOptions extends DrawioUrlOptions {
  initialXml?: string;
  callbacks?: DrawioBridgeCallbacks;
  /**
   * drawio embed の configure プロトコル payload。指定すると URL に configure=1 が付き、
   * 起動時に drawio が投げる {event:"configure"} に対して {action:"configure", config} で応答する。
   *
   * 代表的な key:
   *   - defaultLibraries: "aws4;general;..." (semicolon-joined) — Sidebar.defaultEntries
   *   - libraries: [{title, entries}] — Sidebar.customEntries (カスタムパレット)
   *   - enabledLibraries: string[] — More Shapes ダイアログで選択可能な built-in ID 白リスト
   */
  drawioConfig?: Record<string, unknown>;
}

export interface DrawioBridge {
  mount(container: HTMLElement, opts?: DrawioBridgeMountOptions): void;
  dispose(): void;
  load(xml: string): void;
  replaceContent(xml: string): void;
  requestSave(): void;
  requestExport(format: DrawioExportFormat): void;
  setTheme(theme: "light" | "dark"): void;
  sendMessage(msg: DrawioOutbound): void;
  readonly isMounted: boolean;
}

// ─── Internal state machine ──────────────────────────────────────────────────

type BridgeState =
  | "idle"
  | "loading"
  | "bootstrapped"
  | "configuring"
  | "ready"
  | "error"
  | "disposed";

/** Raw parsed message shape before discriminating by event/action */
interface RawMessage {
  readonly event?: string;
  readonly action?: string;
  readonly [key: string]: unknown;
}

// Timeout constants (internal — NOT exposed via DrawioBridgeMountOptions)
const TIMEOUT_IFRAME_EVENT_MS = 5_000;
// drawio's app.min.js bootstrap (parsing 9MB script + CSS apply + EditorUi
// construction) consistently takes > 5s on cold first-load in Obsidian.
// Use 15s to keep comfortable margin while keeping total mount budget short.
const TIMEOUT_INIT_EVENT_MS = 15_000;
// コア群のチャンク配信 (ack backpressure) 全体のタイムアウト。
const TIMEOUT_CORE_DELIVERY_MS = 30_000;

// ─── アセット段階配信 (OOM 対策, 要件 5.5/5.6) ────────────────────────────────
// 一括 postMessage (~110MB) をやめ、上限サイズのチャンク列で ack backpressure 配信する。
// 一度に構造化複製されるのは 1 チャンク分のみに抑えられ、renderer のメモリスパイクを回避する。
const ASSET_CHUNK_BYTES = 8 * 1024 * 1024;

interface AssetEntry {
  readonly mediaType: string;
  readonly href: string;
  readonly source: string;
}

interface AssetChunk {
  readonly action: "assets";
  readonly entries: AssetEntry[];
  readonly group: "core" | "tail";
  readonly final: boolean;
  readonly seq: number;
}

/**
 * テール群 (エディタ起動後に逐次配信する重量アセット) の href 判定。
 * それ以外はコア群 (起動に必要な styles/img/images/resources/mxgraph 等)。
 */
function isTailHref(href: string): boolean {
  return (
    href.startsWith("stencils/") ||
    href.startsWith("shapes/") ||
    href.startsWith("templates/") ||
    href.startsWith("math/") ||
    href.startsWith("math4/") ||
    href.startsWith("plugins/") ||
    href.includes("mermaid")
  );
}

/** entries をサイズ上限で分割し、group と連番 seq を振ったチャンク列を返す。 */
function buildAssetChunks(
  entries: readonly AssetEntry[],
  group: "core" | "tail",
  startSeq: number,
): AssetChunk[] {
  const chunks: AssetChunk[] = [];
  let cur: AssetEntry[] = [];
  let curSize = 0;
  let seq = startSeq;
  for (const e of entries) {
    if (cur.length > 0 && curSize + e.source.length > ASSET_CHUNK_BYTES) {
      chunks.push({ action: "assets", entries: cur, group, final: false, seq: seq++ });
      cur = [];
      curSize = 0;
    }
    cur.push(e);
    curSize += e.source.length;
  }
  if (cur.length > 0) {
    chunks.push({ action: "assets", entries: cur, group, final: false, seq: seq++ });
  }
  if (chunks.length > 0) {
    const last = chunks[chunks.length - 1]!;
    chunks[chunks.length - 1] = { ...last, final: true };
  }
  return chunks;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDrawioBridge(
  app: App,
  pluginDir?: string,
  assetProvider?: DrawioAssetProvider,
): DrawioBridge {
  let state: BridgeState = "idle";
  let iframe: HTMLIFrameElement | null = null;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let callbacks: DrawioBridgeCallbacks = {};
  let initialXml = "";
  let lastKnownXml = "";
  let mounted = false;
  let drawioConfig: Record<string, unknown> | null = null;

  // Indicator elements rendered into container
  let loadingIndicator: HTMLElement | null = null;
  let errorIndicator: HTMLElement | null = null;

  // Timeout handles
  let iframeEventTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let initEventTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let coreDeliveryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Asset loader instance (created fresh on each mount)
  let assetLoaderDispose: (() => void) | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clearTimeouts(): void {
    if (iframeEventTimeoutId !== null) {
      clearTimeout(iframeEventTimeoutId);
      iframeEventTimeoutId = null;
    }
    if (initEventTimeoutId !== null) {
      clearTimeout(initEventTimeoutId);
      initEventTimeoutId = null;
    }
    if (coreDeliveryTimeoutId !== null) {
      clearTimeout(coreDeliveryTimeoutId);
      coreDeliveryTimeoutId = null;
    }
  }

  function removeLoadingIndicator(): void {
    if (loadingIndicator) {
      loadingIndicator.remove();
      loadingIndicator = null;
    }
  }

  function renderError(container: HTMLElement): void {
    removeLoadingIndicator();
    const el = document.createElement("div");
    el.setAttribute("data-drawio-error", "");
    el.textContent = "drawio エディタの起動に失敗しました";
    el.style.padding = "8px";
    el.style.color = "var(--text-error, red)";
    container.appendChild(el);
    errorIndicator = el;
  }

  function transitionToError(container: HTMLElement | null, reason: string): void {
    console.error("[DrawioBridge] Error:", reason);
    state = "error";
    mounted = false;
    clearTimeouts();
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    if (iframe) {
      iframe.src = "about:blank";
      iframe.remove();
      iframe = null;
    }
    if (assetLoaderDispose) {
      assetLoaderDispose();
      assetLoaderDispose = null;
    }
    if (container) {
      renderError(container);
    }
  }

  function disposeInternal(): void {
    if (
      !mounted &&
      state !== "error" &&
      state !== "loading" &&
      state !== "bootstrapped" &&
      state !== "configuring"
    )
      return;
    clearTimeouts();
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    callbacks = {};
    initialXml = "";
    lastKnownXml = "";
    removeLoadingIndicator();
    if (errorIndicator) {
      errorIndicator.remove();
      errorIndicator = null;
    }
    if (iframe) {
      iframe.src = "about:blank";
      iframe.remove();
      iframe = null;
    }
    if (assetLoaderDispose) {
      assetLoaderDispose();
      assetLoaderDispose = null;
    }
    state = "disposed";
    mounted = false;
  }

  function sendMessageInternal(msg: DrawioOutbound): void {
    if (!mounted) {
      console.warn("[DrawioBridge] sendMessage() called before mount");
      return;
    }
    if (!iframe?.contentWindow) {
      console.warn("[DrawioBridge] sendMessage() called with null contentWindow");
      return;
    }
    iframe.contentWindow.postMessage(JSON.stringify(msg), "*");
  }

  /**
   * Extract URL params that buildDrawioUrl would add, as Record<string, string>.
   * We call buildDrawioUrl("?", opts) then parse the result.
   */
  function extractUrlParams(opts?: DrawioBridgeMountOptions): Record<string, string> {
    const raw = buildDrawioUrl("?", opts);
    // raw is "??embed=1&proto=json&..."  or "??..."
    const queryStart = raw.indexOf("?");
    if (queryStart === -1) return {};
    const query = raw.slice(queryStart + 1);
    const params = new URLSearchParams(query);
    const result: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Build the message handler for a specific mount session.
   * Captures iframeRef, containerRef, and opts by closure.
   */
  function buildMessageHandler(
    iframeRef: { current: HTMLIFrameElement | null },
    containerRef: HTMLElement,
    iframeInitSource: string,
    appJsSource: string,
    responses: ReadonlyArray<{ mediaType: string; href: string; source: string }>,
    urlParams: Record<string, string>,
    indexHtml: string,
  ): (event: MessageEvent) => void {
    // アセットをコア群/テール群に分けチャンク化する。コアは起動前に、テールは
    // {event:"init"} 後に、いずれも ack backpressure (1 チャンクずつ) で配信する。
    const coreChunks = buildAssetChunks(
      responses.filter((r) => !isTailHref(r.href)),
      "core",
      0,
    );
    const tailChunks = buildAssetChunks(
      responses.filter((r) => isTailHref(r.href)),
      "tail",
      coreChunks.length,
    );
    let coreAcked = 0;
    let tailAcked = 0;
    let appInjected = false;

    // structured clone オブジェクトのまま送る (JSON.stringify を排除)。
    const post = (msg: unknown): void => iframeRef.current?.contentWindow?.postMessage(msg, "*");

    function injectApp(): void {
      if (appInjected) return;
      appInjected = true;
      if (coreDeliveryTimeoutId !== null) {
        clearTimeout(coreDeliveryTimeoutId);
        coreDeliveryTimeoutId = null;
      }
      // drawio app.min.js を注入し App.main() を起動する。
      post({ action: "script", script: appJsSource });
      post({
        action: "script",
        script:
          "setTimeout(function(){ try { App.main(); } catch (e) { console.error('App.main() failed', e); } }, 0);",
      });
      initEventTimeoutId = setTimeout(() => {
        transitionToError(containerRef, "Timeout waiting for drawio {event:'init'}");
      }, TIMEOUT_INIT_EVENT_MS);
    }

    function startCoreDelivery(): void {
      if (coreChunks.length === 0) {
        injectApp();
        return;
      }
      post(coreChunks[0]);
      coreDeliveryTimeoutId = setTimeout(() => {
        transitionToError(containerRef, "Timeout during core asset delivery");
      }, TIMEOUT_CORE_DELIVERY_MS);
    }

    function startTailDelivery(): void {
      if (tailChunks.length > 0) post(tailChunks[0]);
    }

    function handleAssetAck(seq: number): void {
      if (seq < coreChunks.length) {
        coreAcked += 1;
        if (coreAcked < coreChunks.length) post(coreChunks[coreAcked]);
        else injectApp();
      } else {
        tailAcked += 1;
        if (tailAcked < tailChunks.length) post(tailChunks[tailAcked]);
      }
    }

    return function handleMessage(event: MessageEvent): void {
      const currentIframe = iframeRef.current;
      if (!currentIframe || event.source !== currentIframe.contentWindow) return;

      let raw: RawMessage;
      try {
        raw = JSON.parse(event.data as string) as RawMessage;
      } catch {
        console.warn("[DrawioBridge] Failed to parse message:", event.data);
        return;
      }

      // Discard action-only messages (from drawio webapp's internal postMessages)
      if (!("event" in raw)) return;

      // アセットチャンクの ack は状態に依らず配信ドライバへ回す (backpressure)。
      if (raw.event === "asset-ack") {
        handleAssetAck((raw as { seq?: number }).seq ?? 0);
        return;
      }

      switch (state) {
        case "loading":
          // Bootstrap iframe ready signal
          if (raw.event === "iframe") {
            state = "bootstrapped";
            clearTimeout(iframeEventTimeoutId ?? undefined);
            iframeEventTimeoutId = null;

            // 1. Inject in-iframe init IIFE
            post({ action: "script", script: iframeInitSource });
            // 2. Send configure (globals + indexHtml)。responses はチャンクで別送する。
            post({ action: "configure", urlParams, indexHtml });

            state = "configuring";

            // 3. コア群のチャンク配信を開始。完了 (最終コアチャンクの ack) で
            //    iframe が CSS を注入済みとなり、injectApp() が app 起動へ進む。
            startCoreDelivery();
          }
          break;

        case "bootstrapped":
          // Intermediate state — shouldn't receive drawio events here
          break;

        case "configuring":
          // drawio が urlParams.configure=="1" 起動時に投げてくる configure リクエスト。
          // これに応答することで Editor.configure(config) → Sidebar.defaultEntries 等が設定される。
          // configure リスナは drawio 側で 1 度受信すると remove されるので、post-init で
          // configure を再送しても効果はない。iframe 単位で正しく 1 回だけ応答する。
          if (raw.event === "configure") {
            // drawio webapp 向けの応答は JSON 文字列のまま。
            post(JSON.stringify({ action: "configure", config: drawioConfig ?? {} }));
            break;
          }
          // Wait for drawio's init event
          if (raw.event === "init") {
            state = "ready";
            clearTimeout(initEventTimeoutId ?? undefined);
            initEventTimeoutId = null;
            mounted = true;

            removeLoadingIndicator();

            // Send initial XML (drawio webapp 向けは JSON 文字列)。
            post(JSON.stringify({ action: "load", xml: initialXml }));

            // ready 到達後にフックを実行 (初期テーマ適用等)。sendMessage 警告を回避。
            callbacks.onReady?.();

            // 重量テール群を起動後にバックグラウンド逐次配信する。
            startTailDelivery();
          }
          break;

        case "ready":
          // Dispatch existing inbound event handling
          dispatchInboundEvent(raw as unknown as DrawioInbound);
          break;

        default:
          break;
      }
    };
  }

  function dispatchInboundEvent(msg: DrawioInbound): void {
    switch (msg.event) {
      case "init":
        // In ready state, a second init is treated as a reload
        sendMessageInternal({ action: "load", xml: initialXml });
        break;
      case "load":
        break;
      case "save":
        lastKnownXml = msg.xml;
        callbacks.onSave?.(msg.xml, msg.exit);
        break;
      case "autosave":
        lastKnownXml = msg.xml;
        callbacks.onAutosave?.(msg.xml);
        break;
      case "export":
        callbacks.onExport?.(msg.data, msg.format);
        break;
      case "exit":
        callbacks.onExit?.();
        break;
      case "dialog":
        console.warn("[DrawioBridge] dialog event (unhandled):", msg);
        break;
      case "prompt":
        console.warn("[DrawioBridge] prompt event (unhandled):", msg);
        break;
      case "userPrefChange":
        callbacks.onUserPrefChange?.(msg);
        break;
    }
  }

  // ── Public bridge object ──────────────────────────────────────────────────

  return {
    get isMounted(): boolean {
      return mounted;
    },

    mount(container: HTMLElement, opts?: DrawioBridgeMountOptions): void {
      // If already mounted, dispose first (existing behavior)
      if (mounted || state === "loading" || state === "bootstrapped" || state === "configuring") {
        disposeInternal();
      }

      state = "loading";
      callbacks = opts?.callbacks ?? {};
      initialXml = opts?.initialXml ?? "";
      lastKnownXml = initialXml;
      drawioConfig = opts?.drawioConfig ?? null;
      // drawioConfig を渡された場合は URL に configure=1 を強制的に付ける。
      // これがないと drawio は起動時に親へ {event:"configure"} を投げず、config が届かない。
      const optsWithConfigure: DrawioBridgeMountOptions | undefined =
        drawioConfig != null ? { ...opts, configure: true } : opts;

      // The loading/error indicators are absolutely positioned and centered;
      // give the container a positioning context if it has none.
      const containerPos = getComputedStyle(container).position;
      if (containerPos === "" || containerPos === "static") {
        container.style.position = "relative";
      }

      // Render centered loading spinner
      const loadingEl = document.createElement("div");
      loadingEl.setAttribute("data-drawio-loading", "");
      loadingEl.setAttribute("role", "progressbar");
      loadingEl.setAttribute("aria-label", t("view.drawio.loading"));
      const spinnerEl = document.createElement("div");
      spinnerEl.className = "drawio-loading-spinner";
      loadingEl.appendChild(spinnerEl);
      container.appendChild(loadingEl);
      loadingIndicator = loadingEl;

      // Determine drawio asset directory
      const drawioDir = pluginDir ? `${pluginDir}/drawio` : "drawio";
      const iframeInitPath = pluginDir ? `${pluginDir}/iframe-init.js` : "iframe-init.js";

      // アセット取得は注入された provider (DrawioAssetCache) 経由。未注入時のみ
      // 従来の自前ローダにフォールバックする (後方互換)。注入された cache は
      // main.ts が所有するため bridge からは dispose しない。
      let provider: DrawioAssetProvider;
      if (assetProvider) {
        provider = assetProvider;
        assetLoaderDispose = null;
      } else {
        const loader = createDrawioAssetLoader(app.vault.adapter, drawioDir);
        provider = loader;
        assetLoaderDispose = () => loader.dispose();
      }

      // Use a ref so the message handler closure can see the latest iframe
      const iframeRef: { current: HTMLIFrameElement | null } = { current: null };

      // Async mount sequence
      void (async () => {
        let iframeInitSource: string;
        let appJsSource: string;
        let responses: ReadonlyArray<{ mediaType: string; href: string; source: string }>;
        let indexHtml: string;

        try {
          // Load all drawio assets
          const bundle = await provider.loadAll();
          appJsSource = bundle.appJsSource;
          responses = bundle.responses;
          indexHtml = bundle.indexHtml;

          // Read iframe-init IIFE source
          iframeInitSource = await app.vault.adapter.read(iframeInitPath);
        } catch (err) {
          transitionToError(container, `Asset loading failed: ${String(err)}`);
          return;
        }

        // If state changed while loading (e.g. dispose was called), abort
        if (state !== "loading") return;

        const urlParams = extractUrlParams(optsWithConfigure);
        const bootstrapHtml = buildBootstrapHtml();

        // Create iframe
        const newIframe = document.createElement("iframe");
        newIframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
        newIframe.setAttribute("data-drawio", "");
        newIframe.style.width = "100%";
        newIframe.style.height = "100%";
        newIframe.style.border = "none";
        newIframe.src = "data:text/html," + encodeURIComponent(bootstrapHtml);

        iframe = newIframe;
        iframeRef.current = newIframe;

        // Install message handler before appending iframe to DOM
        const handler = buildMessageHandler(
          iframeRef,
          container,
          iframeInitSource,
          appJsSource,
          responses,
          urlParams,
          indexHtml,
        );
        messageHandler = handler;
        window.addEventListener("message", handler);

        // Set timeout for {event:"iframe"} signal
        iframeEventTimeoutId = setTimeout(() => {
          transitionToError(container, "Timeout waiting for iframe bootstrap {event:'iframe'}");
        }, TIMEOUT_IFRAME_EVENT_MS);

        // Append iframe (triggers load of data: URL)
        container.appendChild(newIframe);
      })();
    },

    dispose(): void {
      disposeInternal();
    },

    load(xml: string): void {
      sendMessageInternal({ action: "load", xml });
    },

    replaceContent(xml: string): void {
      sendMessageInternal({ action: "merge", xml });
    },

    requestSave(): void {
      sendMessageInternal({ action: "load", xml: lastKnownXml, autosave: 1 });
    },

    requestExport(format: DrawioExportFormat): void {
      sendMessageInternal({ action: "export", format });
    },

    setTheme(theme: "light" | "dark"): void {
      sendMessageInternal({
        action: "configure",
        config: { ui: theme === "dark" ? "dark" : "kennedy" },
      });
    },

    sendMessage(msg: DrawioOutbound): void {
      sendMessageInternal(msg);
    },
  };
}
