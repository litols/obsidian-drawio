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
import {
  createRequestManager,
  rewriteCssUrlValue,
  type CreateRequestManager,
} from "./request-manager";
import { installFrameGlobals, type InstallFrameGlobals } from "./frame-globals";
import { createIframeFrameMessenger } from "./frame-messenger";
import { installUserPrefHooks } from "./user-pref-hooks";

// ─── Message shapes ───────────────────────────────────────────────────────────

interface ConfigureMessage {
  readonly action: "configure";
  readonly responses: readonly DrawioResponseEntry[];
  readonly urlParams: Record<string, string>;
  /** drawio webapp の index.html 文字列。`<link rel=stylesheet>` を解析して、
   *  本来の media 属性を尊重しつつ inline 注入するために使う。 */
  readonly indexHtml?: string;
}

interface UnknownMessage {
  readonly action: string;
  readonly [key: string]: unknown;
}

type InboundMessage = ConfigureMessage | UnknownMessage;

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

  const messenger = createIframeFrameMessenger<InboundMessage, never>({
    selfWindow,
    parentWindow,
  });

  let configured = false;

  const unregister = messenger.onMessage((msg: InboundMessage) => {
    if (msg.action !== "configure") {
      // Other actions (script, load, save, etc.) are not handled here.
      return;
    }

    if (configured) {
      // Idempotency: second configure is a no-op; warn and return.
      console.warn("[drawio-frame] configure received more than once — ignoring duplicate");
      return;
    }
    configured = true;

    const { responses, urlParams, indexHtml } = msg as ConfigureMessage;

    // Install frame globals (mxLoadResources, mxscript, urlParams, etc.)
    installGlobals({ urlParams, loadScript });

    // Intercept all DOM resource requests via Blob URL resolution.
    const manager = createManager(responses);
    manager.interceptRequests();

    // Pre-inject the stylesheets that drawio's index.html declares via
    // <link rel="stylesheet"> tags. Our flow uses a data:text/html bootstrap
    // so those static <link> tags from index.html are never evaluated.
    //
    // We honour each link's `media` attribute by wrapping the CSS body in
    // `@media (...)`. This is critical for `styles/high-contrast.css`, which
    // ships with `media="(forced-colors: active)"` and would otherwise force
    // the editor into permanent high-contrast styling.
    //
    // CSS `url(...)` references are rewritten to Blob URLs so background
    // images / @font-face resolve correctly.
    if (typeof indexHtml === "string" && indexHtml.length > 0) {
      const cssCache = new Map<string, string>();
      const parser = new DOMParser();
      const doc = parser.parseFromString(indexHtml, "text/html");
      const links = Array.from(doc.querySelectorAll("link[rel='stylesheet']"));
      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href) continue;
        const entry = responses.find((r) => r.href === href);
        if (entry === undefined) continue;
        if (!entry.mediaType.startsWith("text/css")) continue;
        const media = link.getAttribute("media");
        const css = rewriteCssUrlValue(entry.source, responses, cssCache);
        const styleEl = document.createElement("style");
        styleEl.dataset["drawioInjected"] = href;
        styleEl.textContent = media ? `@media ${media} {\n${css}\n}` : css;
        document.head.appendChild(styleEl);
      }
    }

    // Expose dispose on window for tests / future use (best-effort).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selfWindow as any).__drawioFrameDispose = (): void => {
      manager.dispose();
    };

    // drawio エディタ内でのユーザー操作 (ライブラリ / テーマ / グリッド) を親へ通知。
    // app.min.js 評価後に EditorUi が現れるのを待ち受けてから monkey-patch を貼る。
    try {
      installUserPrefHooks({ parentWindow, hostWindow: selfWindow });
    } catch (err) {
      console.warn("[drawio-frame] installUserPrefHooks failed:", err);
    }

    console.debug("[drawio-frame] configured");
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
