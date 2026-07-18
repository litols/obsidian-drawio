/**
 * iframe-init entry (task 3.1)
 *
 * In-iframe initialisation entry point. Bundles RequestManager, FrameGlobals,
 * and FrameMessenger into an IIFE that is injected by the parent via the
 * bootstrap's {action:"script"} mechanism.
 *
 * Lifecycle:
 *   1. Constructs an IframeFrameMessenger listening for {action:"configure"}.
 *   2. On configure receive: installs frame-globals and request-manager, then
 *      logs console.debug("[drawio-frame] configured").
 *   3. Auto-executes only when running as the real in-iframe script
 *      (window.parent !== window). In test environments (jsdom), auto-execution
 *      is skipped and bootstrapIframeInit() is called explicitly with injected
 *      mock windows.
 *
 * Idempotency: receiving {action:"configure"} twice → second call is a no-op.
 * Rationale: configure is expected exactly once per iframe lifetime; a second
 * configure would risk re-patching DOM prototypes (RequestManager.interceptRequests
 * is already idempotent, but globals re-installation is harmless). For safety and
 * predictability, the first configure wins and subsequent ones emit a console.warn.
 *
 * Allowed imports (in-iframe IIFE build):
 *   - ./request-manager (task 2.3)
 *   - ./frame-globals   (task 2.4)
 *   - ./frame-messenger (task 2.5)
 *   - ../shared/asset-types (task 1.2)
 *   - Browser globals only. NO obsidian / electron / node imports.
 *   - NO imports from src/lib/.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.2, 3.1
 * Design: iframe-init entry component
 */

import type { DrawioResponseEntry } from "../shared/asset-types";
import { createRequestManager, type CreateRequestManager } from "./request-manager";
import { installFrameGlobals, type InstallFrameGlobals } from "./frame-globals";
import { createIframeFrameMessenger } from "./frame-messenger";
import { installUserPrefHooks } from "./user-pref-hooks";

// ─── Message shapes ───────────────────────────────────────────────────────────

interface ConfigureMessage {
  readonly action: "configure";
  readonly urlParams: Record<string, string>;
  /** drawio webapp の index.html 文字列。`<link rel=stylesheet>` を解析して、
   *  本来の media 属性を尊重しつつ inline 注入するために使う。 */
  readonly indexHtml?: string;
}

/** 親からのアセットチャンク (OOM 対策の段階配信、要件 5.5/5.6)。 */
interface AssetsMessage {
  readonly action: "assets";
  readonly entries: readonly DrawioResponseEntry[];
  readonly group: "core" | "tail";
  readonly final: boolean;
  readonly seq: number;
}

interface UnknownMessage {
  readonly action: string;
  readonly [key: string]: unknown;
}

type InboundMessage = ConfigureMessage | AssetsMessage | UnknownMessage;

interface AssetAckMessage {
  readonly event: "asset-ack";
  readonly seq: number;
}

// ─── loadScript helper ────────────────────────────────────────────────────────

/**
 * Creates a <script> element, sets its src via setAttribute (so that the
 * RequestManager's patched setAttribute will rewrite relative URLs to Blob
 * URLs), optionally registers a load callback, and appends to document.head.
 * This becomes window.mxscript once frame-globals is installed.
 */
function loadScript(src: string, onLoad?: () => void): void {
  const script = document.createElement("script");
  if (onLoad) {
    script.addEventListener("load", () => onLoad());
  }
  // setAttribute triggers RequestManager's patched prototype → Blob URL resolve
  script.setAttribute("src", src);
  document.head.appendChild(script);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BootstrapIframeInitInput {
  /** The iframe's own window. Used to install the message listener. */
  readonly selfWindow: Window;
  /** The parent window (window.parent in production). */
  readonly parentWindow: Window;
  /**
   * Optional factory injection for installFrameGlobals.
   * Defaults to the real implementation; tests pass spies.
   */
  readonly installGlobals?: InstallFrameGlobals;
  /**
   * Optional factory injection for createRequestManager.
   * Defaults to the real implementation; tests pass spies.
   */
  readonly createManager?: CreateRequestManager;
}

/**
 * Wire up the in-iframe initialisation sequence.
 *
 * 1. Constructs an IframeFrameMessenger on selfWindow / parentWindow.
 * 2. Waits for {action:"configure"} from parent.
 * 3. On first configure: installs frame-globals and interceptRequests().
 *
 * Returns a dispose function for test cleanup.
 */
export function bootstrapIframeInit(input: BootstrapIframeInitInput): () => void {
  const {
    selfWindow,
    parentWindow,
    installGlobals = installFrameGlobals,
    createManager = createRequestManager,
  } = input;

  const messenger = createIframeFrameMessenger<InboundMessage, AssetAckMessage>({
    selfWindow,
    parentWindow,
  });

  let configured = false;
  let indexHtmlStr = "";
  let manager: ReturnType<CreateRequestManager> | null = null;

  function handleConfigure(msg: ConfigureMessage): void {
    if (configured) {
      // Idempotency: second configure (e.g. drawio's {action:"configure",config}
      // reply) is a no-op here; warn and return.
      console.warn("[drawio-frame] configure received more than once — ignoring duplicate");
      return;
    }
    configured = true;

    const { urlParams, indexHtml } = msg;
    indexHtmlStr = typeof indexHtml === "string" ? indexHtml : "";

    // Install frame globals (mxLoadResources, mxscript, urlParams, etc.)
    installGlobals({ urlParams, loadScript });

    // Create the request manager (assets arrive later as chunks) and patch DOM.
    manager = createManager();
    manager.interceptRequests();

    // Expose dispose on window for tests / future use (best-effort).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selfWindow as any).__drawioFrameDispose = (): void => {
      manager?.dispose();
    };

    // drawio エディタ内でのユーザー操作 (ライブラリ / テーマ / グリッド) を親へ通知。
    // app.min.js 評価後に EditorUi が現れるのを待ち受けてから monkey-patch を貼る。
    try {
      installUserPrefHooks({ parentWindow, hostWindow: selfWindow });
    } catch (err) {
      console.warn("[drawio-frame] installUserPrefHooks failed:", err);
    }

    console.debug("[drawio-frame] configured");
  }

  function handleAssets(msg: AssetsMessage): void {
    if (manager === null) {
      console.warn("[drawio-frame] assets received before configure — dropping chunk");
      return;
    }
    // Blob-ize immediately; source strings are not retained (OOM 対策).
    manager.ingest(msg.entries);

    // コア群の最終チャンク到着で index.html の <link stylesheet> を inline 注入する。
    // (画像等コアアセットが Blob 化済みなので url(...) が正しく解決される)
    if (msg.group === "core" && msg.final) {
      manager.injectStylesheets(indexHtmlStr);
    }

    // 親へ ack。親はこれを受けて次のチャンク配信 / app 起動へ進む (backpressure)。
    messenger.send({ event: "asset-ack", seq: msg.seq });
  }

  const unregister = messenger.onMessage((msg: InboundMessage) => {
    if (msg.action === "configure") {
      handleConfigure(msg as ConfigureMessage);
    } else if (msg.action === "assets") {
      handleAssets(msg as AssetsMessage);
    }
    // Other actions (script, load, save, etc.) are not handled here.
  });

  return (): void => {
    unregister();
    messenger.destroy();
  };
}

// ─── Auto-execution ───────────────────────────────────────────────────────────
// Only runs when loaded as the real in-iframe script.
// In jsdom tests, window.parent === window so this block is skipped.
if (typeof window !== "undefined" && window.parent !== window) {
  bootstrapIframeInit({ selfWindow: window, parentWindow: window.parent });
}
